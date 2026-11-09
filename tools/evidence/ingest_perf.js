#!/usr/bin/env node
'use strict';

/**
 * US11-T8 — ingestion performance with and without alert evaluation.
 *
 * Loads a fresh schema + seed into the isolated test database
 * (smartgreen_test) plus 24 h of normal history for SM-01 (so the z-score
 * check works on a realistic window), starts the real API on a free port and
 * runs the IoT simulator against it twice with the same burst:
 * 120 POST /api/measurements in under 60 s (one reading every 0.45 s, scenario
 * "alerts": odd cycles leave the range and raise an alert, even cycles
 * resolve it).
 *
 *   run 1  with alert evaluation (the production code path)
 *   run 2  without alert evaluation (evaluateMeasurement replaced by a no-op)
 *
 * The response times are the round trips measured by the simulator itself.
 * A 10-request warm-up runs first and is discarded.
 *
 *   node tools/evidence/ingest_perf.js [--out file.json] [--logdir dir]
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/smartgreen_test';
process.env.TEST_DATABASE_URL = url.toString();
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = 'test';
process.env.JOBS_ENABLED = 'false';

const ROOT = path.resolve(__dirname, '../..');
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);

function simulate(port, count, interval) {
  return new Promise((resolve) => {
    const child = spawn('node', ['iot/simulator/simulator.js', '--url', `http://127.0.0.1:${port}/api`, '--scenario', 'alerts',
      '--sensors', 'SM-01', '--interval', String(interval), '--count', String(count), '--poll', '5'], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

function summarise(label, sim, started, ended) {
  const delays = [...sim.out.matchAll(/stored in (\d+) ms/g)].map((m) => Number(m[1]));
  const sorted = [...delays].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const accepted = sim.out.match(/accepted by the API: (\d+)/);
  return {
    label,
    requests: delays.length,
    measurements_accepted: accepted ? Number(accepted[1]) : null,
    duration_s: Math.round((ended - started) / 100) / 10,
    avg_ms: Math.round((delays.reduce((s, d) => s + d, 0) / delays.length) * 10) / 10,
    median_ms: pct(50),
    p95_ms: pct(95),
    max_ms: sorted[sorted.length - 1],
    min_ms: sorted[0],
    new_alerts: [...sim.out.matchAll(/(\d+) new alert/g)].reduce((s, m) => s + Number(m[1]), 0),
  };
}

async function main() {
  await require('../../server/tests/globalSetup')();
  const db = require('../../server/src/db');
  const app = require('../../server/src/app');
  const alertsService = require('../../server/src/modules/alerts/service');
  const { generate } = require('../../server/scripts/seed-history');

  // 24 h of normal history for SM-01 (one reading every 5 minutes).
  const { measurements } = generate({ days: 1, stepMin: 5, end: new Date(Date.now() - 5 * 60000), faults: false });
  const sm = measurements.filter((m) => m.sensorId === 'SM-01');
  await db.query(
    `INSERT INTO measurements (sensor_id, value, unit, recorded_at)
     SELECT 'SM-01', v, '%', t FROM unnest($1::numeric[], $2::timestamptz[]) AS x(v, t)`,
    [sm.map((m) => m.value), sm.map((m) => m.at.toISOString())],
  );

  const server = app.listen(0);
  const { port } = server.address();
  const COUNT = Number(arg('--count', 120));
  const INTERVAL = Number(arg('--interval', 0.45));

  await simulate(port, 10, 0.2); // warm-up, discarded

  const original = alertsService.evaluateMeasurement;
  const runs = [];
  const logs = {};
  for (const [label, evaluate] of [['with alert evaluation', original], ['without alert evaluation', null]]) {
    alertsService.evaluateMeasurement = evaluate || (async () => ({ created: false, resolved: false, alert: null }));
    const before = (await db.one('SELECT COUNT(*)::int AS n FROM alerts')).n;
    const started = Date.now();
    const sim = await simulate(port, COUNT, INTERVAL);
    const ended = Date.now();
    const summary = summarise(label, sim, started, ended);
    summary.alerts_in_db = (await db.one('SELECT COUNT(*)::int AS n FROM alerts')).n - before;
    runs.push(summary);
    logs[label] = sim.out;
  }
  alertsService.evaluateMeasurement = original;
  server.close();

  const [withEval, withoutEval] = runs;
  const report = {
    executed_at: new Date().toISOString(),
    burst: { requests: COUNT, interval_s: INTERVAL, sensors: ['SM-01'], scenario: 'alerts', history_readings: sm.length },
    runs,
    overhead_avg_ms: Math.round((withEval.avg_ms - withoutEval.avg_ms) * 10) / 10,
    limit_avg_ms: 500,
    pass: withEval.avg_ms < 500,
  };
  const out = arg('--out', null);
  const logdir = arg('--logdir', null);
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  if (logdir) {
    fs.writeFileSync(path.join(logdir, 'ingest_perf_with.log'), logs['with alert evaluation']);
    fs.writeFileSync(path.join(logdir, 'ingest_perf_without.log'), logs['without alert evaluation']);
  }
  console.log(JSON.stringify(report, null, 2));
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
