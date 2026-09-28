'use strict';

/**
 * Measurement ingestion and history (US-06, US-07, US-08, FR-05, FR-08, FR-20).
 *
 * Storage rules of US07-T3:
 *   * the sensor must exist and be active
 *   * its device must be active
 *   * the value must be numeric
 *   * the timestamp must be a valid ISO-8601 instant
 * Anything else is rejected with the standard 400 contract and logged.
 *
 * After a reading is stored the alert engine (US-11) and the anomaly service
 * (US-19) are run on it. They are awaited so a single POST leaves the system
 * fully consistent, which is what the acceptance scenario depends on.
 */

const db = require('../../db');
const sensorsService = require('../sensors/service');
const alertsService = require('../alerts/service');
const anomaliesService = require('../anomalies/service');
const { badRequest } = require('../../middleware/errors');
const { logSystem } = require('../../utils/logger');

const MAX_BATCH = 500;

/** Validate one reading and return the details array of any problem found. */
function validateReading(reading, index = null) {
  const details = [];
  const at = index === null ? '' : `[${index}] `;

  if (!reading || typeof reading !== 'object') {
    return [{ field: `${at}(reading)`, issue: 'Each reading must be a JSON object.' }];
  }
  if (!reading.sensor_id || typeof reading.sensor_id !== 'string') {
    details.push({ field: `${at}sensor_id`, issue: 'A sensor identifier is required.' });
  }

  const value = Number(reading.value);
  if (reading.value === null || reading.value === undefined || reading.value === '' || !Number.isFinite(value)) {
    details.push({ field: `${at}value`, issue: 'The sensor value must be a valid floating-point number.' });
  }

  if (reading.recorded_at !== undefined && reading.recorded_at !== null) {
    const parsed = new Date(reading.recorded_at);
    if (Number.isNaN(parsed.getTime())) {
      details.push({ field: `${at}recorded_at`, issue: 'The timestamp must be a valid ISO-8601 instant in UTC.' });
    } else if (parsed.getTime() > Date.now() + 5 * 60 * 1000) {
      // A clock more than five minutes ahead means the device NTP failed.
      details.push({ field: `${at}recorded_at`, issue: 'The timestamp is too far in the future; check the device clock.' });
    }
  }

  return details;
}

/**
 * Store one reading and run the downstream engines.
 *
 * @param {object}  reading  { sensor_id, value, unit?, recorded_at?, device_status? }
 * @param {object?} device   the authenticated device, when the caller is a node
 */
async function store(reading, device = null) {
  const problems = validateReading(reading);
  if (problems.length) {
    throw badRequest('The submitted data does not match the required schema.', problems);
  }

  const sensor = await sensorsService.findForIngestion(reading.sensor_id);

  // Unknown sensor, deactivated sensor and deactivated device are all
  // rejected, which US07-T3 and US25-T5 verify explicitly.
  if (!sensor) {
    logSystem('WARN', 'measurements', `Rejected reading for unknown sensor "${reading.sensor_id}".`);
    throw badRequest('The sensor is not registered.', [
      { field: 'sensor_id', issue: `Unknown sensor "${reading.sensor_id}".` },
    ]);
  }
  if (!sensor.is_active) {
    logSystem('WARN', 'measurements', `Rejected reading for inactive sensor "${reading.sensor_id}".`);
    throw badRequest('The sensor is deactivated and cannot report measurements.', [
      { field: 'sensor_id', issue: `Sensor "${reading.sensor_id}" is not active.` },
    ]);
  }
  if (!sensor.device_active) {
    throw badRequest('The device owning this sensor is deactivated.', [
      { field: 'sensor_id', issue: `Device "${sensor.device_id}" is not active.` },
    ]);
  }
  // A device may only report for its own sensors.
  if (device && sensor.device_id !== device.id) {
    throw badRequest('The sensor does not belong to the authenticated device.', [
      { field: 'sensor_id', issue: `Sensor "${reading.sensor_id}" belongs to another device.` },
    ]);
  }

  const recordedAt = reading.recorded_at ? new Date(reading.recorded_at) : new Date();

  const measurement = await db.one(
    `INSERT INTO measurements (sensor_id, value, unit, recorded_at, device_status)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'OK'))
     RETURNING *`,
    [sensor.id, Number(reading.value), reading.unit || sensor.unit, recordedAt.toISOString(),
      reading.device_status || null],
  );

  // --- Downstream engines -------------------------------------------------
  const anomalies = await anomaliesService.checkMeasurement(sensor, measurement);

  // A reading that looks like a hardware fault (outside the physical range or
  // an impossible jump) must not raise a threshold alert: the value is not
  // trustworthy (US-19 feeds US-11). A z-score outlier alone is only unusual,
  // not invalid — a real heat spike is both — so it still reaches the alert engine.
  const FAULT_METHODS = ['OUT_OF_RANGE', 'SUDDEN_JUMP'];
  let alertResult = { created: false, resolved: false, alert: null };
  if (!anomalies.some((a) => FAULT_METHODS.includes(a.method))) {
    alertResult = await alertsService.evaluateMeasurement(sensor, measurement);
  }

  return { measurement, sensor, anomalies, alert: alertResult };
}

/**
 * Store an array of readings (the buffered batch the firmware resends after a
 * reconnection, US06-T4). Every reading is processed independently so one bad
 * row cannot discard the whole buffer.
 */
async function storeBatch(readings, device = null) {
  if (!Array.isArray(readings) || readings.length === 0) {
    throw badRequest('The batch must contain at least one reading.', [
      { field: '(body)', issue: 'Expected a non-empty array of readings.' },
    ]);
  }
  if (readings.length > MAX_BATCH) {
    throw badRequest(`A batch may not exceed ${MAX_BATCH} readings.`, [
      { field: '(body)', issue: `Received ${readings.length} readings.` },
    ]);
  }

  const accepted = [];
  const rejected = [];

  for (let i = 0; i < readings.length; i += 1) {
    try {
      const result = await store(readings[i], device);
      accepted.push({
        id: result.measurement.id,
        sensor_id: result.measurement.sensor_id,
        status: 'processed',
        inserted_at: result.measurement.received_at,
        // Same echo as a single reading, so the device sees the effect of each row.
        alert: result.alert.alert
          ? { id: result.alert.alert.id, type: result.alert.alert.type, severity: result.alert.alert.severity, created: result.alert.created }
          : null,
        anomalies: result.anomalies.map((a) => ({ id: a.id, method: a.method })),
      });
    } catch (err) {
      rejected.push({
        index: i,
        sensor_id: readings[i] && readings[i].sensor_id,
        code: err.code || 'ERR_VALIDATION_FAILED',
        message: err.message,
        details: err.details || [],
      });
    }
  }

  return { accepted, rejected };
}

/** GET /api/sensors/:id/measurements — history with from/to filters (US07-T4). */
async function history(sensorId, { from = null, to = null, limit = 100, includeAnomalies = true } = {}) {
  const sensor = await db.one('SELECT id, type, unit, area_id, name FROM sensors WHERE id = $1', [sensorId]);
  if (!sensor) return null;

  const data = await db.rows(
    `SELECT value, unit, recorded_at, received_at, is_anomaly, device_status
       FROM measurements
      WHERE sensor_id = $1
        AND ($2::timestamptz IS NULL OR recorded_at >= $2)
        AND ($3::timestamptz IS NULL OR recorded_at <= $3)
        AND ($4::boolean OR is_anomaly = FALSE)
      ORDER BY recorded_at DESC
      LIMIT $5`,
    [sensorId, from, to, includeAnomalies, limit],
  );

  return {
    sensor_id: sensor.id,
    type: sensor.type,
    unit: sensor.unit,
    area_id: sensor.area_id,
    count: data.length,
    data,
  };
}

/** GET /api/measurements/latest — one row per sensor for the dashboard cards. */
async function latest({ areaId = null } = {}) {
  return db.rows(
    `SELECT v.*, s.name, s.physical_min, s.physical_max, s.is_active,
            t.min_value AS threshold_min, t.max_value AS threshold_max
       FROM v_latest_measurements v
       JOIN sensors s ON s.id = v.sensor_id
       LEFT JOIN thresholds t
              ON t.area_id = s.area_id AND t.sensor_type = s.type
      WHERE $1::text IS NULL OR v.area_id = $1
      ORDER BY v.area_id, v.sensor_type`,
    [areaId],
  );
}

/** Average of the soil-moisture sensors of an area — used by US-16 and the AI. */
async function areaSoilMoisture(areaId, { staleMinutes = 5 } = {}) {
  return db.rows(
    `SELECT v.sensor_id, v.value, v.recorded_at, v.is_anomaly,
            (v.recorded_at < NOW() - ($2 || ' minutes')::interval) AS is_stale
       FROM v_latest_measurements v
       JOIN sensors s ON s.id = v.sensor_id
      WHERE v.area_id = $1 AND v.sensor_type = 'soil_moisture' AND s.is_active`,
    [areaId, String(staleMinutes)],
  );
}

module.exports = { store, storeBatch, history, latest, areaSoilMoisture, validateReading, MAX_BATCH };
