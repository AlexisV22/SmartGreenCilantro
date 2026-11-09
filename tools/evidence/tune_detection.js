#!/usr/bin/env node
'use strict';

/**
 * US19-T9 — tuning of the anomaly detection parameters.
 *
 * For every candidate parameter set (z-score threshold, jump size per type,
 * flatline time) on the isolated test database (smartgreen_test):
 *
 *   1. ingestion false positives — 24 h of normal readings (seed-history
 *      model, no faults, the same data for every candidate) replayed in time
 *      order through POST /api/measurements, exactly like US19-T8;
 *   2. periodic false positives — the MISSING_DATA / FLATLINE job evaluated
 *      on the same normal day every 30 minutes (the readings of the window
 *      are re-timed so that the evaluation point is "now");
 *   3. detection — the five anomalies of US19-T8 are injected on top of
 *      normal history (spike, out-of-range, z-score outlier, flatline,
 *      disconnection) and each one must still be detected. The frozen sensor
 *      is HUM-01: a tank that nobody draws from is constant by nature.
 *
 * The chosen set is finally replayed over 7 days of normal data.
 *
 *   node tools/evidence/tune_detection.js [--out file.json] [--skip-week]
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/smartgreen_test';
process.env.TEST_DATABASE_URL = url.toString();
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = 'test';
process.env.JOBS_ENABLED = 'false';

const DEVICE_KEY = 'sec_iot_dev_node_01_smartgreen_team3';
const BASE = {
  'anomaly.zscore_threshold': 3, 'anomaly.jump.temperature': 5, 'anomaly.jump.soil_moisture': 15,
  'anomaly.flatline_minutes': 30, 'anomaly.flatline_minutes.water_level': 30,
};
const CANDIDATES = [
  { name: 'A — initial values (US19-T1)', params: {} },
  { name: 'B — z-score 3.5', params: { 'anomaly.zscore_threshold': 3.5 } },
  { name: 'C — z-score 4', params: { 'anomaly.zscore_threshold': 4 } },
  { name: 'D — B + temperature jump 3 °C', params: { 'anomaly.zscore_threshold': 3.5, 'anomaly.jump.temperature': 3 } },
  { name: 'E — B + flatline 15 min', params: { 'anomaly.zscore_threshold': 3.5, 'anomaly.flatline_minutes': 15, 'anomaly.flatline_minutes.water_level': 15 } },
  { name: 'F — B + flatline 60 min', params: { 'anomaly.zscore_threshold': 3.5, 'anomaly.flatline_minutes': 60, 'anomaly.flatline_minutes.water_level': 60 } },
  { name: 'G — B + tank flatline 120 min', params: { 'anomaly.zscore_threshold': 3.5, 'anomaly.flatline_minutes.water_level': 120 } },
  { name: 'H — B + tank flatline 300 min', params: { 'anomaly.zscore_threshold': 3.5, 'anomaly.flatline_minutes.water_level': 300 } },
  { name: 'I — B + tank flatline 720 min', params: { 'anomaly.zscore_threshold': 3.5, 'anomaly.flatline_minutes.water_level': 720 } },
];

let db; let app; let request; let settings; let anomalies; let generate;
// The periodic evaluation re-times old readings to "now"; the daylight rule of
// the light sensor must use the original time of the evaluated point.
let virtualNow = null;

async function fresh(params) {
  await db.query('DELETE FROM anomalies');
  await db.query('DELETE FROM alerts');
  await db.query('DELETE FROM measurements');
  for (const [key, value] of Object.entries(params)) {
    await db.query(
      `INSERT INTO system_parameters (key, value, description) VALUES ($1, $2, 'US19-T9 tuning')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)],
    );
  }
  settings.invalidate();
}

async function bulkInsert(rows) {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO measurements (sensor_id, value, unit, recorded_at)
     SELECT s, v, u, t FROM unnest($1::text[], $2::numeric[], $3::text[], $4::timestamptz[]) AS x(s, v, u, t)`,
    [rows.map((r) => r.sensorId), rows.map((r) => r.value), rows.map((r) => r.unit), rows.map((r) => r.at)],
  );
}

/** 1. Replay normal data through the API and count every anomaly. */
async function ingestionFalsePositives(measurements) {
  const cycles = new Map();
  for (const m of measurements) {
    const k = m.at.toISOString();
    if (!cycles.has(k)) cycles.set(k, []);
    cycles.get(k).push({ device_id: 'dev-node-01', sensor_id: m.sensorId, value: m.value, unit: m.unit, recorded_at: k });
  }
  let accepted = 0;
  for (const batch of cycles.values()) {
    const res = await request(app).post('/api/measurements').set('apikey', DEVICE_KEY).send(batch);
    accepted += res.body.accepted || 0;
  }
  const byMethod = await db.rows('SELECT method, COUNT(*)::int AS n FROM anomalies GROUP BY method ORDER BY method');
  const bySensor = await db.rows("SELECT sensor_id || ' ' || method AS k, COUNT(*)::int AS n FROM anomalies GROUP BY 1 ORDER BY 1");
  const total = byMethod.reduce((s, r) => s + r.n, 0);
  return { accepted, total, rate_pct: Number(((total / accepted) * 100).toFixed(3)), by_method: byMethod, by_sensor: bySensor };
}

/** 2. Evaluate the periodic job every 30 minutes of the normal day. */
async function periodicFalsePositives(measurements, windowMinutes) {
  const times = [...new Set(measurements.map((m) => m.at.getTime()))].sort((a, b) => a - b);
  const windowMs = (windowMinutes + 5) * 60000;
  const first = times[0] + windowMs;
  const findings = {};
  let checks = 0;
  for (let point = first; point <= times[times.length - 1]; point += 30 * 60000) {
    await db.query('DELETE FROM anomalies');
    await db.query('DELETE FROM measurements');
    const shift = Date.now() - 30000 - point;
    await bulkInsert(measurements.filter((m) => m.at.getTime() <= point && m.at.getTime() > point - windowMs)
      .map((m) => ({ ...m, at: new Date(m.at.getTime() + shift) })));
    virtualNow = new Date(point);
    const found = await anomalies.runPeriodicChecks();
    virtualNow = null;
    checks += 8;
    for (const a of found) {
      const k = `${a.sensor_id} ${a.method}`;
      findings[k] = (findings[k] || 0) + 1;
    }
  }
  const total = Object.values(findings).reduce((s, n) => s + n, 0);
  return { sensor_checks: checks, total, rate_pct: Number(((total / checks) * 100).toFixed(3)), findings };
}

/** 3. Inject the five anomalies of US19-T8 on top of 24 h of normal history. */
async function detection(measurements, flatlineMinutes) {
  const last = Math.max(...measurements.map((m) => m.at.getTime()));
  const shift = Date.now() - 60000 - last;
  const flatFrom = Date.now() - (flatlineMinutes + 10) * 60000;
  const history = measurements.map((m) => ({ ...m, at: new Date(m.at.getTime() + shift) }))
    .filter((m) => !(m.sensorId === 'SM-01' && m.at.getTime() > Date.now() - 7 * 60000)) // disconnection
    .map((m) => (m.sensorId === 'HUM-01' && m.at.getTime() >= flatFrom ? { ...m, value: 61 } : m)); // frozen humidity sensor
  await bulkInsert(history);

  const send = (sensorId, value, unit) => request(app).post('/api/measurements').set('apikey', DEVICE_KEY)
    .send({ device_id: 'dev-node-01', sensor_id: sensorId, value, unit, recorded_at: new Date().toISOString() });
  const start = new Date(Date.now() - 1000);
  await send('TMP-01', 22, 'C');
  await send('TMP-01', 30, 'C'); // spike +8 °C
  await send('TMP-01', 23, 'C');
  await send('SM-02', 140, '%'); // out of range
  await send('SM-02', 65, '%');
  await send('CO2-01', 880, 'ppm');
  await send('CO2-01', 1260, 'ppm'); // outlier (+380 ppm, below the 400 ppm jump limit)
  await send('CO2-01', 880, 'ppm');
  await anomalies.runPeriodicChecks();

  const has = async (sensor, method, since = start) => (await db.one(
    'SELECT COUNT(*)::int AS n FROM anomalies WHERE sensor_id = $1 AND method = $2 AND detected_at >= $3', [sensor, method, since])).n > 0;
  const z = await db.one("SELECT round(score, 2)::float AS z FROM anomalies WHERE sensor_id = 'CO2-01' AND method = 'ZSCORE' AND value = 1260");
  return {
    spike: await has('TMP-01', 'SUDDEN_JUMP'),
    out_of_range: await has('SM-02', 'OUT_OF_RANGE'),
    outlier: await has('CO2-01', 'ZSCORE'),
    outlier_z: z ? z.z : null,
    flatline: await has('HUM-01', 'FLATLINE'),
    disconnection: await has('SM-01', 'MISSING_DATA'),
  };
}

async function evaluate(candidate, day) {
  const params = { ...BASE, ...candidate.params };
  const t0 = Date.now();
  await fresh(params);
  const ingestion = await ingestionFalsePositives(day);
  await fresh(params);
  const periodic = await periodicFalsePositives(day, Math.max(params['anomaly.flatline_minutes'], params['anomaly.flatline_minutes.water_level']));
  await fresh(params);
  const detected = await detection(day, params['anomaly.flatline_minutes']);
  const allDetected = ['spike', 'out_of_range', 'outlier', 'flatline', 'disconnection'].every((k) => detected[k]);
  const result = {
    name: candidate.name, params, ingestion, periodic, detected, all_detected: allDetected,
    meets_target: ingestion.rate_pct < 5 && periodic.rate_pct < 5 && allDetected,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  console.error(`${candidate.name}: ingestion ${ingestion.rate_pct} % · periodic ${periodic.rate_pct} % · all detected ${allDetected} (${result.seconds} s)`);
  return result;
}

async function main() {
  await require('../../server/tests/globalSetup')();
  db = require('../../server/src/db');
  app = require('../../server/src/app');
  request = require('supertest');
  settings = require('../../server/src/utils/settings');
  anomalies = require('../../server/src/modules/anomalies/service');
  ({ generate } = require('../../server/scripts/seed-history'));
  const daylight = require('../../server/src/utils/daylight');
  const isDaylight = daylight.isDaylight;
  daylight.isDaylight = (date) => isDaylight(date || virtualNow || new Date());

  const end = new Date(Date.now() - 10 * 60000);
  const day = generate({ days: 1, stepMin: 5, end, faults: false }).measurements;

  const results = [];
  for (const c of CANDIDATES) results.push(await evaluate(c, day));

  // Chosen set: the smallest change that meets the target — initial jump sizes and
  // general flatline time kept, the shortest tank window that works.
  const chosen = results.filter((r) => r.meets_target
    && r.params['anomaly.jump.temperature'] === BASE['anomaly.jump.temperature']
    && r.params['anomaly.flatline_minutes'] === BASE['anomaly.flatline_minutes'])
    .sort((a, b) => a.params['anomaly.flatline_minutes.water_level'] - b.params['anomaly.flatline_minutes.water_level'])[0]
    || results.find((r) => r.meets_target) || null;

  let week = null;
  if (chosen && !process.argv.includes('--skip-week')) {
    await fresh(chosen.params);
    const t0 = Date.now();
    const days7 = generate({ days: 7, stepMin: 5, end, faults: false }).measurements;
    week = { ...(await ingestionFalsePositives(days7)), seconds: Math.round((Date.now() - t0) / 1000) };
    console.error(`7-day replay with ${chosen.name}: ${week.rate_pct} %`);
  }
  await fresh(BASE); // leave the test database with the seed values

  const report = {
    executed_at: new Date().toISOString(),
    data: { model: 'server/scripts/seed-history.js (no faults)', day_from: day[0].at.toISOString(), day_to: end.toISOString(), readings_per_day: day.length },
    target: 'false-positive rate below 5 % on normal data, every injected anomaly still detected',
    candidates: results,
    chosen: chosen ? chosen.name : null,
    chosen_params: chosen ? chosen.params : null,
    week_replay: week,
  };
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
