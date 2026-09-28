'use strict';

/**
 * AI data preprocessing pipeline (US20-T2).
 *
 * Turns the raw measurement history of an area into the feature vector the
 * recommender consumes:
 *
 *   1. discard readings flagged as anomalies (US-19)
 *   2. resample each sensor to 5-minute buckets (mean of the bucket)
 *   3. fill gaps of at most 15 minutes by linear interpolation; longer gaps
 *      stay empty and lower the data-completeness score
 *   4. derive the features: current moisture, slope, temperature, humidity,
 *      hours since the last irrigation, tank level, anomaly count and the
 *      agreement between the two soil sensors
 */

const db = require('../db');
const anomaliesService = require('../modules/anomalies/service');

const BUCKET_MINUTES = 5;
const MAX_GAP_MINUTES = 15;

/** Round an instant down to its 5-minute bucket. */
function bucketOf(date) {
  const ms = BUCKET_MINUTES * 60 * 1000;
  return new Date(Math.floor(new Date(date).getTime() / ms) * ms);
}

/**
 * Resample a series of { recorded_at, value } into 5-minute buckets and
 * interpolate short gaps.
 *
 * @returns {Array<{ t: Date, value: number, interpolated: boolean }>}
 */
function resample(rows, { from, to }) {
  const ms = BUCKET_MINUTES * 60 * 1000;
  const start = bucketOf(from).getTime();
  const end = bucketOf(to).getTime();

  // Mean per bucket.
  const sums = new Map();
  for (const row of rows) {
    const key = bucketOf(row.recorded_at).getTime();
    const entry = sums.get(key) || { total: 0, n: 0 };
    entry.total += Number(row.value);
    entry.n += 1;
    sums.set(key, entry);
  }

  const series = [];
  for (let t = start; t <= end; t += ms) {
    const entry = sums.get(t);
    series.push({
      t: new Date(t),
      value: entry ? entry.total / entry.n : null,
      interpolated: false,
    });
  }

  // Linear interpolation across gaps no longer than MAX_GAP_MINUTES.
  const maxGapBuckets = Math.floor(MAX_GAP_MINUTES / BUCKET_MINUTES);
  let lastKnown = -1;

  for (let i = 0; i < series.length; i += 1) {
    if (series[i].value !== null) {
      if (lastKnown >= 0 && i - lastKnown > 1) {
        const gap = i - lastKnown - 1;
        if (gap <= maxGapBuckets) {
          const a = series[lastKnown].value;
          const b = series[i].value;
          for (let k = 1; k <= gap; k += 1) {
            series[lastKnown + k].value = a + ((b - a) * k) / (gap + 1);
            series[lastKnown + k].interpolated = true;
          }
        }
      }
      lastKnown = i;
    }
  }

  return series;
}

/** Fraction of buckets that carry a real (non-interpolated) value. */
function completeness(series) {
  if (!series.length) return 0;
  const real = series.filter((s) => s.value !== null && !s.interpolated).length;
  return real / series.length;
}

/** Latest non-null value of a resampled series. */
function latestValue(series) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].value !== null) return series[i].value;
  }
  return null;
}

/** Raw history of one sensor type in an area, anomalies excluded. */
async function loadSeries(areaId, sensorType, hours) {
  return db.rows(
    `SELECT m.sensor_id, m.value, m.recorded_at
       FROM measurements m
       JOIN sensors s ON s.id = m.sensor_id
      WHERE s.area_id = $1 AND s.type = $2 AND s.is_active
        AND m.is_anomaly = FALSE
        AND m.recorded_at > NOW() - ($3 || ' hours')::interval
      ORDER BY m.recorded_at ASC`,
    [areaId, sensorType, String(hours)],
  );
}

/**
 * Build the complete feature vector for an area.
 *
 * @param {string} areaId
 * @param {number} hours  history window (24 h by default)
 */
async function buildFeatures(areaId, hours = 24) {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600 * 1000);

  const [moistureRows, tempRows, humidityRows, tankRows] = await Promise.all([
    loadSeries(areaId, 'soil_moisture', hours),
    loadSeries(areaId, 'temperature', hours),
    loadSeries(areaId, 'air_humidity', hours),
    loadSeries(areaId, 'water_level', hours),
  ]);

  const moisture = resample(moistureRows, { from, to });
  const temperature = resample(tempRows, { from, to });
  const humidity = resample(humidityRows, { from, to });
  const tank = resample(tankRows, { from, to });

  // --- Agreement between the two soil-moisture sensors --------------------
  // A large disagreement means one probe is unreliable, which forces a
  // CHECK_SENSOR recommendation instead of irrigating blindly.
  const perSensorLatest = new Map();
  for (const row of moistureRows) {
    perSensorLatest.set(row.sensor_id, Number(row.value));
  }
  const soilValues = [...perSensorLatest.values()];
  // "Current" values are the newest readings, not the mean of the last 5-min
  // bucket: that bucket can still contain older values of a fast change.
  // Soil moisture is the average of the latest reading of each probe.
  const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
  const newest = (rows) => (rows.length ? Number(rows[rows.length - 1].value) : null);
  const currentMoisture = soilValues.length
    ? soilValues.reduce((a, b) => a + b, 0) / soilValues.length
    : latestValue(moisture);
  let sensorSpreadPct = 0;
  if (soilValues.length >= 2) {
    const min = Math.min(...soilValues);
    const max = Math.max(...soilValues);
    sensorSpreadPct = max - min;
  }

  // --- Hours since the pump was last switched on --------------------------
  const lastIrrigation = await db.one(
    `SELECT MAX(e.created_at) AS at
       FROM actuator_events e
       JOIN actuators a ON a.id = e.actuator_id
      WHERE a.area_id = $1 AND a.type = 'irrigation_pump' AND e.action = 'ON'`,
    [areaId],
  );
  const hoursSinceIrrigation = lastIrrigation && lastIrrigation.at
    ? (Date.now() - new Date(lastIrrigation.at).getTime()) / 3600000
    : null;

  const anomalyCounts = await anomaliesService.recentCountBySensor(areaId, 1);
  const anomalyCount = Object.values(anomalyCounts).reduce((a, b) => a + b, 0);

  const soilSensors = await db.rows(
    `SELECT id FROM sensors WHERE area_id = $1 AND type = 'soil_moisture' AND is_active`,
    [areaId],
  );
  const soilSensorIds = soilSensors.map((s) => s.id);
  const soilAnomalies = soilSensorIds.reduce((total, id) => total + (anomalyCounts[id] || 0), 0);

  return {
    area_id: areaId,
    window_hours: hours,
    generated_at: to.toISOString(),

    series: { moisture, temperature, humidity, tank },

    soil_moisture: round2(currentMoisture),
    temperature: round2(newest(tempRows) ?? latestValue(temperature)),
    air_humidity: round2(newest(humidityRows) ?? latestValue(humidity)),
    tank_level: round2(newest(tankRows) ?? latestValue(tank)),

    sensor_values: Object.fromEntries(perSensorLatest),
    sensor_spread_pct: round2(sensorSpreadPct),
    soil_sensor_count: soilSensorIds.length,
    soil_sensor_anomalies: soilAnomalies,

    hours_since_irrigation: hoursSinceIrrigation,
    anomaly_count_last_hour: anomalyCount,

    completeness: {
      moisture: completeness(moisture),
      temperature: completeness(temperature),
      humidity: completeness(humidity),
      overall: (completeness(moisture) * 0.6) + (completeness(temperature) * 0.25) + (completeness(humidity) * 0.15),
    },
  };
}

module.exports = {
  buildFeatures,
  resample,
  completeness,
  latestValue,
  bucketOf,
  BUCKET_MINUTES,
  MAX_GAP_MINUTES,
};
