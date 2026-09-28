#!/usr/bin/env node
'use strict';

/**
 * Generates realistic measurement history for every sensor of AREA-1 so the
 * charts (FR-10), the analysis module (US-18), the z-score anomaly method
 * (US-19) and the AI recommender (US-20) have data to work with.
 *
 *   node server/scripts/seed-history.js            # 30 days, 5-minute readings
 *   node server/scripts/seed-history.js --days 7 --step 10
 *
 * The model is a simple greenhouse physics loop:
 *   - temperature and light follow a day/night cycle with day-to-day weather;
 *   - relative humidity moves opposite to temperature;
 *   - CO2 drops during the day (photosynthesis) and rises at night;
 *   - soil moisture evaporates faster when it is hot and dry, and the pump
 *     irrigates when it falls below 62 % (ACT-PUMP-01 events are recorded);
 *   - the water tank drains with every irrigation and is refilled every 5 days;
 *   - a handful of sensor faults (spikes) are injected and flagged as anomalies.
 *
 * Rows already stored inside the generated window are replaced, so the script
 * can be run again safely.
 */

const db = require('../src/db');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const DAYS = arg('days', 30);
const STEP_MIN = arg('step', 5);
const SENSORS = {
  'SM-01': '%', 'SM-02': '%', 'TMP-01': 'C', 'HUM-01': '%',
  'LUX-01': 'lux', 'CO2-01': 'ppm', 'WL-01': '%', 'PH-01': 'pH',
};

// Deterministic pseudo-random generator so every team member gets the same data.
let seed = 20260921;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function noise(amplitude) { return (rand() - 0.5) * 2 * amplitude; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v, d = 1) { const f = 10 ** d; return Math.round(v * f) / f; }

function generate() {
  const end = new Date();
  end.setUTCSeconds(0, 0);
  end.setUTCMinutes(end.getUTCMinutes() - (end.getUTCMinutes() % STEP_MIN));
  const start = new Date(end.getTime() - DAYS * 24 * 3600 * 1000);

  const measurements = [];
  const anomalies = [];
  const events = [];

  let moisture = 70;
  let tank = 85;
  let ph = 6.5;
  let pumpOnUntil = null;
  let lastIrrigationEnd = 0;
  let lastRefill = start.getTime();
  let dayWeather = 0;

  // Fault injection points (step index -> sensor), spread over the window.
  const totalSteps = Math.floor((end - start) / (STEP_MIN * 60000));
  const faults = new Map([
    [Math.floor(totalSteps * 0.21), 'TMP-01'],
    [Math.floor(totalSteps * 0.47), 'SM-02'],
    [Math.floor(totalSteps * 0.66), 'HUM-01'],
    [Math.floor(totalSteps * 0.83), 'SM-01'],
  ]);

  for (let step = 0; step <= totalSteps; step += 1) {
    const t = new Date(start.getTime() + step * STEP_MIN * 60000);
    // Local solar time for Puebla (UTC-6): the day peaks around 14:00 local.
    const localHour = (t.getUTCHours() - 6 + 24 + t.getUTCMinutes() / 60) % 24;
    if (step % Math.round((24 * 60) / STEP_MIN) === 0) dayWeather = noise(2.5);

    const daylight = Math.max(0, Math.sin(((localHour - 6) / 13) * Math.PI));
    const temperature = 17.5 + 8.5 * Math.max(0, Math.sin(((localHour - 8) / 16) * Math.PI))
      + dayWeather + noise(0.4);
    const humidity = clamp(78 - (temperature - 17) * 2.6 + noise(2), 35, 95);
    const light = daylight > 0 ? clamp(daylight * (30000 + dayWeather * 3000) + noise(1500), 0, 90000) : 0;
    const co2 = clamp(820 - daylight * 360 + noise(25), 380, 1400);

    // Soil water balance (percentage points per step).
    const evaporation = (0.035 + Math.max(0, temperature - 18) * 0.009 + Math.max(0, 60 - humidity) * 0.002)
      * (STEP_MIN / 5);
    moisture -= evaporation;

    if (pumpOnUntil && t >= pumpOnUntil) {
      events.push({ actuator: 'ACT-PUMP-01', action: 'OFF', at: t, duration: null, reason: 'Target moisture reached' });
      lastIrrigationEnd = t.getTime();
      pumpOnUntil = null;
    }
    const cooledDown = t.getTime() - lastIrrigationEnd > 30 * 60000;
    if (!pumpOnUntil && moisture < 62.5 && cooledDown && tank > 20) {
      const duration = clamp(Math.round((71 - moisture) / 1.1), 3, 10);
      pumpOnUntil = new Date(t.getTime() + duration * 60000);
      events.push({
        actuator: 'ACT-PUMP-01', action: 'ON', at: t, duration,
        reason: `Automatic irrigation: soil moisture ${round(moisture)} % below minimum 60-62 %`,
      });
    }
    if (pumpOnUntil) {
      moisture += 1.1 * STEP_MIN;
      tank -= 0.1 * STEP_MIN;
    }
    moisture = clamp(moisture, 30, 88);

    // Tank refill every 5 days at 09:00 local time.
    if (t.getTime() - lastRefill > 5 * 24 * 3600 * 1000 && localHour >= 9 && localHour < 10) {
      tank = 95;
      lastRefill = t.getTime();
    }
    tank = clamp(tank - 0.002, 0, 100);
    ph = clamp(ph + noise(0.01) + (6.5 - ph) * 0.01, 6.1, 6.9);

    const values = {
      'SM-01': round(moisture + noise(0.6)),
      'SM-02': round(moisture - 1.2 + noise(0.8)),
      'TMP-01': round(temperature),
      'HUM-01': round(humidity),
      'LUX-01': Math.round(light),
      'CO2-01': Math.round(co2),
      'WL-01': round(tank),
      'PH-01': round(ph, 2),
    };

    const fault = faults.get(step);
    for (const [sensorId, unit] of Object.entries(SENSORS)) {
      let value = values[sensorId];
      let isAnomaly = false;
      if (fault === sensorId) {
        const spiked = sensorId === 'TMP-01' ? value + 14 : sensorId === 'HUM-01' ? 3 : value > 50 ? value - 38 : value + 38;
        anomalies.push({
          sensorId, at: t, value: spiked, method: 'SUDDEN_JUMP', score: Math.abs(spiked - value),
          explanation: `Sudden jump of ${round(Math.abs(spiked - value))} ${unit} between consecutive readings `
            + `(${value} -> ${spiked}); likely a sensor or wiring fault.`,
        });
        value = spiked;
        isAnomaly = true;
      }
      measurements.push({ sensorId, value, unit, at: t, isAnomaly });
    }
  }

  return { start, end, measurements, anomalies, events };
}

async function insertMeasurements(client, rows) {
  const CHUNK = 5000;
  const ids = new Map();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const result = await client.query(
      `INSERT INTO measurements (sensor_id, value, unit, recorded_at, received_at, is_anomaly)
       SELECT s, v, u, r, r + INTERVAL '2 seconds', a
       FROM UNNEST($1::text[], $2::numeric[], $3::text[], $4::timestamptz[], $5::boolean[]) AS x(s, v, u, r, a)
       RETURNING id, sensor_id, recorded_at, is_anomaly`,
      [
        part.map((r) => r.sensorId), part.map((r) => r.value), part.map((r) => r.unit),
        part.map((r) => r.at.toISOString()), part.map((r) => r.isAnomaly),
      ],
    );
    for (const row of result.rows) {
      if (row.is_anomaly) ids.set(`${row.sensor_id}|${new Date(row.recorded_at).toISOString()}`, row.id);
    }
  }
  return ids;
}

async function main() {
  const started = Date.now();
  const { start, end, measurements, anomalies, events } = generate();

  await db.withTransaction(async (client) => {
    const sensorIds = Object.keys(SENSORS);
    await client.query(
      'DELETE FROM anomalies WHERE sensor_id = ANY($1) AND detected_at BETWEEN $2 AND $3',
      [sensorIds, start, end],
    );
    await client.query(
      'DELETE FROM measurements WHERE sensor_id = ANY($1) AND recorded_at BETWEEN $2 AND $3',
      [sensorIds, start, end],
    );
    await client.query(
      "DELETE FROM actuator_events WHERE actuator_id = 'ACT-PUMP-01' AND source = 'AUTOMATIC' AND created_at BETWEEN $1 AND $2",
      [start, end],
    );

    const anomalyIds = await insertMeasurements(client, measurements);

    for (const a of anomalies) {
      await client.query(
        `INSERT INTO anomalies (sensor_id, measurement_id, method, value, score, explanation, detected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [a.sensorId, anomalyIds.get(`${a.sensorId}|${a.at.toISOString()}`) || null,
          a.method, a.value, round(a.score, 3), a.explanation, a.at],
      );
    }

    for (const e of events) {
      await client.query(
        `INSERT INTO actuator_events (actuator_id, action, source, reason, duration_min, created_at)
         VALUES ($1, $2, 'AUTOMATIC', $3, $4, $5)`,
        [e.actuator, e.action, e.reason, e.duration, e.at],
      );
    }

    // Leave the pump in its final simulated state.
    await client.query(
      "UPDATE actuators SET state = 'OFF', last_update = $1 WHERE id = 'ACT-PUMP-01'",
      [end],
    );
  });

  const irrigations = events.filter((e) => e.action === 'ON').length;
  console.log(`OK  ${measurements.length} measurements (${DAYS} days x ${Object.keys(SENSORS).length} sensors, `
    + `every ${STEP_MIN} min), ${irrigations} irrigation cycles, ${anomalies.length} anomalies `
    + `in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`    window ${start.toISOString()} -> ${end.toISOString()}`);
}

main()
  .catch((err) => {
    console.error('seed-history failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
