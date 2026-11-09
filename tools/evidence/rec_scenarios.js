#!/usr/bin/env node
'use strict';

/**
 * US20-T6 — validates the AI recommendations with ten scenarios.
 *
 * Runs on the isolated test database (fresh schema + seed). For each scenario
 * it replaces the last hour of readings of AREA-1 (and irrigation events /
 * anomalies when the scenario needs them), asks the real engine for a
 * recommendation through POST /api/recommendations/generate (force), and
 * compares the type with the expected one. Prints a JSON report.
 *
 *   node tools/evidence/rec_scenarios.js [--out file.json]
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

// Night = 23:00 in Mexico City; day = 13:00. The scenario clock is shifted so
// the "last hour" of each scenario ends at the given local time.
const SCENARIOS = [
  { id: 'S01', name: 'Dry and hot', soil: [60, 57, 55, 53, 52], soil2: -0.6, temp: 30, hum: 45, tank: 80, light: 30000, lastIrrigationH: 9, expected: 'IRRIGATE', why: 'soil below the 60 % minimum, hot and dry air' },
  { id: 'S02', name: 'Wet soil', soil: [86, 86, 85.8, 85.6, 85.5], temp: 21, hum: 65, tank: 80, light: 25000, lastIrrigationH: 2, expected: 'WAIT', why: 'soil above the maximum: never irrigate' },
  { id: 'S03', name: 'Recent irrigation', soil: [58, 58.5, 59, 59.2, 59.4], temp: 23, hum: 58, tank: 78, light: 26000, lastIrrigationH: 0.2, expected: 'WAIT', why: 'irrigated 12 min ago: the water is still soaking in (cooldown)' },
  { id: 'S04', name: 'Low water tank', soil: [58, 57, 56, 55.5, 55], temp: 24, hum: 55, tank: 12, light: 28000, lastIrrigationH: 7, expected: 'CHECK_WATER', why: 'tank below the 20 % minimum' },
  { id: 'S05', name: 'Soil sensor fault', soil: [58, 57, 56, 55.5, 55], temp: 24, hum: 55, tank: 80, light: 28000, lastIrrigationH: 7, fault: true, expected: 'CHECK_SENSOR', why: 'SM-02 reported an impossible value in the last hour' },
  { id: 'S06', name: 'Sensors disagree', soil: [70, 70, 70, 70, 70], soil2: -26, temp: 22, hum: 60, tank: 80, light: 25000, lastIrrigationH: 5, expected: 'CHECK_SENSOR', why: 'SM-01 70 % vs SM-02 44 %: more than 15 points apart' },
  { id: 'S07', name: 'Night, normal soil', soil: [66.5, 66.3, 66.2, 66.1, 66], temp: 16, hum: 72, tank: 80, light: 0, night: true, lastIrrigationH: 6, expected: 'WAIT', why: 'everything in range; darkness at night is normal' },
  { id: 'S08', name: 'Hot and humid, soil fine', soil: [70, 70, 69.8, 69.7, 69.5], temp: 29, hum: 80, tank: 80, light: 32000, lastIrrigationH: 4, expected: 'VENTILATE', why: 'temperature and humidity above their ranges; soil moisture fine' },
  { id: 'S09', name: 'Slightly dry, mild weather', soil: [61, 60.3, 59.6, 59, 58.5], temp: 22, hum: 60, tank: 80, light: 25000, lastIrrigationH: 8, expected: 'IRRIGATE', why: 'soil just below the minimum' },
  { id: 'S10', name: 'Optimal conditions', soil: [68, 68, 67.9, 67.8, 67.8], temp: 22, hum: 60, tank: 85, light: 26000, lastIrrigationH: 3, expected: 'WAIT', why: 'everything inside the optimal ranges' },
];

async function main() {
  await require('../../server/tests/globalSetup')();
  const request = require('supertest');
  const app = require('../../server/src/app');
  const db = require('../../server/src/db');
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@smartgreen.ai', password: 'Admin123!' });
  const token = login.body.access_token;
  const results = [];

  for (const s of SCENARIOS) {
    await db.query('TRUNCATE measurements, anomalies, recommendations, actuator_events, actuator_commands, alerts CASCADE');
    const now = Date.now();
    const insert = async (sensor, value, minutesAgo, anomaly = false) => db.query(
      'INSERT INTO measurements (sensor_id, value, unit, recorded_at, is_anomaly) VALUES ($1, $2, (SELECT unit FROM sensors WHERE id = $1), $3, $4) RETURNING id',
      [sensor, value, new Date(now - minutesAgo * 60000), anomaly],
    );
    // Five readings per sensor over the last hour (every 12 minutes, the last one now).
    for (let k = 0; k < 5; k += 1) {
      const ago = (4 - k) * 12;
      await insert('SM-01', s.soil[k], ago);
      await insert('SM-02', s.soil[k] + (s.soil2 ?? -0.5), ago);
      await insert('TMP-01', s.temp, ago);
      await insert('HUM-01', s.hum, ago);
      await insert('WL-01', s.tank, ago);
      await insert('LUX-01', s.light, ago);
    }
    if (s.fault) {
      const m = await insert('SM-02', 150, 20, true);
      await db.query("INSERT INTO anomalies (sensor_id, measurement_id, method, value, score, explanation) VALUES ('SM-02', $1, 'OUT_OF_RANGE', 150, 50, 'The reading 150 % is outside the physical range of the sensor (0 to 100 %).')", [m.rows[0].id]);
    }
    await db.query("INSERT INTO actuator_events (actuator_id, action, source, reason, duration_min, created_at) VALUES ('ACT-PUMP-01', 'ON', 'AUTOMATIC', 'scenario history', 5, $1)", [new Date(now - s.lastIrrigationH * 3600000)]);
    const res = await request(app).post('/api/recommendations/generate').set('Authorization', `Bearer ${token}`).send({ area_id: 'AREA-1', force: true });
    const rec = res.body[0] && res.body[0].recommendation;
    results.push({
      id: s.id, scenario: s.name, inputs: { soil: s.soil[4], soil2: Number((s.soil[4] + (s.soil2 ?? -0.5)).toFixed(1)), temperature: s.temp, humidity: s.hum, tank: s.tank, light: s.light, hours_since_irrigation: s.lastIrrigationH, sensor_fault: Boolean(s.fault) },
      expected: s.expected, why: s.why, actual: rec ? rec.type : `error ${res.status}`, agree: rec && rec.type === s.expected,
      score: rec && rec.score, confidence: rec && rec.confidence_text, duration_min: rec && rec.recommended_duration_min,
      recommendation: rec && rec.recommendation, reason: rec && rec.reason, relevant_measurements: rec && rec.relevant_measurements, factors: rec && rec.factors, created_at: rec && rec.created_at,
    });
  }
  const agree = results.filter((r) => r.agree).length;
  const report = { scenarios: results.length, agree, agreement_pct: (agree / results.length) * 100, results };
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(results.map((r) => `${r.id} ${r.scenario.padEnd(28)} expected ${r.expected.padEnd(12)} actual ${String(r.actual).padEnd(12)} ${r.agree ? 'AGREE' : 'DISAGREE'} (score ${r.score})`).join('\n'));
  console.log(`agreement ${agree}/${results.length} = ${report.agreement_pct} %`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
