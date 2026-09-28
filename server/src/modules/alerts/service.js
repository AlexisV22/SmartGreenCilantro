'use strict';

/**
 * Alert engine (US-11), severity classification (US-12) and history (US-13).
 *
 * Rules implemented here, straight from the Sprint 3 planning:
 *   * below min  -> LOW alert;  above max -> HIGH alert (US11-T1)
 *   * at most one OPEN/ACKNOWLEDGED alert per sensor and type (no duplicates)
 *   * returning inside the range resolves the open alert and sets resolved_at
 *   * severity = deviation outside the threshold as a percentage of the
 *     optimal range (max - min): <= 10 % LOW, 10-25 % MEDIUM, > 25 % HIGH,
 *     upgraded while the alert stays open (US12-T1, US12-T2)
 */

const db = require('../../db');
const settings = require('../../utils/settings');
const { notFound, badRequest } = require('../../middleware/errors');
const { logSystem } = require('../../utils/logger');

/** Human-readable label per sensor type, used in the alert message (NFR-06). */
const VARIABLE_LABEL = {
  temperature: 'air temperature',
  air_humidity: 'relative humidity',
  soil_moisture: 'soil moisture',
  light: 'light intensity',
  co2: 'CO2 concentration',
  water_level: 'water tank level',
  ph: 'soil pH',
};

/**
 * Classify severity from the deviation outside the threshold, expressed as a
 * percentage of the optimal range.
 *
 * Boundaries are inclusive on the lower side, matching the cases tested in
 * US12-T3 (9 % LOW, 10 % LOW, 11 % MEDIUM, 24 % MEDIUM, 25 % MEDIUM, 26 % HIGH).
 */
function classifySeverity(deviationPct, lowMaxPct, mediumMaxPct) {
  if (deviationPct <= lowMaxPct) return 'LOW';
  if (deviationPct <= mediumMaxPct) return 'MEDIUM';
  return 'HIGH';
}

/** Deviation outside [min, max] as a percentage of the optimal range. */
function deviationPercent(value, min, max) {
  const range = Number(max) - Number(min);
  if (!(range > 0)) return 0;

  const outside = value < min ? Number(min) - value : value - Number(max);
  return (outside / range) * 100;
}

/** The threshold that applies to a sensor: area first, greenhouse as fallback. */
async function resolveThreshold(sensor) {
  return db.one(
    `SELECT t.* FROM thresholds t
      WHERE (t.area_id = $1 OR (t.area_id IS NULL AND t.greenhouse_id = (
                SELECT greenhouse_id FROM areas WHERE id = $1)))
        AND t.sensor_type = $2
        AND t.crop_stage  = COALESCE((SELECT crop_stage FROM areas WHERE id = $1), 'vegetative')
      ORDER BY (t.area_id IS NOT NULL) DESC
      LIMIT 1`,
    [sensor.area_id, sensor.type],
  );
}

/**
 * Evaluate one stored measurement against its threshold (US11-T2).
 * Returns { created, resolved, alert } so the caller can react (for example
 * the AI engine, which runs whenever a new alert appears).
 */
async function evaluateMeasurement(sensor, measurement) {
  const threshold = await resolveThreshold(sensor);
  if (!threshold) return { created: false, resolved: false, alert: null };

  const value = Number(measurement.value);
  const min = Number(threshold.min_value);
  const max = Number(threshold.max_value);
  const label = VARIABLE_LABEL[sensor.type] || sensor.type;

  const isLow = value < min;
  const isHigh = value > max;

  // --- Back inside the range: resolve whatever was open (US11-T2) ---------
  if (!isLow && !isHigh) {
    const resolved = await db.query(
      `UPDATE alerts
          SET status = 'RESOLVED', resolved_at = NOW()
        WHERE sensor_id = $1 AND type IN ('LOW', 'HIGH') AND status IN ('OPEN', 'ACKNOWLEDGED')
        RETURNING id`,
      [sensor.id],
    );
    return { created: false, resolved: resolved.rowCount > 0, alert: null };
  }

  const type = isLow ? 'LOW' : 'HIGH';
  const deviation = deviationPercent(value, min, max);
  const lowMax = await settings.getNumber('severity.low_max_pct', 10);
  const mediumMax = await settings.getNumber('severity.medium_max_pct', 25);
  const severity = classifySeverity(deviation, lowMax, mediumMax);

  const message = isLow
    ? `The ${label} in ${sensor.area_id} is ${value} ${threshold.unit}, below the configured minimum of ${min} ${threshold.unit}.`
    : `The ${label} in ${sensor.area_id} is ${value} ${threshold.unit}, above the configured maximum of ${max} ${threshold.unit}.`;

  // An alert of the opposite direction is stale: close it first.
  await db.query(
    `UPDATE alerts SET status = 'RESOLVED', resolved_at = NOW()
      WHERE sensor_id = $1 AND type IN ('LOW', 'HIGH') AND type <> $2
        AND status IN ('OPEN', 'ACKNOWLEDGED')`,
    [sensor.id, type],
  );

  const open = await db.one(
    `SELECT * FROM alerts
      WHERE sensor_id = $1 AND type = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')
      LIMIT 1`,
    [sensor.id, type],
  );

  // --- Already open: refresh the value and upgrade severity if it grew ----
  if (open) {
    const severityRank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    const upgraded = severityRank[severity] > severityRank[open.severity] ? severity : open.severity;

    const updated = await db.one(
      `UPDATE alerts
          SET value = $1, deviation_pct = $2, severity = $3, message = $4
        WHERE id = $5
        RETURNING *`,
      [value, deviation, upgraded, message, open.id],
    );
    return { created: false, resolved: false, alert: updated, upgraded: upgraded !== open.severity };
  }

  // --- New alert ---------------------------------------------------------
  const alert = await db.one(
    `INSERT INTO alerts (sensor_id, area_id, threshold_id, type, value, severity, message, deviation_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [sensor.id, sensor.area_id, threshold.id, type, value, severity, message, deviation],
  );

  logSystem('WARN', 'alerts', `${severity} ${type} alert on ${sensor.id}: ${message}`, { alert_id: alert.id });

  return { created: true, resolved: false, alert };
}

/**
 * Raise (or refresh) a non-threshold alert: DEVICE_OFFLINE, LOW_WATER or
 * ANOMALY. De-duplicated exactly like the threshold alerts.
 */
async function raiseAlert({ sensorId = null, deviceId = null, areaId = null, type, severity = 'MEDIUM', message, value = null }) {
  const existing = await db.one(
    `SELECT * FROM alerts
      WHERE type = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')
        AND ($2::text IS NULL OR sensor_id = $2)
        AND ($3::text IS NULL OR device_id = $3)
      LIMIT 1`,
    [type, sensorId, deviceId],
  );
  if (existing) return { created: false, alert: existing };

  const alert = await db.one(
    `INSERT INTO alerts (sensor_id, device_id, area_id, type, value, severity, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [sensorId, deviceId, areaId, type, value, severity, message],
  );

  logSystem('WARN', 'alerts', `${severity} ${type} alert: ${message}`, { alert_id: alert.id });
  return { created: true, alert };
}

/** Resolve every open alert of a type for a sensor or device. */
async function resolveAlerts({ sensorId = null, deviceId = null, type }) {
  const result = await db.query(
    `UPDATE alerts SET status = 'RESOLVED', resolved_at = NOW()
      WHERE type = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')
        AND ($2::text IS NULL OR sensor_id = $2)
        AND ($3::text IS NULL OR device_id = $3)
      RETURNING id`,
    [type, sensorId, deviceId],
  );
  return result.rowCount;
}

/** GET /api/alerts — filtered, newest first, paginated (US13-T1). */
async function list({ status = null, severity = null, sensorId = null, areaId = null, type = null,
  from = null, to = null, limit = 100, offset = 0 } = {}) {
  return db.rows(
    `SELECT a.*, s.name AS sensor_name, s.type AS sensor_type, s.unit AS sensor_unit,
            t.min_value, t.max_value,
            u.email AS acknowledged_by_email
       FROM alerts a
       LEFT JOIN sensors s    ON s.id = a.sensor_id
       LEFT JOIN thresholds t ON t.id = a.threshold_id
       LEFT JOIN users u      ON u.id = a.acknowledged_by
      WHERE ($1::text IS NULL OR a.status   = $1)
        AND ($2::text IS NULL OR a.severity = $2)
        AND ($3::text IS NULL OR a.sensor_id = $3)
        AND ($4::text IS NULL OR a.area_id   = $4)
        AND ($5::text IS NULL OR a.type      = $5)
        AND ($6::timestamptz IS NULL OR a.created_at >= $6)
        AND ($7::timestamptz IS NULL OR a.created_at <= $7)
      ORDER BY a.created_at DESC
      LIMIT $8 OFFSET $9`,
    [status, severity, sensorId, areaId, type, from, to, limit, offset],
  );
}

async function count(filters = {}) {
  const row = await db.one(
    `SELECT COUNT(*)::int AS total FROM alerts a
      WHERE ($1::text IS NULL OR a.status   = $1)
        AND ($2::text IS NULL OR a.severity = $2)
        AND ($3::text IS NULL OR a.sensor_id = $3)
        AND ($4::text IS NULL OR a.area_id   = $4)
        AND ($5::text IS NULL OR a.type      = $5)
        AND ($6::timestamptz IS NULL OR a.created_at >= $6)
        AND ($7::timestamptz IS NULL OR a.created_at <= $7)`,
    [filters.status || null, filters.severity || null, filters.sensorId || null,
      filters.areaId || null, filters.type || null, filters.from || null, filters.to || null],
  );
  return row.total;
}

/** PATCH /api/alerts/:id/ack — the producer takes charge of an alert. */
async function acknowledge(alertId, user) {
  const alert = await db.one('SELECT * FROM alerts WHERE id = $1', [alertId]);
  if (!alert) throw notFound(`No alert with id "${alertId}".`);

  if (alert.status === 'RESOLVED') {
    throw badRequest('A resolved alert cannot be acknowledged.', [
      { field: 'status', issue: 'The alert is already RESOLVED.' },
    ]);
  }

  // Idempotent: a second acknowledgement keeps who acknowledged it first and when.
  if (alert.status === 'ACKNOWLEDGED') return alert;

  return db.one(
    `UPDATE alerts
        SET status = 'ACKNOWLEDGED', acknowledged_by = $1, acknowledged_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [user.id, alertId],
  );
}

module.exports = {
  evaluateMeasurement,
  raiseAlert,
  resolveAlerts,
  list,
  count,
  acknowledge,
  classifySeverity,
  deviationPercent,
  resolveThreshold,
  VARIABLE_LABEL,
};
