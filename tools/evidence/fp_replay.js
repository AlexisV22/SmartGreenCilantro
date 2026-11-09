#!/usr/bin/env node
'use strict';

/**
 * US19-T4 — false-positive rate of the anomaly detection on 24 h of normal data.
 *
 * Loads a fresh schema + seed into the isolated test database (smartgreen_test),
 * generates 24 hours of normal greenhouse readings with the same model as
 * seed-history (no injected faults, one cycle of 8 sensors every 5 minutes),
 * replays them in time order through the real ingestion endpoint
 * (POST /api/measurements with the device API key), then counts every anomaly
 * the detection recorded. Prints a JSON report.
 *
 *   node tools/evidence/fp_replay.js [--out file.json]
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

async function main() {
  await require('../../server/tests/globalSetup')();
  const request = require('supertest');
  const app = require('../../server/src/app');
  const db = require('../../server/src/db');
  const { generate } = require('../../server/scripts/seed-history');

  const end = new Date(Date.now() - 10 * 60000);
  const { measurements } = generate({ days: 1, stepMin: 5, end, faults: false });
  const cycles = new Map();
  for (const m of measurements) {
    const k = m.at.toISOString();
    if (!cycles.has(k)) cycles.set(k, []);
    cycles.get(k).push({ device_id: 'dev-node-01', sensor_id: m.sensorId, value: m.value, unit: m.unit, recorded_at: k });
  }
  const started = Date.now();
  let accepted = 0;
  let rejected = 0;
  for (const batch of cycles.values()) {
    const res = await request(app).post('/api/measurements').set('apikey', 'sec_iot_dev_node_01_smartgreen_team3').send(batch);
    accepted += res.body.accepted || 0;
    rejected += res.body.rejected || 0;
  }
  const byMethod = await db.rows('SELECT method, COUNT(*)::int AS n FROM anomalies GROUP BY method ORDER BY method');
  const bySensor = await db.rows('SELECT sensor_id, method, COUNT(*)::int AS n FROM anomalies GROUP BY sensor_id, method ORDER BY sensor_id, method');
  const examples = await db.rows('SELECT sensor_id, method, value, round(score, 2) AS score, explanation, detected_at FROM anomalies ORDER BY detected_at LIMIT 10');
  const flagged = (await db.one('SELECT COUNT(*)::int AS n FROM measurements WHERE is_anomaly'))?.n || 0;
  const total = byMethod.reduce((s, r) => s + r.n, 0);
  const report = {
    window: { from: measurements[0].at.toISOString(), to: end.toISOString(), hours: 24, step_minutes: 5 },
    cycles: cycles.size,
    readings_sent: measurements.length,
    accepted,
    rejected,
    anomalies_total: total,
    readings_flagged_invalid: flagged,
    false_positive_rate_pct: Number(((total / accepted) * 100).toFixed(3)),
    invalidated_rate_pct: Number(((flagged / accepted) * 100).toFixed(3)),
    by_method: byMethod,
    by_sensor: bySensor,
    examples,
    replay_seconds: Math.round((Date.now() - started) / 1000),
  };
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
