'use strict';

/**
 * Anomaly detection (US-19, FR-27, NFR-08).
 *
 * Five methods, with the parameters defined in US19-T1 and stored in
 * `system_parameters` so they can be tuned without a deploy:
 *
 *   OUT_OF_RANGE  value outside the physical range of the sensor
 *   SUDDEN_JUMP   change between consecutive readings above the per-type limit
 *                 (e.g. > 15 % soil moisture, > 5 C temperature)
 *   ZSCORE        |z| > 3 against the last 24 h of the same sensor
 *   MISSING_DATA  no reading for 5 minutes
 *   FLATLINE      an identical value repeated for 30 minutes
 *
 * OUT_OF_RANGE, SUDDEN_JUMP and ZSCORE run on ingestion; MISSING_DATA and
 * FLATLINE run in the periodic job because they are defined by absence.
 */

const db = require('../../db');
const settings = require('../../utils/settings');
const { logSystem } = require('../../utils/logger');

/** Insert an anomaly, flag its measurement, and never duplicate it. */
async function record({ sensorId, measurementId = null, method, value = null, score = null, explanation }) {
  const inserted = await db.one(
    `INSERT INTO anomalies (sensor_id, measurement_id, method, value, score, explanation)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (measurement_id, method) WHERE measurement_id IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [sensorId, measurementId, method, value, score, explanation],
  );

  if (!inserted) return null;

  // Only fault-type anomalies make a reading untrustworthy. A z-score outlier
  // is recorded and listed, but the value stays usable: a genuine drying or
  // heat trend is statistically unusual too, and hiding it would stop the
  // alert engine, automatic irrigation and the AI from reacting to it.
  if (measurementId && method !== 'ZSCORE') {
    await db.query('UPDATE measurements SET is_anomaly = TRUE WHERE id = $1', [measurementId]);
  }

  logSystem('WARN', 'anomalies', `${method} on ${sensorId}: ${explanation}`, { anomaly_id: inserted.id });
  return inserted;
}

/**
 * MISSING_DATA and FLATLINE are stateful: avoid re-recording the same
 * condition every time the job runs by requiring a quiet period.
 */
async function recentlyRecorded(sensorId, method, minutes) {
  const row = await db.one(
    `SELECT 1 FROM anomalies
      WHERE sensor_id = $1 AND method = $2 AND detected_at > NOW() - ($3 || ' minutes')::interval
      LIMIT 1`,
    [sensorId, method, String(minutes)],
  );
  return !!row;
}

/** Per-type jump limit, e.g. anomaly.jump.soil_moisture. */
async function jumpLimitFor(sensorType) {
  const defaults = {
    soil_moisture: 15, temperature: 5, air_humidity: 20,
    light: 30000, co2: 400, water_level: 25, ph: 1,
  };
  return settings.getNumber(`anomaly.jump.${sensorType}`, defaults[sensorType] ?? Infinity);
}

/**
 * Run the ingestion-time checks for a freshly stored measurement.
 * Returns the anomalies that were created.
 */
async function checkMeasurement(sensor, measurement) {
  const found = [];
  const value = Number(measurement.value);

  // --- 1. Out of physical range -----------------------------------------
  const min = Number(sensor.physical_min);
  const max = Number(sensor.physical_max);
  if (value < min || value > max) {
    const anomaly = await record({
      sensorId: sensor.id,
      measurementId: measurement.id,
      method: 'OUT_OF_RANGE',
      value,
      score: Math.abs(value < min ? min - value : value - max),
      explanation: `The reading ${value} ${sensor.unit} is outside the physical range of the sensor (${min} to ${max} ${sensor.unit}). The hardware may be disconnected or faulty.`,
    });
    if (anomaly) found.push(anomaly);
  }

  // --- 2. Sudden jump between consecutive readings ------------------------
  const previous = await db.one(
    `SELECT value, recorded_at FROM measurements
      WHERE sensor_id = $1 AND id <> $2 AND recorded_at <= $3
      ORDER BY recorded_at DESC LIMIT 1`,
    [sensor.id, measurement.id, measurement.recorded_at],
  );

  if (previous) {
    const limit = await jumpLimitFor(sensor.type);
    const delta = Math.abs(value - Number(previous.value));
    if (Number.isFinite(limit) && delta > limit) {
      const anomaly = await record({
        sensorId: sensor.id,
        measurementId: measurement.id,
        method: 'SUDDEN_JUMP',
        value,
        score: delta,
        explanation: `The reading changed by ${delta.toFixed(2)} ${sensor.unit} since the previous one (${previous.value} ${sensor.unit}), more than the ${limit} ${sensor.unit} expected between consecutive readings.`,
      });
      if (anomaly) found.push(anomaly);
    }
  }

  // --- 3. Statistical outlier over the last 24 h --------------------------
  const stats = await db.one(
    `SELECT AVG(value)::float AS mean, STDDEV_SAMP(value)::float AS sd, COUNT(*)::int AS n
       FROM measurements
      WHERE sensor_id = $1 AND id <> $2
        AND recorded_at > $3::timestamptz - INTERVAL '24 hours'
        AND recorded_at <= $3::timestamptz
        AND is_anomaly = FALSE`,
    [sensor.id, measurement.id, measurement.recorded_at],
  );

  // At least 20 samples and a non-degenerate spread, otherwise a z-score is
  // meaningless and would produce false positives.
  if (stats && stats.n >= 20 && stats.sd && stats.sd > 0.01) {
    const zThreshold = await settings.getNumber('anomaly.zscore_threshold', 3);
    const z = Math.abs((value - stats.mean) / stats.sd);
    if (z > zThreshold) {
      const anomaly = await record({
        sensorId: sensor.id,
        measurementId: measurement.id,
        method: 'ZSCORE',
        value,
        score: z,
        explanation: `The reading ${value} ${sensor.unit} is ${z.toFixed(1)} standard deviations away from the average of the last 24 hours (${stats.mean.toFixed(1)} ${sensor.unit}), so it is statistically unusual.`,
      });
      if (anomaly) found.push(anomaly);
    }
  }

  return found;
}

/**
 * Periodic checks that detect the absence of data (US19-T2).
 * Called by the anomaly job and by the acceptance script.
 */
async function runPeriodicChecks() {
  const missingMinutes = await settings.getNumber('anomaly.missing_data_minutes', 5);
  const flatlineMinutes = await settings.getNumber('anomaly.flatline_minutes', 30);
  const created = [];

  // --- 4. Missing data ---------------------------------------------------
  const silent = await db.rows(
    `SELECT s.id, s.name, s.unit, s.type,
            (SELECT MAX(recorded_at) FROM measurements m WHERE m.sensor_id = s.id) AS last_at
       FROM sensors s
      WHERE s.is_active
        AND EXISTS (SELECT 1 FROM measurements m WHERE m.sensor_id = s.id)`,
  );

  for (const sensor of silent) {
    const ageMinutes = (Date.now() - new Date(sensor.last_at).getTime()) / 60000;
    if (ageMinutes <= missingMinutes) continue;
    // Do not repeat the finding on every job tick.
    if (await recentlyRecorded(sensor.id, 'MISSING_DATA', missingMinutes)) continue;

    const anomaly = await record({
      sensorId: sensor.id,
      method: 'MISSING_DATA',
      score: ageMinutes,
      explanation: `No reading has been received from ${sensor.name} for ${Math.round(ageMinutes)} minutes (the limit is ${missingMinutes}). The sensor or its device may be disconnected.`,
    });
    if (anomaly) created.push(anomaly);
  }

  // --- 5. Flatline -------------------------------------------------------
  const flat = await db.rows(
    `SELECT s.id, s.name, s.unit,
            stats.distinct_values, stats.n, stats.value
       FROM sensors s
       JOIN LATERAL (
            SELECT COUNT(DISTINCT m.value) AS distinct_values,
                   COUNT(*)                AS n,
                   MAX(m.value)            AS value
              FROM measurements m
             WHERE m.sensor_id = s.id
               AND m.recorded_at > NOW() - ($1 || ' minutes')::interval
       ) stats ON TRUE
      WHERE s.is_active
        AND stats.n >= 3
        AND stats.distinct_values = 1`,
    [String(flatlineMinutes)],
  );

  for (const sensor of flat) {
    if (await recentlyRecorded(sensor.id, 'FLATLINE', flatlineMinutes)) continue;

    const anomaly = await record({
      sensorId: sensor.id,
      method: 'FLATLINE',
      value: sensor.value,
      score: Number(sensor.n),
      explanation: `${sensor.name} has reported exactly ${sensor.value} ${sensor.unit} in its last ${sensor.n} readings over ${flatlineMinutes} minutes. A frozen value usually means the sensor stopped responding.`,
    });
    if (anomaly) created.push(anomaly);
  }

  return created;
}

/** GET /api/anomalies */
async function list({ sensorId = null, areaId = null, method = null, from = null, to = null, limit = 100, offset = 0 } = {}) {
  return db.rows(
    `SELECT an.*, s.name AS sensor_name, s.type AS sensor_type, s.unit, s.area_id
       FROM anomalies an
       JOIN sensors s ON s.id = an.sensor_id
      WHERE ($1::text IS NULL OR an.sensor_id = $1)
        AND ($2::text IS NULL OR s.area_id    = $2)
        AND ($3::text IS NULL OR an.method    = $3)
        AND ($4::timestamptz IS NULL OR an.detected_at >= $4)
        AND ($5::timestamptz IS NULL OR an.detected_at <= $5)
      ORDER BY an.detected_at DESC
      LIMIT $6 OFFSET $7`,
    [sensorId, areaId, method, from, to, limit, offset],
  );
}

/** Sensor-fault anomalies per sensor in the last hour — input of the AI confidence and CHECK_SENSOR rule. */
async function recentCountBySensor(areaId, hours = 1) {
  const rows = await db.rows(
    `SELECT an.sensor_id, COUNT(*)::int AS n
       FROM anomalies an
       JOIN sensors s ON s.id = an.sensor_id
      WHERE s.area_id = $1 AND an.detected_at > NOW() - ($2 || ' hours')::interval
        -- Reading-level faults only: a z-score outlier is not a fault, and a past
        -- data gap (MISSING_DATA) already lowers the confidence through data
        -- completeness; neither means the current readings are unreliable.
        AND an.method NOT IN ('ZSCORE', 'MISSING_DATA')
      GROUP BY an.sensor_id`,
    [areaId, String(hours)],
  );
  return Object.fromEntries(rows.map((r) => [r.sensor_id, r.n]));
}

module.exports = { record, checkMeasurement, runPeriodicChecks, list, recentCountBySensor };
