'use strict';

/**
 * Sprint 3 evidence (October 12 – October 30, 2026): US-11, US-12, US-13,
 * US-15, US-16, US-17, US-19 and the sprint-level tasks.
 */

const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { classifySeverity, deviationPercent } = require('../../server/src/modules/alerts/service');

const P = L.proof;
const { APPROVAL } = require('./board_sprint3');

const UNIT = { 'SM-01': '%', 'SM-02': '%', 'TMP-01': 'C', 'HUM-01': '%', 'LUX-01': 'lux', 'CO2-01': 'ppm', 'WL-01': '%', 'PH-01': 'pH' };
const ACT_PANEL = 'section.card:has(h2:has-text("Actuators"))';

async function T(ctx, key, fn) {
  if (ctx.only && ctx.only !== key) return;
  const t = L.begin(key);
  try {
    await fn(t);
    // Approval records quote the Sprint 3 meeting records (board numbering).
    const id = key.split(':')[1];
    if (APPROVAL[id]) L.approval(key, APPROVAL[id]);
    console.log(`  ✔ ${key}`);
  } catch (e) {
    console.error(`  ✖ ${key}: ${e.stack}`);
    L.note(key, `Collector error while capturing this evidence: ${e.message}`);
  }
}

/** Send readings as dev-node-01: [[sensor, value, minutesAgo?], …] */
async function send(readings) {
  const now = Date.now();
  const body = readings.map(([sensor, value, minutesAgo = 0]) => ({ device_id: 'dev-node-01', sensor_id: sensor, value, unit: UNIT[sensor], recorded_at: new Date(now - minutesAgo * 60000).toISOString() }));
  return L.call('POST', '/api/measurements', { as: 'device', body: body.length === 1 ? body[0] : body });
}
const alertOf = (res, sensor) => {
  const rows = Array.isArray(res.body.results) ? res.body.results : [res.body];
  const r = rows.filter((x) => x.sensor_id === sensor && x.alert).pop();
  return r ? r.alert : null;
};
const setMode = (mode) => L.call('PATCH', '/api/areas/AREA-1/mode', { as: 'admin', body: { mode } });
const irrigationConfig = (body) => L.call('PUT', '/api/irrigation/config/AREA-1', { as: 'admin', body });
const setParam = (key, value) => L.call('PUT', '/api/settings/global', { as: 'superadmin', body: { parameters: { [key]: value } } });
const waitFor = async (fn, timeoutMs = 60000, stepMs = 2000) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await L.sleep(stepMs);
  }
};
// --- Automated test tasks of Week 3 ------------------------------------------
// A database URL nobody listens on: the unit suites must pass without PostgreSQL.
const NO_DB = 'postgresql://nobody:none@127.0.0.1:1/no_database';

/**
 * Run Jest on some test files with JSON output. `noDb` uses a Jest config
 * without the database global setup and an unreachable DATABASE_URL.
 */
async function jestRun(ctx, t, files, { noDb = false } = {}) {
  const json = path.join(ctx.OUT, `jest_${t.id}.json`);
  if (fs.existsSync(json)) fs.unlinkSync(json);
  const args = ['jest', '--runInBand', '--verbose', '--json', `--outputFile=${json}`];
  let env = {};
  let config = null;
  if (noDb) {
    const cfg = path.join(ctx.OUT, 'jest_nodb.config.js');
    config = { rootDir: L.ROOT, testEnvironment: 'node', testMatch: ['<rootDir>/server/tests/unit/**/*.test.js'] };
    fs.writeFileSync(cfg, `// Unit suites only: no globalSetup (no test database), unreachable DATABASE_URL.\nmodule.exports = ${JSON.stringify(config, null, 2)};\n`);
    args.push('--config', cfg);
    env = { DATABASE_URL: NO_DB, TEST_DATABASE_URL: NO_DB };
  }
  const r = await L.run('npx', [...args, ...files], { env });
  L.must(fs.existsSync(json), `Jest JSON report for ${files.join(', ')}`);
  const res = JSON.parse(fs.readFileSync(json, 'utf8'));
  const tests = res.testResults.flatMap((f) => f.assertionResults.map((a) => ({ ...a, file: path.relative(L.ROOT, f.name).replace(/\\/g, '/') })));
  return {
    out: r.out, code: r.code, tests, config, noDb,
    summary: (r.out.match(/^Tests:.*$/m) || [`Tests: ${res.numPassedTests} passed, ${res.numTotalTests} total`])[0].trim(),
    passed: r.code === 0 && res.numFailedTests === 0 && res.numPassedTests > 0,
  };
}

/** Test case table: one row per automated test. */
const testRows = (run, prefix) => run.tests.map((x, i) => ({
  id: `${prefix}-${String(i + 1).padStart(2, '0')}`, case: x.title, steps: x.ancestorTitles.join(' › '),
  input: x.file.split('/').pop(), expected: 'passes', actual: `${x.status} (${x.duration ?? 0} ms)`,
  result: x.status === 'passed' ? 'PASS' : 'FAIL',
}));
const testsLike = (run, re) => run.tests.filter((x) => re.test(`${x.ancestorTitles.join(' ')} ${x.title}`));
const statusOf = (list) => (list.length && list.every((x) => x.status === 'passed') ? `${list.length} passed` : `${list.filter((x) => x.status === 'passed').length}/${list.length} passed`);

/** "All tests pass and are committed": the run result plus the git state of the files. */
async function passAndCommitted(t, index, run, files, jestFile) {
  const log = (await L.run('git', ['log', '-3', '--date=short', '--format=%h %ad %an — %s', '--', ...files])).out.trim();
  const status = (await L.run('git', ['status', '--porcelain', '--', ...files])).out.trim();
  const output = P.block(`Jest — ${files.join(', ')}${run.noDb ? ' (without database)' : ''}`, run.out.trim().split('\n').slice(-60).join('\n'), jestFile);
  L.must(run.passed, `every test of ${files.join(', ')} passes (${run.summary})`);
  const passText = `All tests pass: ${run.summary} (exit code ${run.code}).`;
  if (log && !status) {
    L.condition(t.key, index, `${passText} The test files are committed to the repository (last commit: ${log.split('\n')[0]}).`, [output, P.block('git log of the test files', log)]);
  } else {
    L.condition(t.key, index, passText, [output, P.block('git status of the test files', status || '(no changes)')], {
      pending: `The test files are in the working tree but not committed yet (${files.join(', ')}). Commit them and re-run: node tools/evidence/run_all.js --only ${t.key}`,
    });
  }
}

/** Bring the four main sensors back into range (gradually enough to avoid jump faults). */
async function normal() {
  await send([['SM-01', 66], ['SM-02', 65.5], ['TMP-01', 22], ['HUM-01', 60], ['WL-01', 80], ['CO2-01', 600]]);
}

module.exports = async function sprint3(ctx) {
  // Start from a controlled situation: MANUAL mode (the engine is shown on its own in US-16), values in range.
  if (!ctx.only) {
    await setMode('MANUAL');
    await L.device.exclusive(async () => { await L.device.execute(); await normal(); });
  }

  // =========================================================================
  // US-11 — Receive threshold alerts
  // =========================================================================
  await T(ctx, '3:US11-T1', async (t) => {
    const er = await L.renderMermaid(t, 'er_alerts', `erDiagram
  SENSORS ||--o{ ALERTS : raises
  THRESHOLDS ||--o{ ALERTS : "evaluated against"
  USERS ||--o{ ALERTS : acknowledges
  ALERTS {
    text id PK
    text sensor_id FK
    text threshold_id FK
    text type "LOW HIGH DEVICE_OFFLINE LOW_WATER ANOMALY"
    numeric value
    text severity "LOW MEDIUM HIGH"
    text status "OPEN ACKNOWLEDGED RESOLVED"
    numeric deviation_pct
    timestamptz created_at
    text acknowledged_by FK
    timestamptz resolved_at
  }`, 'Alert entity added to the shared ER diagram.');
    const flow = await L.renderMermaid(t, 'alert_rules', `flowchart TD
  M[New measurement stored] --> F{Sensor fault?<br/>out of physical range<br/>or sudden jump}
  F -- yes --> X[No threshold alert<br/>anomaly recorded instead]
  F -- no --> T{Compare with the threshold<br/>of its type and area}
  T -- value < min --> L[LOW condition]
  T -- value > max --> H[HIGH condition]
  T -- inside range --> R[Resolve the open alert<br/>status RESOLVED, resolved_at = now]
  L & H --> O{Open or acknowledged alert<br/>for this sensor and type?}
  O -- no --> N[Create alert OPEN<br/>with severity]
  O -- yes --> U[Keep the same alert<br/>upgrade severity if the deviation grew]`, 'Alert rules: LOW/HIGH, de-duplication and automatic resolution.');
    const cols = await L.sqlProof(t, 'Alert fields in the database', "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'alerts' ORDER BY ordinal_position");
    const idx = await L.sqlProof(t, 'De-duplication enforced by the database (one open alert per sensor and type)', "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'alerts' AND indexname LIKE 'uq_%'");
    L.condition(t.key, 1, 'The alert fields (id, sensor_id, threshold_id, type LOW/HIGH, value, severity, status OPEN/ACKNOWLEDGED/RESOLVED, created_at, resolved_at, plus who acknowledged it) are in the shared ER diagram and in the alerts table.', [er, cols.proof]);
    L.condition(t.key, 2, 'Rules: below the minimum → LOW alert; above the maximum → HIGH alert; only one open (or acknowledged) alert per sensor and type, guaranteed by a unique partial index; the alert resolves itself when the value returns to the range.', [flow, idx.proof, P.code('server/src/modules/alerts/service.js', 'async function evaluateMeasurement', 30)]);
    L.condition(t.key, 3, 'The design was reviewed by Carlos, owner of US-12 (severity) and US-13 (history) (approval record).', []);
    L.condition(t.key, 4, 'Alert data model and rule description reviewed by the team.', []);
  });

  await T(ctx, '3:US11-T4', async (t) => {
    await L.device.exclusive(async () => {
      await normal();
      const start = new Date();
      const simOut = await L.run('node', ['iot/simulator/simulator.js', '--scenario', 'alerts', '--interval', '4', '--count', '2']);
      const simLog = L.saveFile(t, 'log', simOut.out);
      const created = await L.sqlProof(t, 'Alerts created by the out-of-range cycle and resolved by the next cycle (simulator)', `SELECT id, sensor_id, type, severity, status, value, created_at, resolved_at FROM alerts WHERE created_at >= $1 ORDER BY created_at`, [start]);
      // Repeated out-of-range values: no duplicate.
      await send([['SM-01', 62]]);
      const r1 = await send([['SM-01', 58]]);
      const r2 = await send([['SM-01', 57.4]]);
      const r3 = await send([['SM-01', 57.1]]);
      const dup = await L.sqlProof(t, 'Repeated out-of-range readings of SM-01: one alert only', "SELECT id, type, severity, status, value, created_at FROM alerts WHERE sensor_id = 'SM-01' AND status <> 'RESOLVED'");
      const back = await send([['SM-01', 66]]);
      await L.sleep(400);
      const resolved = await L.sqlProof(t, 'After returning to range: status RESOLVED and resolved_at filled', 'SELECT id, status, created_at, resolved_at FROM alerts WHERE id = $1', [alertOf(r1, 'SM-01').id]);
      const logs = await L.sqlProof(t, 'Engine log (system_logs, source alerts)', "SELECT created_at, level, message FROM system_logs WHERE source = 'alerts' AND created_at >= $1 ORDER BY created_at", [start], 12);
      const times = [r1, r2, r3, back].map((c) => c.ms);
      L.condition(t.key, 1, 'The simulator (scenario "alerts", first cycle) sent values outside the range; each one created an OPEN alert (LOW for soil moisture and humidity, HIGH for temperature).', [P.block('Simulator log', simOut.out.trim(), simLog), created.proof]);
      L.condition(t.key, 2, `Three consecutive out-of-range readings of SM-01 (58, 57.4, 57.1 %) returned the same alert id ${alertOf(r1, 'SM-01').id} with created = ${[r1, r2, r3].map((r) => alertOf(r, 'SM-01').created).join(', ')}.`, [L.saveCalls(t, 'Repeated out-of-range readings', [r1, r2, r3], 14), dup.proof]);
      L.condition(t.key, 3, 'Returning to range resolved the alert and filled resolved_at (the simulator\'s second cycle did the same for the alerts of its first cycle).', [resolved.proof, L.saveCalls(t, 'Back in range', [back], 14)]);
      L.condition(t.key, 4, `Database records and the engine log above show alerts created and resolved from simulator values. The evaluation runs in the same request as the ingestion and does not slow it down noticeably: response times of the four calls ${times.join(', ')} ms.`, [logs.proof]);
    });
  });

  await T(ctx, '3:US11-T5', async (t) => {
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '.sensor-card');
    let sentAt;
    await L.device.exclusive(async () => {
      await send([['SM-01', 61]]);
      sentAt = Date.now();
      await send([['SM-01', 57.2]]);
    });
    await page.waitForSelector('.banner.danger, .banner.warn', { timeout: 45000 });
    const seenAfter = Math.round((Date.now() - sentAt) / 1000);
    await page.waitForTimeout(400);
    const banner = await L.shot(t, page, `Active alert on the dashboard ${seenAfter} s after the measurement (no reload): top banner and alerts panel.`, { fullPage: false });
    const panel = await L.shot(t, page, 'Alerts panel: sensor, value, threshold and time in plain language, with the Acknowledge button.', { selector: '#alerts-panel' });
    await page.locator('#alerts-panel button:has-text("Acknowledge")').first().click();
    await page.waitForSelector('.toast.ok');
    await page.waitForTimeout(800);
    const acked = await L.shot(t, page, 'After pressing Acknowledge: the alert is marked "Acknowledged".', { selector: '#alerts-panel' });
    const msg = (await page.locator('#alerts-panel').innerText()).split('\n').find((l) => /soil moisture/i.test(l)) || '';
    await context.close();
    const row = await L.sqlProof(t, 'Acknowledgement stored with user and time', "SELECT a.id, a.status, a.message, u.email AS acknowledged_by, a.acknowledged_at FROM alerts a LEFT JOIN users u ON u.id = a.acknowledged_by WHERE a.sensor_id = 'SM-01' AND a.status = 'ACKNOWLEDGED' ORDER BY a.created_at DESC LIMIT 1");
    await L.device.exclusive(() => send([['SM-01', 66]]));
    L.condition(t.key, 1, `The alert appeared on the open dashboard ${seenAfter} s after the measurement (the dashboard refreshes every 30 s).`, [banner]);
    L.condition(t.key, 2, 'The producer acknowledged the alert from the panel; the database stores who and when.', [panel, acked, row.proof]);
    L.condition(t.key, 3, `The message is plain language, for example: "${msg.trim()}". It names the variable, the area, the measured value and the configured limit, with severity and status shown as colour + icon + text.`, [P.code('server/src/modules/alerts/service.js', 'const VARIABLE_LABEL', 12)]);
    L.condition(t.key, 4, 'Screenshots of the dashboard with an active alert and with the alert acknowledged (Figures 1–3).', []);
  });

  await T(ctx, '3:US11-T7', async (t) => {
    const rows = [];
    await L.device.exclusive(async () => {
      await normal();
      const low = await send([['SM-01', 57]]);
      const a1 = alertOf(low, 'SM-01');
      rows.push({ id: 'AL-01', case: 'Value below minimum', steps: 'Send SM-01 below 60 %', input: 'SM-01 = 57 %', expected: 'OPEN LOW alert', actual: a1 ? `${a1.type} ${a1.severity}, created ${a1.created}` : 'no alert', result: a1 && a1.type === 'LOW' && a1.created ? 'PASS' : 'FAIL' });
      await send([['TMP-01', 24]]);
      const high = await send([['TMP-01', 26.2]]);
      const a2 = alertOf(high, 'TMP-01');
      rows.push({ id: 'AL-02', case: 'Value above maximum', steps: 'Send TMP-01 above 25 °C', input: 'TMP-01 = 26.2 °C', expected: 'OPEN HIGH alert', actual: a2 ? `${a2.type} ${a2.severity}, created ${a2.created}` : 'no alert', result: a2 && a2.type === 'HIGH' && a2.created ? 'PASS' : 'FAIL' });
      const inr = await send([['HUM-01', 61]]);
      rows.push({ id: 'AL-03', case: 'Value in range', steps: 'Send HUM-01 inside 50–70 %', input: 'HUM-01 = 61 %', expected: 'no alert', actual: alertOf(inr, 'HUM-01') ? 'alert' : 'no alert', result: alertOf(inr, 'HUM-01') ? 'FAIL' : 'PASS' });
      const rep = await send([['SM-01', 56.8]]);
      const a4 = alertOf(rep, 'SM-01');
      rows.push({ id: 'AL-04', case: 'Repeated out-of-range (no duplicate)', steps: 'Send SM-01 below min again', input: 'SM-01 = 56.8 %', expected: 'same alert, not created', actual: a4 ? `id ${a4.id === a1.id ? 'same' : 'different'}, created ${a4.created}` : 'no alert', result: a4 && a4.id === a1.id && !a4.created ? 'PASS' : 'FAIL' });
      await send([['SM-01', 66], ['TMP-01', 22.5]]);
      await L.sleep(400);
      const res = await L.sql('SELECT id, status, resolved_at FROM alerts WHERE id = ANY($1)', [[a1.id, a2.id]]);
      rows.push({ id: 'AL-05', case: 'Return to range (resolved)', steps: 'Send SM-01 and TMP-01 back in range', input: 'SM-01 66 %, TMP-01 22.5 °C', expected: 'both RESOLVED with resolved_at', actual: res.map((r) => `${r.status}${r.resolved_at ? ' ✓ resolved_at' : ''}`).join(', '), result: res.every((r) => r.status === 'RESOLVED' && r.resolved_at) ? 'PASS' : 'FAIL' });
    });
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/alerts.html', 'table');
    const hist = await L.shot(t, page, 'Alert history after the five cases: the LOW and HIGH alerts appear as Resolved.');
    await context.close();
    const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/integration/thresholds-alerts.test.js']);
    const jf = L.saveFile(t, 'txt', jest.out);
    L.condition(t.key, 1, 'The five cases were executed against the running system: below min, above max, in range, repeated out-of-range and return to range.', [hist]);
    L.condition(t.key, 2, `Every case has a pass/fail result (test table: ${rows.filter((r) => r.result === 'PASS').length}/${rows.length} PASS). The automated alert tests of the repository were also run: ${(jest.out.match(/Tests:.*$/m) || [''])[0]}.`, [P.block('Jest — thresholds and alerts suite (excerpt)', jest.out.split('\n').slice(0, 30).join('\n'), jf)]);
    L.condition(t.key, 3, rows.every((r) => r.result === 'PASS') ? 'No defect was found in this execution. A defect found while building the engine (a statistical outlier suppressed real threshold alerts) was fixed before this run; see the Sprint 3 integration test (SPR-T1).' : 'The failed cases were registered for correction.', []);
    L.condition(t.key, 4, 'Test case table with results and screenshots.', []);
    L.testCases(t.key, rows, 'Alert generation test cases');
  });

  // =========================================================================
  // US-12 — Classify alerts by severity
  // =========================================================================
  await T(ctx, '3:US12-T1', async (t) => {
    const params = await L.sqlProof(t, 'Configured limits (system_parameters)', "SELECT key, value, description FROM system_parameters WHERE key LIKE 'severity.%' ORDER BY key");
    const th = await L.sql("SELECT sensor_type, min_value, max_value, unit FROM thresholds WHERE area_id = 'AREA-1' ORDER BY sensor_type");
    const examples = th.map((r) => {
      const range = Number(r.max_value) - Number(r.min_value);
      const v = Number((Number(r.max_value) + range * 0.18).toFixed(2));
      const pct = deviationPercent(v, Number(r.min_value), Number(r.max_value));
      return [r.sensor_type, `${r.min_value}–${r.max_value} ${r.unit}`, `${range} ${r.unit}`, `${v} ${r.unit}`, `${pct.toFixed(1)} %`, classifySeverity(pct, 10, 25)];
    });
    L.condition(t.key, 1, 'Formula: deviation % = distance of the value outside the optimal range ÷ (max − min) × 100, where the distance is (min − value) below the range or (value − max) above it. Severity: LOW ≤ 10 %, MEDIUM ≤ 25 %, HIGH > 25 %. The limits are system parameters, so they can be adjusted without code changes.', [params.proof, P.code('server/src/modules/alerts/service.js', 'function classifySeverity', 14)]);
    L.condition(t.key, 2, 'The percentages were approved by the Product Owner (approval record).', []);
    L.condition(t.key, 3, 'One example per variable (a value 18 % of the range above the maximum), computed with the implemented functions:', [P.table('Examples per variable', ['Variable', 'Optimal range', 'Range width', 'Example value', 'Deviation', 'Severity'], examples, [1600, 1800, 1300, 1500, 1300, 1860])]);
    L.condition(t.key, 4, 'Severity rules table approved by the PO.', []);
  });

  await T(ctx, '3:US12-T2', async (t) => {
    let ids = {};
    await L.device.exclusive(async () => {
      await normal();
      await send([['SM-01', 61]]);
      const low = await send([['SM-01', 58.5]]); // 7.5 %
      await send([['TMP-01', 24]]);
      const med = await send([['TMP-01', 27]]); // 20 %
      await send([['HUM-01', 50]]);
      const high = await send([['HUM-01', 44]]); // 30 %
      ids = { low: alertOf(low, 'SM-01'), med: alertOf(med, 'TMP-01'), high: alertOf(high, 'HUM-01') };
    });
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/alerts.html', 'table');
    await page.selectOption('#f-status', 'OPEN');
    await page.click('button:has-text("Apply filters")');
    await page.waitForTimeout(800);
    const three = await L.shot(t, page, 'Alert history filtered to OPEN alerts: the three severity levels Low (▼ blue), Medium (■ orange) and High (▲ red), each with colour, icon and text.');
    await L.goto(page, '/producer/', '#alerts-panel');
    const dash = await L.shot(t, page, 'The same three alerts in the dashboard alerts panel.', { selector: '#alerts-panel' });
    await context.close();
    // Upgrade while open.
    let steps = [];
    await L.device.exclusive(async () => {
      const a = await send([['SM-01', 56.5]]);
      const b = await send([['SM-01', 54.2]]);
      steps = [['58.5 %', '7.5 %', ids.low.severity], ['56.5 %', '17.5 %', alertOf(a, 'SM-01').severity], ['54.2 %', '29 %', alertOf(b, 'SM-01').severity]];
      await send([['SM-01', 60.5], ['TMP-01', 24.5], ['HUM-01', 52]]);
      await send([['SM-01', 66], ['TMP-01', 22], ['HUM-01', 60]]);
    });
    const all = await L.sqlProof(t, 'Every alert created in the test has a severity', 'SELECT id, sensor_id, type, severity, deviation_pct, status FROM alerts WHERE id = ANY($1)', [[ids.low.id, ids.med.id, ids.high.id]]);
    L.condition(t.key, 1, `Every new alert gets a severity when it is created: SM-01 at 58.5 % → ${ids.low.severity}, TMP-01 at 27 °C → ${ids.med.severity}, HUM-01 at 44 % → ${ids.high.severity}.`, [all.proof]);
    L.condition(t.key, 2, 'While the SM-01 alert was open, the soil kept drying and the same alert was upgraded:', [P.table('Severity upgrade of one open alert', ['Reading', 'Deviation', 'Severity of the alert'], steps, [3000, 3000, 3360]), P.code('server/src/modules/alerts/service.js', 'upgrade', 14)]);
    L.condition(t.key, 3, 'The badge shows colour, icon and text (never colour only).', [three, dash, P.code('public/js/ui.js', 'export function severityBadge', 5)]);
    L.condition(t.key, 4, 'Screenshots with the three severity levels (Figures 1–2).', []);
  });

  await T(ctx, '3:US12-T4', async (t) => {
    const rows = [];
    const cases = [
      ['SM-01', 58.2, 9, 'LOW', 62], ['SM-01', 58.0, 10, 'LOW', 62], ['SM-01', 57.8, 11, 'MEDIUM', 62],
      ['SM-01', 55.2, 24, 'MEDIUM', 60.5], ['SM-01', 55.0, 25, 'MEDIUM', 60.5], ['SM-01', 54.8, 26, 'HIGH', 60.5],
      ['TMP-01', 25.9, 9, 'LOW', 24], ['TMP-01', 26.0, 10, 'LOW', 24], ['TMP-01', 26.1, 11, 'MEDIUM', 24],
      ['TMP-01', 27.4, 24, 'MEDIUM', 24], ['TMP-01', 27.5, 25, 'MEDIUM', 24], ['TMP-01', 27.6, 26, 'HIGH', 24],
    ];
    await L.device.exclusive(async () => {
      await normal();
      let n = 0;
      for (const [sensor, value, pct, expected, approach] of cases) {
        await send([[sensor, approach]]); // back in range first (closes the previous alert)
        const r = await send([[sensor, value]]);
        const a = alertOf(r, sensor);
        n += 1;
        rows.push({ id: `SV-${String(n).padStart(2, '0')}`, case: `${sensor === 'SM-01' ? 'Soil moisture 60–80 %' : 'Temperature 15–25 °C'} at ${pct} %`, steps: `Send ${approach} (in range), then the boundary value`, input: `${sensor} = ${value}`, expected, actual: a ? `${a.severity} (new alert ${a.created})` : 'no alert', result: a && a.severity === expected && a.created ? 'PASS' : 'FAIL' });
      }
      await send([['SM-01', 66], ['TMP-01', 22]]);
    });
    const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/unit/severity.test.js']);
    const jf = L.saveFile(t, 'txt', jest.out);
    const csv = L.saveFile(t, 'csv', ['id,case,input,expected,actual,result', ...rows.map((r) => [r.id, r.case, r.input, r.expected, r.actual, r.result].map((v) => `"${v}"`).join(','))].join('\n'));
    L.condition(t.key, 1, 'Boundary values 9, 10, 11, 24, 25 and 26 % were sent for soil moisture (range 60–80 %) and temperature (range 15–25 °C) through the device API, with the protocol of the simulator; before each value the sensor was brought back into range so every case created a new alert.', []);
    L.condition(t.key, 2, `${rows.filter((r) => r.result === 'PASS').length} of ${rows.length} cases passed. Exactly 10 % is LOW and exactly 25 % is MEDIUM (limits are inclusive). The unit tests of the classification were also run: ${(jest.out.match(/Tests:.*$/m) || [''])[0]}.`, [P.block('Jest — severity unit tests', jest.out.trim(), jf)]);
    L.condition(t.key, 3, `Results saved in the evidence folder (${csv} and the test table).`, []);
    L.condition(t.key, 4, 'Test table with boundary cases and results.', []);
    L.testCases(t.key, rows, 'Severity boundary tests (real alerts)');
  });

  // =========================================================================
  // US-13 — View alert history
  // =========================================================================
  await T(ctx, '3:US13-T1', async (t) => {
    const q = async (qs) => L.call('GET', `/api/alerts?${qs}`, { as: 'producer' });
    const from = new Date(Date.now() - 3 * 3600000).toISOString();
    const cases = [
      ['status=RESOLVED', (b) => b.data.every((a) => a.status === 'RESOLVED')],
      ['severity=HIGH', (b) => b.data.every((a) => a.severity === 'HIGH')],
      ['sensor_id=SM-01', (b) => b.data.every((a) => a.sensor_id === 'SM-01')],
      [`from=${encodeURIComponent(from)}`, (b) => b.data.every((a) => a.created_at >= from)],
      [`to=${encodeURIComponent(from)}`, (b) => b.data.every((a) => a.created_at <= from)],
      [`status=RESOLVED&severity=LOW&sensor_id=SM-01&from=${encodeURIComponent(from)}`, (b) => b.data.every((a) => a.status === 'RESOLVED' && a.severity === 'LOW' && a.sensor_id === 'SM-01')],
    ];
    const rows = [];
    const calls = [];
    for (const [qs, check] of cases) {
      const c = await q(`${qs}&limit=50`);
      calls.push(c);
      rows.push([decodeURIComponent(qs), String(c.status), String(c.body.total), check(c.body) ? 'PASS' : 'FAIL']);
    }
    const all = await q('limit=100');
    const ordered = all.body.data.every((a, i, arr) => i === 0 || arr[i - 1].created_at >= a.created_at);
    const p1 = await q('limit=5&offset=0');
    const p2 = await q('limit=5&offset=5');
    const noOverlap = p1.body.data.every((a) => !p2.body.data.some((b) => b.id === a.id));
    const roles = [];
    for (const role of ['producer', 'admin', 'superadmin']) roles.push(`${role}: HTTP ${(await L.call('GET', '/api/alerts?limit=1', { as: role })).status}`);
    L.condition(t.key, 1, 'Every filter was tested alone and all of them combined; the returned rows always satisfy the filter.', [P.table('Filtered queries', ['Query', 'HTTP', 'Total', 'Rows satisfy the filter'], rows, [5200, 900, 1100, 2160]), L.saveCalls(t, 'Filtered queries (Postman-equivalent calls)', calls, 10)]);
    L.condition(t.key, 2, `Results are ordered newest first (checked on ${all.body.data.length} rows: ${ordered}).`, [P.code('server/src/modules/alerts/service.js', 'ORDER BY a.created_at DESC', 3)]);
    L.condition(t.key, 3, `Pagination works with limit/offset: page 1 and page 2 of size 5 do not overlap (${noOverlap}); total = ${p1.body.total}. Readable by ${roles.join(', ')}.`, [L.saveCalls(t, 'Pagination', [p1, p2], 12)]);
    L.condition(t.key, 4, 'Results of the filtered queries (the same requests are in the Postman collection, folder 07).', []);
  });

  await T(ctx, '3:US13-T3', async (t) => {
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/alerts.html', 'table');
    const all = await L.shot(t, page, 'Alert history: date, severity, status, type, sensor, value, message, acknowledgement and resolution time.');
    await page.selectOption('#f-sensor', 'SM-01');
    await page.selectOption('#f-status', 'RESOLVED');
    await page.click('button:has-text("Apply filters")');
    await page.waitForTimeout(800);
    const filtered = await L.shot(t, page, 'Filters applied (sensor SM-01, status Resolved): the table updates.');
    const shown = await page.locator('.pager span').first().textContent();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export CSV")')]);
    const tmp = path.join(ctx.OUT, 'alerts_export.csv');
    await download.saveAs(tmp);
    await context.close();
    const csvName = L.copyFile(t, tmp, 'csv');
    const csv = fs.readFileSync(tmp, 'utf8').trim().split('\n');
    const onlyFilter = csv.slice(1).every((l) => l.includes('SM-01') && l.includes('RESOLVED'));
    L.condition(t.key, 1, 'The table shows date, sensor, variable (type), value, severity, status and resolved at (plus the message and acknowledgement).', [all]);
    L.condition(t.key, 2, `Filters update the table (${shown.trim()}).`, [filtered]);
    L.condition(t.key, 3, `The Export CSV button downloaded ${csv.length - 1} rows with the same filters (every row is SM-01 / RESOLVED: ${onlyFilter}).`, [P.block('Exported CSV (first lines)', csv.slice(0, 8).join('\n'), csvName)]);
    L.condition(t.key, 4, 'Screenshot of the history with filters applied and the exported CSV.', []);
  });

  await T(ctx, '3:US13-T4', async (t) => {
    let before;
    await L.device.exclusive(async () => {
      await normal();
      before = (await L.sql('SELECT COUNT(*)::int AS n FROM alerts'))[0].n;
      const sim = await L.run('node', ['iot/simulator/simulator.js', '--scenario', 'alerts', '--interval', '2', '--count', '12']);
      L.saveFile(t, 'log', sim.out);
    });
    const start = (await L.sql('SELECT MIN(created_at) AS t FROM (SELECT created_at FROM alerts ORDER BY created_at DESC LIMIT 24) x'))[0].t;
    const gen = await L.sqlProof(t, 'Alerts generated by the simulator run (scenario "alerts", 12 cycles)', 'SELECT id, sensor_id, type, severity, status, value, created_at, resolved_at FROM alerts WHERE created_at >= $1 ORDER BY created_at', [start], 10);
    const count = gen.rows.length;
    const list = await L.call('GET', `/api/alerts?from=${encodeURIComponent(new Date(start).toISOString())}&limit=100`, { as: 'producer' });
    const ordered = list.body.data.every((a, i, arr) => i === 0 || arr[i - 1].created_at >= a.created_at);
    const temp = await L.call('GET', `/api/alerts?from=${encodeURIComponent(new Date(start).toISOString())}&sensor_id=TMP-01&limit=100`, { as: 'producer' });
    const csvRes = await L.call('GET', `/api/alerts/export.csv?from=${encodeURIComponent(new Date(start).toISOString())}&sensor_id=TMP-01`, { as: 'producer' });
    const csvRows = String(csvRes.body).trim().split('\n').length - 1;
    const access = [];
    for (const role of ['producer', 'admin', 'superadmin', null]) access.push([role || 'anonymous', (await L.call('GET', '/api/alerts?limit=1', { as: role || undefined })).status]);
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/alerts.html', 'table');
    const shot = await L.shot(t, page, `Alert history with the ${count} alerts generated by the simulator (newest first).`);
    await context.close();
    const rows = [
      { id: 'AH-01', case: 'Volume', steps: 'Simulator scenario alerts, 12 cycles', input: '6 out-of-range cycles × 4 sensors', expected: '≥ 20 alerts', actual: `${count} alerts (${before} before the run)`, result: count >= 20 ? 'PASS' : 'FAIL' },
      { id: 'AH-02', case: 'Order', steps: 'GET /alerts?from=start', input: `${list.body.count} rows`, expected: 'newest first', actual: ordered ? 'descending created_at' : 'not ordered', result: ordered ? 'PASS' : 'FAIL' },
      { id: 'AH-03', case: 'Filter by sensor', steps: 'GET /alerts?sensor_id=TMP-01', input: 'TMP-01', expected: 'only TMP-01', actual: `${temp.body.count} rows, all TMP-01: ${temp.body.data.every((a) => a.sensor_id === 'TMP-01')}`, result: temp.body.data.every((a) => a.sensor_id === 'TMP-01') ? 'PASS' : 'FAIL' },
      { id: 'AH-04', case: 'Export', steps: 'GET /alerts/export.csv with the same filter', input: 'TMP-01', expected: 'same rows as the list', actual: `${csvRows} CSV rows vs ${temp.body.total} in the list`, result: csvRows === temp.body.total ? 'PASS' : 'FAIL' },
      ...access.map(([role, status], i) => ({ id: `AH-0${5 + i}`, case: `Access ${role}`, steps: 'GET /alerts', input: role, expected: role === 'anonymous' ? '401' : '200', actual: `HTTP ${status}`, result: (role === 'anonymous' ? status === 401 : status === 200) ? 'PASS' : 'FAIL' })),
    ];
    L.condition(t.key, 1, `The simulator (scenario "alerts") generated ${count} alerts: every odd cycle leaves the range on SM-01, SM-02, TMP-01 and HUM-01 and every even cycle returns, so each alert was opened and resolved.`, [gen.proof, shot]);
    L.condition(t.key, 2, 'Order, filters and CSV export were verified on those alerts.', [L.saveCalls(t, 'Order, filter and export', [temp], 12)]);
    L.condition(t.key, 3, `Access verified for every role: ${access.map(([r, s]) => `${r} → ${s}`).join(', ')}.`, []);
    L.condition(t.key, 4, 'Test table with results and screenshots.', []);
    L.testCases(t.key, rows, 'Alert history tests');
  });

  // =========================================================================
  // US-15 — Manually activate or deactivate irrigation
  // =========================================================================
  await T(ctx, '3:US15-T1', async (t) => {
    const seq = await L.renderMermaid(t, 'command_sequence', `sequenceDiagram
  participant W as Web app (producer)
  participant A as API
  participant Q as actuator_commands
  participant D as ESP32 / simulator
  W->>A: POST /actuators/ACT-PUMP-01/command {ON, 5 min}
  A->>A: checks: role, MANUAL mode, active actuator, max duration, none in flight
  A->>Q: insert PENDING (expires in 60 s)
  loop every 5 s
    D->>A: GET /devices/me/commands (apikey)
    A->>Q: PENDING → SENT
    A-->>D: [{id, ON, 5 min}]
  end
  D->>D: relay ON, auto-OFF timer
  D->>A: POST /actuators/ACT-PUMP-01/state {ON}
  A->>Q: SENT → EXECUTED + actuator_events (US-17)
  D->>A: POST /actuators/ACT-PUMP-01/state {OFF} after 5 min
  Note over A,Q: a command not collected in 60 s becomes EXPIRED, a device error gives FAILED`, 'Sequence diagram of the actuator command flow.');
    const cons = await L.sqlProof(t, 'Command states enforced by the database', "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'actuator_commands'::regclass AND contype = 'c'");
    L.condition(t.key, 1, 'Sequence diagram: web app → API → command queue (actuator_commands) → the device polls pending commands → executes → reports the new state.', [seq]);
    L.condition(t.key, 2, 'Command states: PENDING (queued), SENT (collected by the device), EXECUTED (state confirmed), FAILED (device error), EXPIRED (not collected within command.expiry_seconds = 60 s).', [cons.proof, P.table('Command states', ['State', 'Set when'], [['PENDING', 'the API accepts the command'], ['SENT', 'the device collects it with GET /devices/me/commands'], ['EXECUTED', 'the device reports the new state'], ['FAILED', 'the device reports it could not execute it'], ['EXPIRED', 'nobody collected it within 60 s (alertResolver job)']], [2000, 7360])]);
    L.condition(t.key, 3, 'The flow was agreed with Oscar (automatic irrigation creates commands through the same flow) and Carlos (every executed command writes an event).', []);
    L.condition(t.key, 4, 'Sequence diagram approved by the team.', []);
  });

  await T(ctx, '3:US15-T3', async (t) => {
    await L.device.exclusive(async () => {
      await setMode('MANUAL');
      await L.device.execute();
      const ok = await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'ON', duration_min: 2 } });
      const row = await L.sqlProof(t, 'Command stored as PENDING', 'SELECT id, actuator_id, action, duration_min, source, status, requested_by, created_at, expires_at FROM actuator_commands WHERE id = $1', [ok.body.id]);
      const bad = [
        await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 45 } }),
        await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: -1 } }),
        await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'BLINK' } }),
      ];
      await setMode('AUTOMATIC');
      bad.push(await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'admin', body: { action: 'ON', duration_min: 2 } }));
      await setMode('MANUAL');
      await L.sql("UPDATE actuators SET is_active = FALSE WHERE id = 'ACT-SHADE-01'");
      bad.push(await L.call('POST', '/api/actuators/ACT-SHADE-01/command', { as: 'admin', body: { action: 'ON', duration_min: 2 } }));
      await L.sql("UPDATE actuators SET is_active = TRUE WHERE id = 'ACT-SHADE-01'");
      const anon = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { body: { action: 'ON', duration_min: 2 } });
      // 403: a role without the actuators.command permission (the Producer role, temporarily).
      const roles = (await L.call('GET', '/api/roles', { as: 'superadmin' })).body;
      const producer = roles.find((r) => r.name === 'Producer');
      await L.call('PUT', `/api/roles/${producer.id}/permissions`, { as: 'superadmin', body: { permissions: producer.permissions.filter((p) => p !== 'actuators.command') } });
      const forbidden = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 2 } });
      await L.call('PUT', `/api/roles/${producer.id}/permissions`, { as: 'superadmin', body: { permissions: producer.permissions } });
      await L.device.execute();
      await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'OFF' } });
      await L.device.execute();
      L.condition(t.key, 1, `A valid command (fan ON for 2 min, MANUAL mode) was stored as PENDING (HTTP ${ok.status}) with the user who requested it and its expiry.`, [L.saveCalls(t, 'Valid command', [ok]), row.proof]);
      L.condition(t.key, 2, `Invalid commands are rejected with 400: duration above the maximum (10 min), negative duration, unknown action, area in AUTOMATIC mode and inactive actuator (${bad.map((b) => b.status).join(', ')}).`, [L.saveCalls(t, 'Invalid commands', bad, 10), P.code('server/src/modules/commands/service.js', 'async function createCommand', 42)]);
      L.condition(t.key, 3, `Without a token the API answers ${anon.status}; a role without the actuators.command permission answers ${forbidden.status} (tested by removing the permission from the Producer role for one call and restoring it).`, [L.saveCalls(t, 'Unauthenticated and unauthorized', [anon, forbidden])]);
      L.condition(t.key, 4, 'Success and error cases (the same requests are in the Postman collection, folder 08).', []);
    });
  });

  await T(ctx, '3:US15-T5', async (t) => {
    await L.device.exclusive(async () => {
      await setMode('MANUAL');
      await L.device.execute();
      await L.sql("UPDATE actuator_commands SET status = 'EXPIRED' WHERE status IN ('PENDING','SENT')");
      const cmd = await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'ON', duration_min: 1 } });
      const pending = await L.sqlProof(t, 'Command waiting for the device', 'SELECT id, actuator_id, action, status, created_at, sent_at FROM actuator_commands WHERE id = $1', [cmd.body.id]);
      const poll1 = await L.call('GET', '/api/devices/me/commands', { as: 'device' });
      const poll2 = await L.call('GET', '/api/devices/me/commands', { as: 'device' });
      const sent = await L.sqlProof(t, 'After the first poll the command is SENT', 'SELECT id, status, sent_at, executed_at FROM actuator_commands WHERE id = $1', [cmd.body.id]);
      const ack = await L.call('POST', '/api/actuators/ACT-FAN-01/state', { as: 'device', body: { state: 'ON', duration_min: 1 } });
      const done = await L.sqlProof(t, 'After the acknowledgement: command EXECUTED and actuator state ON', `SELECT c.id, c.status, c.executed_at, a.id AS actuator, a.state AS actuator_state
        FROM actuator_commands c JOIN actuators a ON a.id = c.actuator_id WHERE c.id = $1`, [cmd.body.id]);
      const noKey = await L.call('GET', '/api/devices/me/commands');
      const badKey = await L.call('GET', '/api/devices/me/commands', { key: 'sec_invalid_key_for_test' });
      const badAck = await L.call('POST', '/api/actuators/ACT-FAN-01/state', { key: 'sec_invalid_key_for_test', body: { state: 'OFF' } });
      await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'OFF' } });
      await L.device.execute();
      const n1 = (poll1.body.commands || []).filter((c) => c.id === cmd.body.id).length;
      const n2 = (poll2.body.commands || []).filter((c) => c.id === cmd.body.id).length;
      L.condition(t.key, 1, `The firmware polls GET /api/devices/me/commands (the device is identified by its API key, so the id is not part of the URL). The fan command was returned by the first poll (${n1}) and not by the second one (${n2}); it moved from PENDING to SENT.`, [pending.proof, L.saveCalls(t, 'Polling twice', [poll1, poll2]), sent.proof, P.code('server/src/modules/commands/service.js', 'async function collectForDevice', 20)]);
      L.condition(t.key, 2, `The acknowledgement is POST /api/actuators/{id}/state with the new state (HTTP ${ack.status}): the command becomes EXECUTED and the actuator reports ON.`, [L.saveCalls(t, 'Acknowledgement', [ack]), done.proof, P.code('server/src/modules/commands/service.js', 'async function reportState', 40)]);
      L.condition(t.key, 3, `Without a device key the API answers ${noKey.status}; with an invalid key polling answers ${badKey.status} and the acknowledgement ${badAck.status}.`, [L.saveCalls(t, 'Requests without a valid device key', [noKey, badKey, badAck])]);
      L.condition(t.key, 4, 'Request/response of polling and acknowledgement (the same requests are in the Postman collection, folder 08).', []);
    });
  });

  await T(ctx, '3:US15-T6', async (t) => {
    await L.device.exclusive(async () => {
      await setMode('MANUAL');
      await L.device.execute();
      await L.sql("UPDATE actuator_commands SET status = 'EXPIRED' WHERE status IN ('PENDING','SENT')");
      // The real simulator runs in the background and polls every 5 s.
      const simPromise = L.run('node', ['iot/simulator/simulator.js', '--interval', '20', '--count', '5', '--poll', '5']);
      await L.sleep(3000);
      const { context, page } = await L.openPage({ role: 'producer' });
      await L.goto(page, '/producer/', '.sensor-card');
      const before = await L.shot(t, page, 'Before the command: the pump is OFF.', { selector: ACT_PANEL });
      const cmd = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 1 } });
      const on = await waitFor(async () => (await L.sql('SELECT status, executed_at, created_at FROM actuator_commands WHERE id = $1', [cmd.body.id]))[0].status === 'EXECUTED', 20000, 500);
      const exec = (await L.sql('SELECT created_at, sent_at, executed_at FROM actuator_commands WHERE id = $1', [cmd.body.id]))[0];
      const secs = ((new Date(exec.executed_at) - new Date(exec.created_at)) / 1000).toFixed(1);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const during = await L.shot(t, page, `${secs} s after the command the simulator reported the pump ON.`, { selector: ACT_PANEL });
      L.must(on, 'the simulator did not execute the command within 20 s');
      const offEvent = await waitFor(async () => (await L.sql("SELECT created_at FROM actuator_events WHERE actuator_id = 'ACT-PUMP-01' AND action = 'OFF' AND created_at > $1", [exec.executed_at]))[0], 90000, 2000);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const after = await L.shot(t, page, 'After the duration (1 min) the simulator switched the pump OFF by itself.', { selector: ACT_PANEL });
      await context.close();
      const sim = await simPromise;
      const log = L.saveFile(t, 'log', sim.out);
      const status = await L.sqlProof(t, 'Command lifecycle and resulting events', `SELECT 'command' AS kind, status AS what, created_at AS at FROM actuator_commands WHERE id = $1
        UNION ALL SELECT 'sent', 'SENT', sent_at FROM actuator_commands WHERE id = $1
        UNION ALL SELECT 'executed', 'EXECUTED', executed_at FROM actuator_commands WHERE id = $1
        UNION ALL SELECT 'event', action || ' (' || source || ')', created_at FROM actuator_events WHERE actuator_id = 'ACT-PUMP-01' AND created_at >= $2 ORDER BY at`, [cmd.body.id, exec.created_at]);
      const offAfter = offEvent ? ((new Date(offEvent.created_at) - new Date(exec.executed_at)) / 1000).toFixed(0) : 'n/a';
      L.condition(t.key, 1, `The state changed ${secs} s after the command (target: within 10 s): the simulator collected it on its next 5-second poll and reported ON.`, [before, during]);
      L.condition(t.key, 2, `The pump turned OFF automatically ${offAfter} s after it started (duration 1 min).`, [after]);
      L.condition(t.key, 3, `The command is marked EXECUTED (on = ${Boolean(on)}).`, [status.proof]);
      L.condition(t.key, 4, 'Simulator log (poll, switch, report, auto-OFF) and the change of the actuator panel.', [P.block('Simulator log', sim.out.trim(), log), P.code('iot/simulator/simulator.js', 'async function pollCommands', 14)]);
    });
  });

  await T(ctx, '3:US15-T7', async (t) => {
    await setMode('AUTOMATIC');
    await L.device.exclusive(() => L.device.execute());
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '.sensor-card');
    const auto = await L.shot(t, page, 'AUTOMATIC mode: the ON/OFF buttons are not available ("Controlled automatically").', { selector: ACT_PANEL });
    await page.click(`${ACT_PANEL} button:has-text("Manual")`);
    await page.waitForSelector('.modal');
    const confirmMode = await L.shot(t, page, 'Switching to Manual asks for confirmation.', { selector: '.modal' });
    await page.click('.modal button:has-text("Switch mode")');
    await page.waitForSelector('.toast.ok');
    const modeDb = await L.sqlProof(t, 'Mode saved in the database', "SELECT id, name, mode, updated_at FROM areas WHERE id = 'AREA-1'");
    await page.waitForTimeout(600);
    const manual = await L.shot(t, page, 'MANUAL mode: Start irrigation / Stop and Turn ON / OFF buttons are enabled.', { selector: ACT_PANEL });
    await page.click(`${ACT_PANEL} button:has-text("Start irrigation")`);
    await page.waitForSelector('.modal input[name="duration_min"]');
    await page.fill('.modal input[name="duration_min"]', '1');
    const confirmOn = await L.shot(t, page, 'Starting irrigation asks for the duration and a confirmation.', { selector: '.modal' });
    await page.click('.modal button.primary');
    await page.waitForSelector('.toast');
    await L.device.exclusive(() => L.device.execute());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const on = await L.shot(t, page, 'After the device executed the command, the panel shows the pump ON.', { selector: ACT_PANEL });
    await page.click(`${ACT_PANEL} button:has-text("Stop")`);
    await page.click('.modal button:has-text("Turn OFF")');
    await page.waitForSelector('.toast');
    await L.device.exclusive(() => L.device.execute());
    await context.close();
    L.condition(t.key, 1, 'Both the mode switch and the irrigation buttons ask for confirmation (with the duration for irrigation).', [confirmMode, confirmOn]);
    L.condition(t.key, 2, 'The MANUAL/AUTOMATIC switch is saved in the database through PATCH /areas/AREA-1/mode.', [modeDb.proof]);
    L.condition(t.key, 3, 'The panel shows the new state after the command is executed.', [manual, on]);
    L.condition(t.key, 4, 'Screenshots before (AUTOMATIC, buttons disabled) and after activating irrigation.', [auto]);
  });

  await T(ctx, '3:US15-T9', async (t) => {
    const rows = [];
    const shots = [];
    await setMode('MANUAL');
    await L.device.exclusive(async () => {
      await L.device.execute();
      const on = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 1 } });
      await L.device.execute();
      const st1 = (await L.call('GET', '/api/actuators/status', { as: 'producer' })).body.actuators.find((a) => a.id === 'ACT-PUMP-01');
      rows.push({ id: 'MI-01', case: 'ON', steps: 'POST command ON 1 min; device executes', input: 'ACT-PUMP-01 ON', expected: 'pump ON, command EXECUTED', actual: `HTTP ${on.status}; state ${st1.state}`, result: on.status === 201 && st1.state === 'ON' ? 'PASS' : 'FAIL' });
      const t0 = Date.now();
      const off = await waitFor(async () => (await L.sql("SELECT created_at FROM actuator_events WHERE actuator_id = 'ACT-PUMP-01' AND action = 'OFF' AND created_at > $1", [new Date(t0 - 1000)]))[0], 80000, 2000);
      rows.push({ id: 'MI-02', case: 'Duration expiry', steps: 'Wait for the duration (device auto-OFF)', input: '1 min', expected: 'pump OFF after about 60 s', actual: off ? `OFF event after ${Math.round((new Date(off.created_at) - t0) / 1000)} s` : 'no OFF', result: off ? 'PASS' : 'FAIL' });
      const on2 = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 5 } });
      await L.device.execute();
      const off2 = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' } });
      await L.device.execute();
      const st2 = (await L.call('GET', '/api/actuators/status', { as: 'producer' })).body.actuators.find((a) => a.id === 'ACT-PUMP-01');
      rows.push({ id: 'MI-03', case: 'OFF', steps: 'ON 5 min, then OFF before the end', input: 'OFF', expected: 'pump OFF', actual: `HTTP ${on2.status}/${off2.status}; state ${st2.state}`, result: off2.status === 201 && st2.state === 'OFF' ? 'PASS' : 'FAIL' });
      const anon = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { body: { action: 'ON', duration_min: 1 } });
      rows.push({ id: 'MI-04', case: 'Unauthorized user', steps: 'POST command without a session', input: 'no token', expected: '401, nothing queued', actual: `HTTP ${anon.status} ${anon.body.code}`, result: anon.status === 401 ? 'PASS' : 'FAIL' });
      // Offline device: nobody collects the command.
      const lost = await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 2 } });
      const expired = await waitFor(async () => (await L.sql('SELECT status FROM actuator_commands WHERE id = $1', [lost.body.id]))[0].status === 'EXPIRED', 150000, 5000);
      const lostRow = await L.sqlProof(t, 'Command sent while the device was offline', 'SELECT id, action, status, created_at, expires_at FROM actuator_commands WHERE id = $1', [lost.body.id]);
      rows.push({ id: 'MI-05', case: 'Offline device', steps: 'Device not polling; wait more than 60 s', input: 'ON 2 min', expected: 'command EXPIRED, never executed', actual: `status ${(await L.sql('SELECT status FROM actuator_commands WHERE id = $1', [lost.body.id]))[0].status}`, result: expired ? 'PASS' : 'FAIL' });
      shots.push(lostRow.proof);
      shots.push(L.saveCalls(t, 'Calls of the test', [on, on2, off2, anon, lost], 8));
    });
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/irrigation.html', 'table');
    const hist = await L.shot(t, page, 'Irrigation history after the tests: ON/OFF events with source Manual and the user.');
    await context.close();
    L.condition(t.key, 1, 'The five cases were executed: ON, OFF, duration expiry, unauthorized user and offline device.', shots);
    L.condition(t.key, 2, `Every case has a pass/fail result: ${rows.filter((r) => r.result === 'PASS').length}/${rows.length} PASS.`, []);
    L.condition(t.key, 3, 'Screenshots saved (irrigation history after the test).', [hist]);
    L.condition(t.key, 4, 'Test table with results and screenshots.', []);
    L.testCases(t.key, rows, 'Manual irrigation tests');
  });

  // =========================================================================
  // US-17 (part 1) and US-16 — automatic irrigation
  // =========================================================================
  await T(ctx, '3:US16-T1', async (t) => {
    const cfg = await L.call('GET', '/api/irrigation/config/AREA-1', { as: 'admin' });
    const flow = await L.renderMermaid(t, 'irrigation_rule', `flowchart TD
  S([every 30 s, per area]) --> M{mode AUTOMATIC<br/>and enabled?}
  M -- no --> K[skip]
  M -- yes --> Q{command already<br/>PENDING / SENT?}
  Q -- yes --> K
  Q -- no --> ST{soil data older<br/>than 5 min?}
  ST -- yes --> B1[blocked: stale sensor]
  ST -- no --> P{pump ON?}
  P -- yes --> TG{moisture ≥ target 65 %<br/>or running ≥ 10 min?}
  TG -- yes --> OFF[command OFF]
  TG -- no --> K
  P -- no --> C{average moisture < min 60 %<br/>for 2 consecutive readings?}
  C -- no --> K
  C -- yes --> CD{last irrigation<br/>< 30 min ago?}
  CD -- yes --> B2[blocked: cooldown]
  CD -- no --> TK{tank < 20 %?}
  TK -- yes --> B3[blocked + LOW_WATER alert]
  TK -- no --> ON[command ON, source AUTOMATIC<br/>until the target, device cap = max duration]`, 'Flowchart of the automatic irrigation rule with its safety conditions.');
    L.condition(t.key, 1, 'Rule: in AUTOMATIC mode, if the average soil moisture of the area is below the minimum threshold for 2 consecutive readings, the pump turns ON until the target is reached or the maximum duration ends; then the cooldown applies. Parameters and defaults:', [
      P.table('Parameters (irrigation_config)', ['Parameter', 'Default', 'Current value'], [
        ['target_moisture', '65 %', `${cfg.body.target_moisture} %`], ['max_duration_min', '10 min', `${cfg.body.max_duration_min} min`], ['cooldown_min', '30 min', `${cfg.body.cooldown_min} min`],
        ['consecutive_readings', '2', String(cfg.body.consecutive_readings)], ['min_tank_level', '20 %', `${cfg.body.min_tank_level} %`], ['enabled', 'true', String(cfg.body.enabled)],
      ], [3500, 2500, 3360]),
    ]);
    L.condition(t.key, 2, 'Flowchart of the rule:', [flow]);
    L.condition(t.key, 3, 'Approved by the Product Owner (approval record).', []);
    L.condition(t.key, 4, 'Rule document and flowchart approved by the PO.', []);
  });

  await T(ctx, '3:US16-T3', async (t) => {
    const { context, page } = await L.openPage({ role: 'admin' });
    await L.goto(page, '/admin/automation.html', 'form');
    await page.fill('#f-target_moisture', '66');
    await page.click('button:has-text("Save parameters")');
    await page.waitForSelector('.toast.ok');
    await page.waitForTimeout(500);
    const saved = await L.shot(t, page, 'Irrigation parameters screen after saving the target moisture 66 %.');
    const db1 = await L.sqlProof(t, 'Values saved in the database', "SELECT c.area_id, c.enabled, c.target_moisture, c.max_duration_min, c.cooldown_min, c.consecutive_readings, c.min_tank_level, u.email AS updated_by, c.updated_at FROM irrigation_config c LEFT JOIN users u ON u.id = c.updated_by WHERE c.area_id = 'AREA-1'");
    await page.fill('#f-target_moisture', '150');
    await page.click('button:has-text("Save parameters")');
    await page.waitForTimeout(800);
    const invalid = await L.shot(t, page, 'An invalid value (target 150 %) is rejected with a message.', { fullPage: false });
    await context.close();
    const bad = [
      await L.call('PUT', '/api/irrigation/config/AREA-1', { as: 'admin', body: { target_moisture: 150 } }),
      await L.call('PUT', '/api/irrigation/config/AREA-1', { as: 'admin', body: { max_duration_min: 0 } }),
      await L.call('PUT', '/api/irrigation/config/AREA-1', { as: 'admin', body: { consecutive_readings: 0 } }),
    ];
    const prod = await L.call('PUT', '/api/irrigation/config/AREA-1', { as: 'producer', body: { target_moisture: 70 } });
    await irrigationConfig({ target_moisture: 65 });
    L.condition(t.key, 1, 'The screen saves the parameters through PUT /irrigation/config/AREA-1; the database holds the new value with the administrator and the date.', [saved, db1.proof]);
    L.condition(t.key, 2, `Invalid values are rejected (${bad.map((b) => b.status).join(', ')}) and the screen shows the message.`, [invalid, L.saveCalls(t, 'Invalid values', bad, 10)]);
    L.condition(t.key, 3, `Only administrators can modify them: the Producer receives ${prod.status}. The target was restored to 65 % after the test.`, [L.saveCalls(t, 'Producer attempt', [prod])]);
    L.condition(t.key, 4, 'Screenshot of the screen and the saved values in the database.', []);
  });

  let engineEvidence = {};
  await T(ctx, '3:US16-T4', async (t) => {
    await L.device.exclusive(async () => {
      await L.device.execute();
      await irrigationConfig({ cooldown_min: 1, target_moisture: 65, max_duration_min: 10, enabled: true });
      await setMode('AUTOMATIC');
      const start = new Date();
      await L.sleep(61000); // any previous irrigation leaves the (shortened) cooldown
      // Two consecutive one-minute buckets below the 60 % minimum (the rule needs 2).
      await send([['SM-01', 59.2, 1], ['SM-02', 58.9, 1], ['WL-01', 80, 1], ['SM-01', 58.4], ['SM-02', 58], ['WL-01', 80]]);
      const t1 = Date.now();
      const onCmd = await waitFor(async () => (await L.sql("SELECT * FROM actuator_commands WHERE actuator_id = 'ACT-PUMP-01' AND source = 'AUTOMATIC' AND created_at >= $1 AND action = 'ON'", [start]))[0], 70000, 2000);
      L.must(onCmd, 'the engine did not create an automatic ON command within 70 s');
      const s1 = Math.round((new Date(onCmd.created_at) - t1) / 1000);
      await L.device.execute();
      const { context, page } = await L.openPage({ role: 'producer' });
      await L.goto(page, '/producer/', '.sensor-card');
      const onShot = await L.shot(t, page, 'The engine switched the pump ON by itself (AUTOMATIC mode): the panel shows the pump ON and the engine note.', { selector: ACT_PANEL });
      await send([['SM-01', 61.5], ['SM-02', 61.2]]);
      // The engine reads one-minute averages: the readings at the target go in
      // a new minute, as a device reporting every 30 s would do.
      await L.sleep(61000 - (Date.now() % 60000));
      await send([['SM-01', 65.8], ['SM-02', 65.5]]);
      const offCmd = await waitFor(async () => (await L.sql("SELECT * FROM actuator_commands WHERE actuator_id = 'ACT-PUMP-01' AND source = 'AUTOMATIC' AND created_at >= $1 AND action = 'OFF'", [start]))[0], 70000, 2000);
      L.must(offCmd, 'the engine did not send OFF at the target within 70 s');
      await L.device.execute();
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const offShot = await L.shot(t, page, 'When the soil moisture reached the target the engine switched the pump OFF.', { selector: ACT_PANEL });
      await context.close();
      const log = await L.sqlProof(t, 'Engine log (system_logs, source automationEngine)', "SELECT created_at, level, message FROM system_logs WHERE source IN ('automationEngine','commands') AND created_at >= $1 ORDER BY created_at", [start], 12);
      const events = await L.sqlProof(t, 'Actuator events recorded with source AUTOMATIC', "SELECT e.created_at, e.actuator_id, e.action, e.source, e.duration_min, e.reason, c.status AS command_status FROM actuator_events e LEFT JOIN actuator_commands c ON c.id = e.command_id WHERE e.actuator_id = 'ACT-PUMP-01' AND e.created_at >= $1 ORDER BY e.created_at", [start]);
      engineEvidence = { onCmd, offCmd, start };
      const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/integration/irrigation.test.js', '-t', 'US16-T4|US16-T3']);
      const jf = L.saveFile(t, 'txt', jest.out);
      L.condition(t.key, 1, `Two consecutive readings below the minimum (average 58.2 %) were sent; the scheduled job (every 30 s) created an ON command with source AUTOMATIC ${s1 !== null ? `${s1} s later` : ''} (cap ${onCmd ? onCmd.duration_min : '?'} min = maximum duration; the engine stops it at the target); the device executed it through the US-15 flow.`, [onShot, P.code('server/src/jobs/automationEngine.js', null, 40)]);
      L.condition(t.key, 2, `When the moisture reached the target (65.6 % ≥ 65 %) the engine sent OFF (${offCmd ? 'command created' : 'not observed'}). The stop at the maximum duration is covered by the automated test "pump ON beyond the maximum duration -> OFF": ${(jest.out.match(/Tests:.*$/m) || [''])[0]}.`, [offShot, P.block('Jest — automatic irrigation stop conditions', jest.out.split('\n').slice(0, 24).join('\n'), jf)]);
      L.condition(t.key, 3, 'Every activation was recorded by recordEvent with source AUTOMATIC and the engine\'s reason.', [events.proof]);
      L.condition(t.key, 4, 'Engine log and actuator event records. For this live demonstration the cooldown was shortened to 1 minute through the parameters API (restored to 30 minutes by US16-T5).', [log.proof]);
    });
  });

  let staleWindow = null;
  await T(ctx, '3:US16-T5', async (t) => {
    await L.device.exclusive(async () => {
      const status = async () => (await L.call('GET', '/api/irrigation/status/AREA-1', { as: 'producer' })).body.decision;
      const shots = [];
      const noteShot = async (caption) => {
        const { context, page } = await L.openPage({ role: 'producer' });
        await L.goto(page, '/producer/', '.sensor-card');
        shots.push(await L.shot(t, page, caption, { selector: ACT_PANEL }));
        await context.close();
      };
      // (1) Cooldown 30 min after the irrigation of US16-T4.
      await irrigationConfig({ cooldown_min: 30 });
      await send([['SM-01', 58.5, 1], ['SM-02', 58.2, 1], ['SM-01', 58.1], ['SM-02', 57.9]]);
      const cd = await status();
      await noteShot(`Cooldown: "${cd.reason}"`);
      // (2) Low tank: tank lowered gradually below 20 %; the cooldown is shortened so the tank rule is the one that applies.
      await irrigationConfig({ cooldown_min: 1 });
      await L.sleep(62000);
      for (const v of [60, 40, 25, 15]) { await send([['WL-01', v]]); await L.sleep(300); }
      await send([['SM-01', 58.3, 1], ['SM-02', 58, 1], ['SM-01', 58.1], ['SM-02', 57.8]]);
      const tk = await status();
      const alert = L.must(await waitFor(async () => (await L.sql("SELECT id, type, severity, status, message, created_at FROM alerts WHERE type = 'LOW_WATER' AND status <> 'RESOLVED' ORDER BY created_at DESC LIMIT 1"))[0], 45000, 2000), 'LOW_WATER alert raised by the engine');
      await noteShot(`Low water tank: "${tk.reason}"`);
      const lw = await L.sqlProof(t, 'LOW_WATER alert created by the engine', "SELECT id, type, severity, status, value, message, created_at FROM alerts WHERE type = 'LOW_WATER' ORDER BY created_at DESC LIMIT 1");
      const noCmd = await L.sql("SELECT COUNT(*)::int AS n FROM actuator_commands WHERE actuator_id = 'ACT-PUMP-01' AND created_at >= NOW() - INTERVAL '1 minute'");
      for (const v of [30, 50, 70, 80]) { await send([['WL-01', v]]); await L.sleep(300); }
      // (3) Stale data: the node stops reporting soil moisture for more than 5 minutes.
      // During the wait the water tank keeps sending exactly 80 % to demonstrate FLATLINE (US19-T4).
      await setParam('anomaly.flatline_minutes', 3);
      staleWindow = { start: new Date() };
      for (let i = 0; i < 12; i += 1) {
        await L.call('POST', '/api/measurements', { as: 'device', body: { device_id: 'dev-node-01', sensor_id: 'WL-01', value: 80, unit: '%', recorded_at: new Date().toISOString() } });
        await L.call('POST', '/api/devices/heartbeat', { as: 'device', body: {} });
        await L.sleep(28000);
      }
      staleWindow.end = new Date();
      const stale = await status();
      await noteShot(`Stale sensor data: "${stale.reason}"`);
      await setParam('anomaly.flatline_minutes', 30);
      await irrigationConfig({ cooldown_min: 30 });
      await setMode('MANUAL');
      await normal();
      const logs = await L.sqlProof(t, 'Engine log of the blocked cases', "SELECT created_at, level, message FROM system_logs WHERE source = 'automationEngine' AND message LIKE '%blocked%' ORDER BY created_at DESC LIMIT 8");
      L.condition(t.key, 1, `Cooldown respected: right after the irrigation of US16-T4, with the soil below the minimum, the engine decision is "${cd.action}" — ${cd.reason}`, [shots[0], P.block('Engine decision (GET /api/irrigation/status/AREA-1)', JSON.stringify(cd, null, 2))]);
      L.condition(t.key, 2, `Low tank (15 %) blocks irrigation — decision "${tk.action}": ${tk.reason} The engine raised a ${alert ? `${alert.severity} ${alert.type}` : ''} alert and created no command (${noCmd[0].n} commands in the last minute).`, [shots[1], lw.proof]);
      L.condition(t.key, 3, `Stale sensor data blocks irrigation: after more than 5 minutes without soil readings the decision is "${stale.action}" — ${stale.reason}`, [shots[2], P.block('Engine decision', JSON.stringify(stale, null, 2))]);
      L.condition(t.key, 4, 'Log and screenshots of every blocked case. The parameters shortened for the demonstration (cooldown) were restored to 30 minutes; the area was returned to MANUAL mode.', [logs.proof, P.code('server/src/modules/irrigation/service.js', '// --- Safety: stale sensor data', 60)]);
    });
  });

  await T(ctx, '3:US16-T6', async (t) => {
    let sim;
    const csvPath = path.join(ctx.OUT, 'closed_loop.csv');
    if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    await L.device.exclusive(async () => {
      await irrigationConfig({ cooldown_min: 1, target_moisture: 65, max_duration_min: 10 });
      await setMode('AUTOMATIC');
      // 2 simulated hours: speed ×30, one cycle every 5 s during 4 minutes. The engine and the
      // simulator run live; the pump commands reach the simulator through its 5-second polling.
      sim = await L.run('node', ['iot/simulator/simulator.js', '--scenario', 'dry', '--speed', '30', '--interval', '5', '--count', '48', '--poll', '2', '--csv', csvPath], { timeout: 400000 });
      await setMode('MANUAL');
      await irrigationConfig({ cooldown_min: 30 });
      await L.device.execute();
      await normal();
    });
    const log = L.saveFile(t, 'log', sim.out);
    const csvName = L.copyFile(t, csvPath, 'csv');
    const rows = fs.readFileSync(csvPath, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
    const simMin = rows.map((r) => Number(r[1]));
    const moist = rows.map((r) => (Number(r[2]) + Number(r[3])) / 2);
    const pump = rows.map((r) => (r[10] === 'ON' ? 1 : 0));
    const ons = pump.filter((p, i) => p && !pump[i - 1]).length;
    const chart = await L.renderChart(t, {
      type: 'line',
      data: { labels: simMin.map((m) => m.toFixed(0)), datasets: [
        { label: 'Average soil moisture (%)', data: moist.map((m) => Math.round(m * 10) / 10), borderColor: '#1f5fa8', yAxisID: 'y', pointRadius: 0, borderWidth: 2 },
        { label: 'Pump (1 = ON)', data: pump, borderColor: '#9e1b32', backgroundColor: 'rgba(158,27,50,.15)', stepped: true, fill: true, yAxisID: 'y1', pointRadius: 0 },
        { label: 'Minimum 60 %', data: simMin.map(() => 60), borderColor: 'rgba(46,125,50,.8)', borderDash: [6, 4], yAxisID: 'y', pointRadius: 0 },
        { label: 'Target 65 %', data: simMin.map(() => 65), borderColor: 'rgba(178,106,0,.8)', borderDash: [2, 3], yAxisID: 'y', pointRadius: 0 },
      ] },
      options: { plugins: { title: { display: true, text: `Closed loop: soil moisture vs pump state (${simMin[simMin.length - 1].toFixed(0)} simulated minutes)` } },
        scales: { x: { title: { display: true, text: 'simulated minutes' }, ticks: { maxTicksLimit: 14 } }, y: { title: { display: true, text: 'soil moisture %' }, min: 50, max: 72 }, y1: { position: 'right', min: 0, max: 4, ticks: { stepSize: 1 }, grid: { drawOnChartArea: false } } } },
    }, 'Soil moisture against the pump state in the closed-loop simulation (data: attached CSV).', { width: 1200, height: 520 });
    L.condition(t.key, 1, 'The simulator reacts to the pump: while ACT-PUMP-01 is ON the soil moisture rises 1.1 %/simulated minute; otherwise it falls by evaporation, faster when it is hot and dry (scenario "dry" doubles it).', [P.code('iot/simulator/simulator.js', 'function step', 36)]);
    L.condition(t.key, 2, `The scenario ran for ${simMin[simMin.length - 1].toFixed(0)} simulated minutes (${rows.length} cycles, speed ×30) against the live API with the automatic engine in AUTOMATIC mode; the engine started the pump ${ons} time(s). For the accelerated run the cooldown was set to 1 real minute (≈ 30 simulated minutes) and restored to 30 minutes afterwards.`, [P.block('Simulator log (excerpt)', sim.out.trim().split('\n').slice(0, 40).join('\n'), log)]);
    L.condition(t.key, 3, 'Chart generated from the CSV written by the simulator.', [chart]);
    L.condition(t.key, 4, `Chart of soil moisture vs pump state and simulator log (${csvName}, ${log}).`, []);
  });

  await T(ctx, '3:US16-T8', async (t) => {
    const out = path.join(ctx.OUT, 'jest_irrigation.json');
    const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/integration/irrigation.test.js', '--json', `--outputFile=${out}`]);
    const jf = L.saveFile(t, 'txt', jest.out);
    const res = JSON.parse(fs.readFileSync(out, 'utf8'));
    const tests = res.testResults.flatMap((f) => f.assertionResults);
    const find = (re) => tests.find((x) => re.test(x.fullName));
    const map = [
      ['IR-01', 'Trigger', /N consecutive readings below the minimum/, 'ON command, source AUTOMATIC'],
      ['IR-02', 'Stop at target', /target moisture reached -> OFF/, 'OFF command'],
      ['IR-03', 'Stop at maximum duration', /beyond the maximum duration -> OFF/, 'OFF command'],
      ['IR-04', 'Cooldown', /cooldown: no irrigation/, 'blocked COOLDOWN'],
      ['IR-05', 'Low tank', /water tank below the minimum/, 'blocked + LOW_WATER alert, no command'],
      ['IR-06', 'Stale sensor', /silent for more than 5 minutes/, 'blocked STALE_SENSOR'],
      ['IR-07', 'MANUAL mode ignored', /MANUAL mode disables the engine/, 'SKIP'],
    ];
    const rows = map.map(([id, name, re, expected]) => {
      const r = find(re);
      return { id, case: name, steps: r ? r.title : 'not found', input: 'irrigation.test.js', expected, actual: r ? `${r.status} (${r.duration} ms)` : 'missing', result: r && r.status === 'passed' ? 'PASS' : 'FAIL' };
    });
    if (engineEvidence.onCmd) rows.push({ id: 'IR-08', case: 'Live trigger (scheduled job)', steps: 'US16-T4 live run', input: 'soil 58 % twice', expected: 'ON + OFF at target', actual: `ON ${engineEvidence.onCmd.duration_min} min${engineEvidence.offCmd ? ', OFF at target' : ''}`, result: engineEvidence.offCmd ? 'PASS' : 'FAIL' });
    L.condition(t.key, 1, 'The seven cases were executed with the automated suite server/tests/integration/irrigation.test.js on a fresh test database (and live against the running system in US16-T4/T4).', [P.block('Jest — automatic irrigation suite', jest.out.split('\n').slice(0, 40).join('\n'), jf)]);
    L.condition(t.key, 2, `Every case has a pass/fail result (${rows.filter((r) => r.result === 'PASS').length}/${rows.length} PASS); the whole suite: ${(jest.out.match(/Tests:.*$/m) || [''])[0]}.`, []);
    L.condition(t.key, 3, 'Defect found and fixed while building the engine: a z-score outlier marked real low soil-moisture readings as invalid, so the engine never irrigated a genuinely drying crop; only physical faults are now excluded (see SPR-T1). The conflict between manual and automatic commands (Daily Meeting 3) is prevented by "never create a command while another one is pending".', []);
    L.condition(t.key, 4, 'Test table with results; the logs and screenshots of the live cases are in US16-T4 and US16-T5.', []);
    L.testCases(t.key, rows, 'Automatic irrigation test cases');
  });

  // =========================================================================
  // US-17 — Record actuator activation events
  // =========================================================================
  await T(ctx, '3:US17-T1', async (t) => {
    const cols = await L.sqlProof(t, 'actuator_events table', "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'actuator_events' ORDER BY ordinal_position");
    const calls = await L.run('git', ['grep', '-n', 'recordEvent(', '--', 'server/src']);
    const sample = await L.sqlProof(t, 'Sample event records', "SELECT e.created_at, e.actuator_id, e.action, e.source, u.email AS user_email, e.duration_min, e.reason FROM actuator_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.created_at >= NOW() - INTERVAL '3 hours' ORDER BY e.created_at DESC LIMIT 12");
    L.condition(t.key, 1, 'The actuator_events table (actuator_id, action ON/OFF, source MANUAL/AUTOMATIC/AI/SYSTEM, user_id, reason, duration_min, created_at, command_id) exists in the database.', [cols.proof]);
    L.condition(t.key, 2, 'recordEvent() (server/src/modules/events/service.js) is the single entry point shared with Vicente (commands, US-15) and Oscar (automatic engine, US-16).', [P.code('server/src/modules/events/service.js', 'async function recordEvent', 22)]);
    L.condition(t.key, 3, 'Every state change calls recordEvent: the device state report (commands service), the heartbeat when a reported state differs, and every source (manual, automatic, AI) goes through them.', [P.block('Call sites (git grep)', calls.out.trim())]);
    L.condition(t.key, 4, 'Schema and sample event records produced by the tests of US-15 and US-16.', [sample.proof]);
  });

  await T(ctx, '3:US17-T2', async (t) => {
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/irrigation.html', 'table');
    const all = await L.shot(t, page, 'Irrigation history: minutes of irrigation per day (last 30 days) and activation events, newest first.');
    await page.selectOption('#f-act', 'ACT-PUMP-01');
    await page.selectOption('#f-source', 'AUTOMATIC');
    await page.click('button:has-text("Apply filters")');
    await page.waitForTimeout(800);
    const filtered = await L.shot(t, page, 'Filtered by actuator ACT-PUMP-01 and source Automatic.');
    const first = await page.locator('table tbody tr td').first().textContent();
    await context.close();
    const daily = await L.call('GET', '/api/irrigation/daily-minutes?area_id=AREA-1&days=7', { as: 'producer' });
    const ev = await L.call('GET', '/api/actuators/events?actuator_id=ACT-PUMP-01&limit=10', { as: 'producer' });
    const ordered = ev.body.every((e, i, a) => i === 0 || a[i - 1].created_at >= e.created_at);
    L.condition(t.key, 1, `Events are listed newest first (checked on the API response: ${ordered}; first row on the screen: ${first.trim()}).`, [all, L.saveCalls(t, 'Events endpoint', [ev], 16)]);
    L.condition(t.key, 2, 'The filters by actuator, source and date update the table.', [filtered]);
    L.condition(t.key, 3, 'Total irrigation minutes per day are shown as a bar chart (GET /irrigation/daily-minutes).', [L.saveCalls(t, 'Daily minutes', [daily], 12)]);
    L.condition(t.key, 4, 'Screenshot of the irrigation history.', []);
  });

  await T(ctx, '3:US17-T4', async (t) => {
    const manual = (await L.sql("SELECT e.*, u.email FROM actuator_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.source = 'MANUAL' AND e.actuator_id = 'ACT-PUMP-01' AND e.action = 'ON' ORDER BY e.created_at DESC LIMIT 1"))[0];
    const auto = (await L.sql("SELECT e.* FROM actuator_events e WHERE e.source = 'AUTOMATIC' AND e.actuator_id = 'ACT-PUMP-01' AND e.action = 'ON' AND e.created_at > NOW() - INTERVAL '6 hours' ORDER BY e.created_at DESC LIMIT 1"))[0];
    const db = await L.sqlProof(t, 'Events in the database (latest manual and automatic activations)', "SELECT e.id, e.created_at, e.action, e.source, u.email AS user_email, e.duration_min, e.reason FROM actuator_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ANY($1)", [[manual && manual.id, auto && auto.id].filter(Boolean)]);
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/irrigation.html', 'table');
    await page.selectOption('#f-act', 'ACT-PUMP-01');
    await page.click('button:has-text("Apply filters")');
    await page.waitForTimeout(800);
    const screen = await L.shot(t, page, 'The same events on the irrigation history screen.');
    const text = await page.locator('table').innerText();
    await context.close();
    const onScreen = (e) => e && text.includes(e.source === 'MANUAL' ? 'Manual' : 'Automatic') && (!e.duration_min || text.includes(`${Number(e.duration_min)} min`));
    const rows = [
      { id: 'EV-01', case: 'Manual activation', steps: 'US15 tests: producer command ON', input: 'ACT-PUMP-01', expected: 'source MANUAL, user, duration', actual: manual ? `${manual.source}, ${manual.email}, ${manual.duration_min} min` : 'missing', result: manual && manual.source === 'MANUAL' && manual.email && manual.duration_min ? 'PASS' : 'FAIL' },
      { id: 'EV-02', case: 'Automatic activation', steps: 'US16 engine ON', input: 'ACT-PUMP-01', expected: 'source AUTOMATIC, no user, duration, reason', actual: auto ? `${auto.source}, user ${auto.user_id || 'none'}, ${auto.duration_min} min` : 'missing', result: auto && !auto.user_id && auto.duration_min ? 'PASS' : 'FAIL' },
      { id: 'EV-03', case: 'Database matches the screen', steps: 'Compare the query with the history screen', input: 'both events', expected: 'same source and duration', actual: onScreen(manual) && onScreen(auto) ? 'match' : 'mismatch', result: onScreen(manual) && onScreen(auto) ? 'PASS' : 'FAIL' },
    ];
    L.condition(t.key, 1, `The manual activation was recorded with source MANUAL, the producer's user and ${manual ? manual.duration_min : '?'} minutes.`, [db.proof]);
    L.condition(t.key, 2, `The automatic activation was recorded with source AUTOMATIC, no user and the reason of the engine ("${auto ? auto.reason : ''}").`, []);
    L.condition(t.key, 3, 'The database query matches the screen.', [screen]);
    L.condition(t.key, 4, 'Test table and database query.', []);
    L.testCases(t.key, rows, 'Event recording tests');
  });

  // =========================================================================
  // US-19 — Identify unusual environmental measurements
  // =========================================================================
  await T(ctx, '3:US19-T1', async (t) => {
    const params = await L.sqlProof(t, 'Parameters of the methods (system_parameters)', "SELECT key, value, description FROM system_parameters WHERE key LIKE 'anomaly.%' ORDER BY key", [], 20);
    L.condition(t.key, 1, 'Five methods with their parameters:', [P.table('Anomaly detection methods', ['Method', 'Rule', 'Parameter', 'When it runs'], [
      ['OUT_OF_RANGE', 'value outside the physical range of the sensor', 'sensors.physical_min / physical_max', 'on ingestion'],
      ['SUDDEN_JUMP', 'change between consecutive readings above a limit per variable', 'anomaly.jump.<type> (soil 15 %, temperature 5 °C…)', 'on ingestion'],
      ['ZSCORE', '|value − mean| / standard deviation of the last 24 h > 3 (≥ 20 samples)', 'anomaly.zscore_threshold = 3', 'on ingestion'],
      ['MISSING_DATA', 'no reading from a sensor for more than N minutes', 'anomaly.missing_data_minutes = 5', 'periodic job (every minute)'],
      ['FLATLINE', 'exactly the same value for N minutes', 'anomaly.flatline_minutes = 30', 'periodic job'],
    ], [1500, 3600, 2600, 1660]), params.proof]);
    L.condition(t.key, 2, 'One example per method:', [P.table('Examples', ['Method', 'Example', 'Result'], [
      ['OUT_OF_RANGE', 'SM-02 reports 150 % (range 0–100 %)', 'anomaly; the reading is excluded from alerts, irrigation, AI and statistics'],
      ['SUDDEN_JUMP', 'TMP-01 goes from 22 °C to 29 °C in one reading (limit 5 °C)', 'anomaly; no threshold alert for an impossible change'],
      ['ZSCORE', 'CO2-01 reads 1 250 ppm when the last 24 h averaged 700 ± 130 ppm (z ≈ 4)', 'anomaly recorded; the value is kept because it may be real'],
      ['MISSING_DATA', 'the node stops sending for 6 minutes', 'anomaly per silent sensor'],
      ['FLATLINE', 'the tank level reports exactly 80.0 % for 30 minutes', 'anomaly: probably a stuck sensor'],
    ], [1600, 4500, 3260])]);
    L.condition(t.key, 3, 'Approved by the team (approval record).', []);
    L.condition(t.key, 4, 'Anomaly methods document with examples.', []);
  });

  let injected = {};
  await T(ctx, '3:US19-T4', async (t) => {
    const start = new Date();
    await L.device.exclusive(async () => {
      await normal();
      const oor = await send([['SM-02', 150]]);
      await send([['TMP-01', 22]]);
      const jump = await send([['TMP-01', 29]]);
      await send([['TMP-01', 22.5], ['SM-02', 65.5]]);
      await send([['CO2-01', 900]]);
      const z = await send([['CO2-01', 1250]]);
      await send([['CO2-01', 900]]);
      await send([['CO2-01', 600]]);
      injected = { oor, jump, z };
    });
    const since = staleWindow ? new Date(Math.min(staleWindow.start, start)) : start;
    const recs = await L.sqlProof(t, 'Anomaly records (injected values and the silent period of US16-T5)', "SELECT a.detected_at, a.sensor_id, a.method, a.value, round(a.score, 2) AS score, a.measurement_id, left(a.explanation, 90) AS explanation FROM anomalies a WHERE a.detected_at >= $1 ORDER BY a.method, a.detected_at", [since], 20);
    const methods = [...new Set(recs.rows.map((r) => r.method))].sort();
    const dups = await L.sqlProof(t, 'Duplicate check (same measurement and method)', 'SELECT measurement_id, method, COUNT(*)::int AS n FROM anomalies WHERE measurement_id IS NOT NULL GROUP BY measurement_id, method HAVING COUNT(*) > 1');
    const flagged = await L.sqlProof(t, 'Flagged measurements', 'SELECT m.id, m.sensor_id, m.value, m.is_anomaly, a.method FROM measurements m JOIN anomalies a ON a.measurement_id = m.id WHERE a.detected_at >= $1 ORDER BY a.detected_at', [start]);
    L.condition(t.key, 1, `All five methods are implemented and produced records: ${methods.join(', ')}. OUT_OF_RANGE, SUDDEN_JUMP and ZSCORE were injected through the ingestion API; MISSING_DATA and FLATLINE were produced by the periodic job during the silent period of US16-T5 (soil sensors silent for 6 minutes while the tank sent exactly 80 % — flatline window temporarily 3 minutes, restored to 30).`, [recs.proof, P.code('server/src/modules/anomalies/service.js', 'async function checkMeasurement', 30)]);
    L.condition(t.key, 2, `Anomalies are stored without duplicates (${dups.rows.length} duplicated measurement/method pairs; unique index uq_anomalies_measurement_method; the periodic methods require a quiet period).`, [dups.proof]);
    L.condition(t.key, 3, 'Readings that are sensor faults (out of range, sudden jump) are marked is_anomaly = true; a statistical outlier is recorded but the reading stays usable because it may be real.', [flagged.proof]);
    L.condition(t.key, 4, 'Anomaly records produced by injected values.', [L.saveCalls(t, 'Injected readings', [injected.oor, injected.jump, injected.z], 12)]);
  });

  await T(ctx, '3:US19-T5', async (t) => {
    const start = new Date(Date.now() - 1000);
    await L.device.exclusive(async () => {
      await normal();
      await send([['SM-02', 150]]);
      await send([['TMP-01', 22]]);
      await send([['TMP-01', 29]]);
      await send([['TMP-01', 22.5], ['SM-02', 65.5]]);
    });
    const from = start.toISOString();
    const to = new Date(Date.now() + 1000).toISOString();
    const all = await L.call('GET', `/api/anomalies?from=${from}`, { as: 'producer' });
    const bySensor = await L.call('GET', `/api/anomalies?sensor_id=SM-02&from=${from}`, { as: 'producer' });
    const byType = await L.call('GET', `/api/anomalies?method=SUDDEN_JUMP&from=${from}`, { as: 'producer' });
    const combined = await L.call('GET', `/api/anomalies?sensor_id=TMP-01&method=SUDDEN_JUMP&from=${from}&to=${to}`, { as: 'producer' });
    const rows = (r) => (Array.isArray(r.body) ? r.body : r.body.items || r.body.anomalies || []);
    const newest = rows(all).map((a) => a.detected_at);
    const ordered = newest.every((d, i) => i === 0 || new Date(newest[i - 1]) >= new Date(d));
    const meas = await L.call('GET', `/api/sensors/SM-02/measurements?include_anomalies=true&from=${from}`, { as: 'producer' });
    const anon = await L.call('GET', '/api/anomalies');
    const summary = [['All (from = start of the test)', rows(all).length], ['sensor_id = SM-02', rows(bySensor).length], ['method = SUDDEN_JUMP', rows(byType).length], ['sensor_id = TMP-01 + method = SUDDEN_JUMP + from/to', rows(combined).length]];
    L.condition(t.key, 1, `GET /api/anomalies accepts sensor_id, method (the anomaly type), from and to, alone or combined, and returns the newest first (order checked: ${ordered}).`, [P.table('Filtered queries', ['Filter', 'Anomalies returned'], summary.map(([a, b]) => [a, String(b)]), [6000, 3360]), L.saveCalls(t, 'Filtered queries', [all, bySensor, byType, combined], 30)]);
    L.condition(t.key, 2, 'The measurements used by the dashboard include the is_anomaly flag (the 150 % reading is returned with is_anomaly = true).', [L.saveCalls(t, 'Measurements with the anomaly flag', [meas], 30)]);
    L.condition(t.key, 3, `Without a token the API answers ${anon.status}; reading requires the anomalies.read permission.`, [L.saveCalls(t, 'Unauthenticated request', [anon]), P.code('server/src/modules/anomalies/routes.js', 'router.use(requireAuth)', 26)]);
    L.condition(t.key, 4, 'Request/response of the filtered queries (the same requests are in the Postman collection).', []);
  });

  await T(ctx, '3:US19-T6', async (t) => {
    await L.device.exclusive(() => send([['SM-02', 150]]));
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '.sensor-card');
    const card = await L.shot(t, page, 'Sensor card of SM-02 with the "Anomaly" badge.', { selector: '.sensor-card[data-sensor="SM-02"]' });
    const list = await L.shot(t, page, 'Recent unusual readings: type, sensor, value, time, plain-language advice and the technical explanation.', { selector: '#anomalies-panel' });
    const full = await L.shot(t, page, 'Dashboard with the anomaly badge and the list.', { fullPage: true });
    const text = await page.locator('#anomalies-panel').innerText();
    await context.close();
    await L.device.exclusive(() => send([['SM-02', 65.5]]));
    L.condition(t.key, 1, 'The badge is visible on the affected sensor card.', [card]);
    L.condition(t.key, 2, 'The list of recent anomalies shows the type and the explanation.', [list]);
    L.condition(t.key, 3, 'Each entry starts with a sentence a non-technical user can act on (for example "The sensor reported a value it cannot physically measure. Check that it is connected."), followed by the technical detail.', [P.block('Text shown in the panel', text.split('\n').slice(0, 14).join('\n')), full]);
    L.condition(t.key, 4, 'Screenshot of the dashboard with anomalies.', []);
  });

  await T(ctx, '3:US19-T8', async (t) => {
    const rows = [];
    const recent = async (sensor, method, since) => (await L.sql('SELECT id FROM anomalies WHERE sensor_id = $1 AND method = $2 AND detected_at >= $3', [sensor, method, since])).length > 0;
    const start = new Date(Date.now() - 1000);
    await L.device.exclusive(async () => {
      await normal();
      await send([['TMP-01', 22]]);
      await send([['TMP-01', 30]]);
      await send([['TMP-01', 23]]);
      await send([['SM-02', 140]]);
      await send([['SM-02', 65]]);
      await send([['CO2-01', 880]]);
      await send([['CO2-01', 1260]]);
      await send([['CO2-01', 880]]);
      await send([['CO2-01', 600]]);
    });
    rows.push({ id: 'AN-01', case: 'Spike (sudden jump)', steps: 'TMP-01 22 → 30 °C', input: '+8 °C', expected: 'SUDDEN_JUMP', actual: (await recent('TMP-01', 'SUDDEN_JUMP', start)) ? 'SUDDEN_JUMP recorded' : 'not detected', result: (await recent('TMP-01', 'SUDDEN_JUMP', start)) ? 'PASS' : 'FAIL' });
    rows.push({ id: 'AN-02', case: 'Out-of-range value', steps: 'SM-02 = 140 %', input: '140 %', expected: 'OUT_OF_RANGE', actual: (await recent('SM-02', 'OUT_OF_RANGE', start)) ? 'OUT_OF_RANGE recorded' : 'not detected', result: (await recent('SM-02', 'OUT_OF_RANGE', start)) ? 'PASS' : 'FAIL' });
    rows.push({ id: 'AN-03', case: 'Outlier (z-score)', steps: 'CO2-01 880 → 1 260 ppm', input: 'z > 3', expected: 'ZSCORE', actual: (await recent('CO2-01', 'ZSCORE', start)) ? 'ZSCORE recorded' : 'not detected', result: (await recent('CO2-01', 'ZSCORE', start)) ? 'PASS' : 'FAIL' });
    const since = staleWindow ? staleWindow.start : start;
    const flat = await recent('WL-01', 'FLATLINE', since);
    const missing = await recent('SM-01', 'MISSING_DATA', since);
    rows.push({ id: 'AN-04', case: 'Flatline', steps: 'WL-01 exactly 80 % for 6 min (window 3 min)', input: 'US16-T5 silent period', expected: 'FLATLINE', actual: flat ? 'FLATLINE recorded' : 'not detected', result: flat ? 'PASS' : 'FAIL' });
    rows.push({ id: 'AN-05', case: 'Disconnection', steps: 'soil sensors silent for 6 min', input: 'US16-T5 silent period', expected: 'MISSING_DATA', actual: missing ? 'MISSING_DATA recorded' : 'not detected', result: missing ? 'PASS' : 'FAIL' });
    // False-positive rate on 24 h of normal data (isolated test database).
    const fpFile = path.join(ctx.OUT, 'fp_replay.json');
    const replay = await L.run('node', ['tools/evidence/fp_replay.js', '--out', fpFile], { timeout: 900000 });
    const fp = JSON.parse(fs.readFileSync(fpFile, 'utf8'));
    const fpName = L.copyFile(t, fpFile, 'json');
    L.saveFile(t, 'txt', replay.out);
    rows.push({ id: 'AN-06', case: 'False positives on normal data', steps: 'Replay 24 h of normal readings through the ingestion API', input: `${fp.accepted} readings`, expected: 'low false-positive rate', actual: `${fp.anomalies_total} anomalies = ${fp.false_positive_rate_pct} % (${fp.readings_flagged_invalid} readings invalidated = ${fp.invalidated_rate_pct} %)`, result: fp.false_positive_rate_pct < 1 ? 'PASS' : 'FAIL' });
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '#anomalies-panel');
    const shot = await L.shot(t, page, 'The injected anomalies in the dashboard list.', { selector: '#anomalies-panel' });
    await context.close();
    L.condition(t.key, 1, 'Every anomaly type was detected: spike, out-of-range value, outlier, flatline and disconnection.', [shot]);
    L.condition(t.key, 2, `False-positive rate on 24 h of normal data: ${fp.anomalies_total} anomalies for ${fp.accepted} readings = ${fp.false_positive_rate_pct} %; readings wrongly excluded as faults: ${fp.readings_flagged_invalid} (${fp.invalidated_rate_pct} %). Method: fresh test database, 24 h generated with the seed-history model without faults, replayed in time order through POST /api/measurements.`, [
      P.table('False positives by method', ['Method', 'Count'], fp.by_method.length ? fp.by_method.map((m) => [m.method, String(m.n)]) : [['(none)', '0']], [5000, 4360]),
      P.block('Replay report', JSON.stringify({ ...fp, examples: fp.examples.slice(0, 4) }, null, 2), fpName),
    ]);
    L.condition(t.key, 3, 'Results and screenshots saved (test table, replay report, dashboard list).', []);
    L.condition(t.key, 4, 'Test report with detection results.', []);
    L.testCases(t.key, rows, 'Anomaly detection tests');
  });

  // =========================================================================
  // Week 3 — automated tests, performance, documentation and tuning
  // (board tasks without evidence until October 30, 2026)
  // =========================================================================
  await T(ctx, '3:US11-T6', async (t) => {
    const files = ['server/tests/unit/alert-engine.test.js'];
    const run = await jestRun(ctx, t, files, { noDb: true });
    const jf = L.saveFile(t, 'txt', run.out);
    const boundary = testsLike(run, /exactly the (minimum|maximum)|just (below|above)/);
    const groups = ['alert creation', 'boundary values', 'de-duplication', 'automatic resolution', 'light at night']
      .map((g) => { const list = testsLike(run, new RegExp(`US11-T6 ${g}`)); return [g, String(list.length), statusOf(list)]; });
    L.must(run.tests.length >= 8, 'at least 8 unit tests');
    L.condition(t.key, 1, `${run.tests.length} unit tests of evaluateMeasurement() in ${files[0]} (at least 8 required). The database is replaced by an in-memory fake (server/tests/unit/fakes/alertsDb.js) that answers the statements of the alert engine, so the tests check the evaluation logic itself.`, [
      P.table('Unit tests by behaviour', ['Behaviour', 'Tests', 'Result'], groups, [4200, 1500, 3660]),
      P.code('server/tests/unit/fakes/alertsDb.js', 'function createAlertsDb', 24),
    ]);
    L.condition(t.key, 2, `Boundary values covered (${statusOf(boundary)}): a value exactly equal to the minimum or the maximum (soil 60 % and 80 %, temperature 15 °C and 25 °C) is inside the range and raises no alert; 0.01 below the minimum or above the maximum raises LOW or HIGH. Returning exactly to the minimum also resolves the open alert.`, [
      P.code(files[0], "describe('US11-T6 boundary values", 24),
    ]);
    await passAndCommitted(t, 3, run, [...files, 'server/tests/unit/fakes/alertsDb.js'], jf);
    L.condition(t.key, 4, `Test runner output with all tests passing (${jf}). The suite was run with a Jest configuration without the database setup and DATABASE_URL pointing to a closed port, so it needs no PostgreSQL.`, [P.block('Jest configuration used (no database)', JSON.stringify(run.config, null, 2))]);
    L.testCases(t.key, testRows(run, 'UT'), 'Automated unit tests (Jest run)');
  });

  await T(ctx, '3:US11-T8', async (t) => {
    const out = path.join(ctx.OUT, 'ingest_perf.json');
    const r = await L.run('node', ['tools/evidence/ingest_perf.js', '--out', out, '--logdir', ctx.OUT], { timeout: 600000 });
    L.must(r.code === 0 && fs.existsSync(out), `ingest_perf.js finished (${r.out.slice(-300)})`);
    const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
    const jsonName = L.copyFile(t, out, 'json');
    const logWith = L.copyFile(t, path.join(ctx.OUT, 'ingest_perf_with.log'), 'log');
    const logWithout = L.copyFile(t, path.join(ctx.OUT, 'ingest_perf_without.log'), 'log');
    const [w, wo] = rep.runs;
    const table = P.table('Response time of POST /api/measurements (round trip measured by the simulator)',
      ['Run', 'Requests', 'Burst duration', 'Average', 'Median', 'p95', 'Max', 'Alerts created'],
      rep.runs.map((x) => [x.label, String(x.requests), `${x.duration_s} s`, `${x.avg_ms} ms`, `${x.median_ms} ms`, `${x.p95_ms} ms`, `${x.max_ms} ms`, String(x.alerts_in_db)]),
      [2000, 900, 1100, 1000, 1000, 900, 900, 1560]);
    const chart = await L.renderChart(t, {
      type: 'bar',
      data: { labels: ['Average', 'Median', 'p95', 'Maximum'], datasets: [
        { label: 'with alert evaluation', data: [w.avg_ms, w.median_ms, w.p95_ms, w.max_ms], backgroundColor: '#9e1b32' },
        { label: 'without alert evaluation', data: [wo.avg_ms, wo.median_ms, wo.p95_ms, wo.max_ms], backgroundColor: '#5f6368' },
      ] },
      options: { plugins: { title: { display: true, text: `POST /api/measurements response time, burst of ${w.requests} requests (limit: average < 500 ms)` } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'milliseconds' } } } },
    }, 'Response times with and without alert evaluation (data: attached JSON).', { width: 1000, height: 420 });
    L.condition(t.key, 1, `The IoT simulator sent the same burst twice to the real API (isolated test database with 24 h of SM-01 history so the anomaly checks work on a realistic window): ${w.requests} POST /api/measurements of SM-01 in ${w.duration_s} s (one every ${rep.burst.interval_s} s, more than 100 in one minute), scenario "alerts" — odd cycles leave the range and raise an alert, even cycles resolve it (${w.alerts_in_db} alerts created). Run 1 with the alert evaluation of US11-T4; run 2 with evaluateMeasurement() replaced by a no-op. A 10-request warm-up was discarded.`, [
      P.code('tools/evidence/ingest_perf.js', 'for (const [label, evaluate] of', 14),
      P.block('Simulator log, run with alert evaluation (excerpt)', fs.readFileSync(path.join(ctx.OUT, 'ingest_perf_with.log'), 'utf8').trim().split('\n').slice(0, 14).join('\n'), logWith),
    ]);
    L.condition(t.key, 2, `Average and maximum recorded: with evaluation ${w.avg_ms} ms average / ${w.max_ms} ms maximum (p95 ${w.p95_ms} ms); without evaluation ${wo.avg_ms} ms / ${wo.max_ms} ms. The alert evaluation adds ${rep.overhead_avg_ms} ms on average.`, [table, chart]);
    L.condition(t.key, 3, rep.pass
      ? `The average response time with alert evaluation (${w.avg_ms} ms) stays below 500 ms, ${Math.round(500 / w.avg_ms)} times under the limit; no defect is registered.`
      : `The average response time with alert evaluation (${w.avg_ms} ms) is above 500 ms: defect registered for Sprint 4.`, []);
    L.condition(t.key, 4, `Response time table and simulator logs (${jsonName}, ${logWith}, ${logWithout}).`, [
      P.block('Simulator delivery report, run without alert evaluation', fs.readFileSync(path.join(ctx.OUT, 'ingest_perf_without.log'), 'utf8').trim().split('\n').slice(-4).join('\n'), logWithout),
    ]);
  });

  await T(ctx, '3:US11-T9', async (t) => {
    const calls = [];
    const rows = [];
    const check = (doc, c, ok) => { calls.push(c); rows.push([`${c.method} ${c.url.replace('/api', '')}`, doc, `HTTP ${c.status}${c.body && c.body.code ? ` ${c.body.code}` : ''}`, ok ? 'matches' : 'DIFFERS']); };
    await L.device.exclusive(async () => {
      await normal();
      const low = await send([['SM-01', 57]]);
      const a = L.must(alertOf(low, 'SM-01'), 'an open SM-01 alert for the acknowledgement check');
      let c = await L.call('GET', '/api/alerts?status=OPEN&sensor_id=SM-01&limit=1', { as: 'producer' });
      check('200 { total, limit, offset, count, data[] }, newest first', c, c.status === 200 && ['total', 'limit', 'offset', 'count', 'data'].every((k) => k in c.body));
      c = await L.call('PATCH', `/api/alerts/${a.id}/ack`, { as: 'producer' });
      check('200, ACKNOWLEDGED with acknowledged_by / acknowledged_at', c, c.status === 200 && c.body.status === 'ACKNOWLEDGED' && c.body.acknowledged_by);
      const first = c.body.acknowledged_at;
      c = await L.call('PATCH', `/api/alerts/${a.id}/ack`, { as: 'admin' });
      check('200, idempotent: keeps the first acknowledger and time', c, c.status === 200 && c.body.acknowledged_at === first && c.body.acknowledged_by === 'usr-producer');
      await normal();
      await L.sleep(300);
      c = await L.call('PATCH', `/api/alerts/${a.id}/ack`, { as: 'producer' });
      check('400 ERR_VALIDATION_FAILED: a RESOLVED alert cannot be acknowledged', c, c.status === 400 && c.body.code === 'ERR_VALIDATION_FAILED');
    });
    let c = await L.call('PATCH', '/api/alerts/alr-does-not-exist/ack', { as: 'producer' });
    check('404 ERR_RESOURCE_NOT_FOUND', c, c.status === 404 && c.body.code === 'ERR_RESOURCE_NOT_FOUND');
    c = await L.call('GET', '/api/alerts?severity=URGENT', { as: 'producer' });
    check('400 ERR_VALIDATION_FAILED (unknown severity)', c, c.status === 400 && c.body.code === 'ERR_VALIDATION_FAILED');
    c = await L.call('GET', '/api/alerts?limit=5000', { as: 'producer' });
    check('400 ERR_VALIDATION_FAILED (limit 1–1000)', c, c.status === 400);
    c = await L.call('GET', '/api/alerts', {});
    check('401 ERR_AUTH_REQUIRED (no token)', c, c.status === 401 && c.body.code === 'ERR_AUTH_REQUIRED');
    c = await L.call('GET', '/api/alerts/export.csv?limit=3', { as: 'producer' });
    check('200 text/csv with the same filters', c, c.status === 200 && /text\/csv/.test(c.contentType || ''));
    L.must(rows.every((r) => r[3] === 'matches'), `every documented response matches the API (${rows.filter((r) => r[3] !== 'matches').map((r) => r[0]).join(', ')})`);
    L.section(t.key, 'Alert API and alert rules (docs/API.md)', [
      P.code('docs/API.md', '#### Alert API and alert rules in detail (US11-T9)', 80, 'Producer guide: `docs/USER_MANUAL.md`'),
    ]);
    L.section(t.key, 'Producer guide (docs/USER_MANUAL.md, section 3.4)', [P.code('docs/USER_MANUAL.md', '### 3.4 Alerts', 40, 'Other alerts you may see')]);
    L.condition(t.key, 1, 'The alert endpoints GET /api/alerts, PATCH /api/alerts/:id/ack and GET /api/alerts/export.csv are documented with their permission, parameters, response and errors, together with the alert rules (LOW, HIGH, inclusive limits, de-duplication, severity upgrade, automatic resolution, light at night, sensor faults). Every documented response was checked against the running API.', [
      P.table('Documented response vs the running API', ['Call', 'Documented', 'Observed', 'Check'], rows, [2700, 3500, 2000, 1160]),
      L.saveCalls(t, 'Calls used to check the documentation', calls, 12),
    ]);
    L.condition(t.key, 2, 'The producer guide (section 3.4 of the user manual) explains in plain language what LOW and HIGH mean, the three severity levels with what to do, why only one alert is shown while a problem continues, and how to acknowledge an alert and what happens afterwards.', []);
    L.condition(t.key, 3, 'Product Owner review of docs/API.md (alert section) and docs/USER_MANUAL.md section 3.4.', [], {
      pending: 'The Product Owner (Alexis Enrique Valle Parra) must read the alert section of docs/API.md and section 3.4 of the user manual and confirm it (team chat or the next meeting record). Then add the approval record to tools/evidence/board_sprint3.js (APPROVAL["US11-T9"]) and rebuild this document.',
    });
    L.condition(t.key, 4, 'API documentation and producer guide (sections above; files docs/API.md and docs/USER_MANUAL.md in the repository).', []);
  });

  await T(ctx, '3:US12-T3', async (t) => {
    const files = ['server/tests/unit/severity.test.js'];
    const run = await jestRun(ctx, t, files, { noDb: true });
    const jf = L.saveFile(t, 'txt', run.out);
    const bounds = testsLike(run, /boundaries|is created with severity|deviationPercent|limits/);
    const upgrade = testsLike(run, /LOW -> MEDIUM -> HIGH|never downgraded/);
    L.condition(t.key, 1, `The three levels and their boundaries are covered (${statusOf(bounds)}): 9 % and 10 % → LOW, 11 %, 24 % and 25 % → MEDIUM, 26 % → HIGH, on the classification function and on real alerts created by evaluateMeasurement(); the deviation formula below the minimum and above the maximum; configurable limits.`, [
      P.code(files[0], "describe('US12-T3 severity boundaries", 12),
    ]);
    L.must(upgrade.length >= 2, 'severity upgrade tests');
    L.condition(t.key, 2, `Severity upgrade covered (${statusOf(upgrade)}): one open alert goes LOW → MEDIUM → HIGH as the soil keeps drying, and it is never downgraded while it stays open.`, [
      P.code(files[0], "test('LOW -> MEDIUM -> HIGH", 20),
    ]);
    await passAndCommitted(t, 3, run, [...files, 'server/tests/unit/fakes/alertsDb.js'], jf);
    L.condition(t.key, 4, `Test runner output with all tests passing (${jf}), run without database.`, []);
    L.testCases(t.key, testRows(run, 'SV'), 'Automated unit tests (Jest run)');
  });

  await T(ctx, '3:US15-T8', async (t) => {
    const files = ['server/tests/integration/commands.test.js'];
    const run = await jestRun(ctx, t, files);
    const jf = L.saveFile(t, 'txt', run.out);
    const cover = [
      ['POST /actuators/:id/command', '201 PENDING, source MANUAL', /full cycle|can send a command in MANUAL mode/],
      ['POST /actuators/:id/command', '400 in AUTOMATIC mode', /refused while the area is in AUTOMATIC/],
      ['POST /actuators/:id/command', '400 invalid duration or action', /(maximum \(10 min\)|non-positive duration|unknown action) -> 400$/],
      ['POST /actuators/:id/command', '401 no token / device key', /without a token|device API key cannot send/],
      ['POST /actuators/:id/command', '403 role without actuators.command', /without actuators\.command/],
      ['POST /actuators/:id/command', '404 unknown actuator', /unknown actuator -> 404/],
      ['POST /actuators/:id/command', '409 a command already in flight', /in flight -> 409/],
      ['GET /devices/me/commands', '200 commands handed out once (SENT)', /full cycle|poll answers device_id/],
      ['GET /devices/me/commands', '401 user token or wrong key', /need a valid device key/],
      ['POST /actuators/:id/state', '200 EXECUTED + event with the command source', /full cycle|OFF cycle/],
      ['POST /actuators/:id/state', '200 report without command → source SYSTEM', /without a pending command/],
      ['POST /actuators/:id/state', '400 invalid state or duration', /invalid state reports/],
      ['POST /actuators/:id/state', '401 / 404 (other device)', /need a valid device key|another device/],
      ['GET /actuators/:id/commands', '200 history with the EXPIRED command', /never confirmed also expires/],
    ].map(([ep, c, re]) => { const list = testsLike(run, re); return [ep, c, list.map((x) => x.title).join('; ') || 'NOT COVERED', statusOf(list)]; });
    L.must(cover.every((r) => r[2] !== 'NOT COVERED'), 'every endpoint case covered');
    const expiry = testsLike(run, /expir/i);
    L.condition(t.key, 1, `Success and error cases of every endpoint of the command flow are covered by ${run.tests.length} integration tests (real API + isolated test database):`, [
      P.table('Coverage by endpoint', ['Endpoint', 'Case', 'Tests', 'Result'], cover, [2100, 2400, 3860, 1000]),
    ]);
    L.condition(t.key, 2, `Expiry flow covered (${statusOf(expiry)}): expires_at = creation + command.expiry_seconds (60 s); a command nobody collects becomes EXPIRED and is never delivered; the poll itself closes stale commands and an expired command frees the actuator for a new one; a SENT command never confirmed also expires (offline device).`, [
      P.code(files[0], "describe('US15-T8 command API: expiry", 34),
    ]);
    await passAndCommitted(t, 3, run, files, jf);
    L.condition(t.key, 4, `Test runner output with all tests passing (${jf}).`, []);
    L.testCases(t.key, testRows(run, 'CM'), 'Automated integration tests (Jest run)');
  });

  await T(ctx, '3:US15-T10', async (t) => {
    const calls = [];
    let expired = null;
    await L.device.exclusive(async () => {
      await setMode('MANUAL');
      await L.device.execute();
      const on = await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'ON', duration_min: 1, reason: 'US15-T10 protocol check' } });
      L.must(on.status === 201 && on.body.status === 'PENDING', `command queued (${on.status} ${JSON.stringify(on.body).slice(0, 200)})`);
      const dup = await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'OFF' } });
      const poll = await L.call('GET', '/api/devices/me/commands', { as: 'device' });
      const ack = await L.call('POST', '/api/actuators/ACT-FAN-01/state', { as: 'device', body: { state: 'ON', duration_min: 1 } });
      const off = await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'OFF' } });
      await L.call('GET', '/api/devices/me/commands', { as: 'device' });
      const offAck = await L.call('POST', '/api/actuators/ACT-FAN-01/state', { as: 'device', body: { state: 'OFF' } });
      calls.push(on, dup, poll, ack, off, offAck);
      // Offline device: nobody polls for more than command.expiry_seconds.
      const lost = await L.call('POST', '/api/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'ON', duration_min: 1, reason: 'US15-T10 expiry check (device offline)' } });
      await L.sleep(62000);
      const late = await L.call('GET', '/api/devices/me/commands', { as: 'device' });
      const hist = await L.call('GET', '/api/actuators/ACT-FAN-01/commands', { as: 'producer' });
      expired = Array.isArray(hist.body) ? hist.body.find((x) => x.id === lost.body.id) : null;
      calls.push(lost, late, { ...hist, body: Array.isArray(hist.body) ? hist.body.slice(0, 3) : hist.body });
      L.must(late.body.count === 0 && expired && expired.status === 'EXPIRED', 'the command of the offline device expired');
    });
    const seq = await L.renderMermaid(t, 'polling_protocol', `sequenceDiagram
  participant U as Web / engine
  participant A as API
  participant D as Device (poll every 5 s)
  U->>A: POST /actuators/:id/command {action, duration_min}
  A-->>U: 201 PENDING (expires_at = now + 60 s)
  D->>A: GET /devices/me/commands (apikey)
  A-->>D: 200 {commands[]} → SENT
  D->>D: switch relay / servo, start duration timer
  D->>A: POST /actuators/:id/state {state, duration_min}
  A-->>D: 200 → EXECUTED + actuator event (source, user)
  Note over A: not collected or not confirmed before expires_at → EXPIRED`, 'Polling protocol between the API and the device.');
    const states = await L.renderMermaid(t, 'command_states', `stateDiagram-v2
  [*] --> PENDING: POST /command
  PENDING --> SENT: device poll
  SENT --> EXECUTED: POST /state
  PENDING --> EXPIRED: 60 s without poll
  SENT --> EXPIRED: 60 s without confirmation
  EXECUTED --> [*]
  EXPIRED --> [*]`, 'States of an actuator command.', 900);
    L.section(t.key, 'Actuator command API and polling protocol (docs/API.md)', [P.code('docs/API.md', '#### Actuator command API and polling protocol (US15-T10)', 110, 'cannot be reached.')]);
    const params = await L.sqlProof(t, 'Timeouts stored in system_parameters (running database)', "SELECT key, value, description FROM system_parameters WHERE key IN ('command.expiry_seconds', 'actuator.offline_minutes', 'device.offline_minutes') ORDER BY key");
    L.condition(t.key, 1, 'The three endpoints of the flow (queue a command, poll, acknowledge) are documented with their permission or API key, request and response payloads and errors. The payloads were captured from the running API with the same calls the firmware and the simulator make:', [seq, L.saveCalls(t, 'Protocol calls against the running API (queue, 409, poll, acknowledge, expiry)', calls, 14)]);
    L.condition(t.key, 2, `Command states (PENDING, SENT, EXECUTED, EXPIRED, FAILED) and the timing are documented: polling every 5 s (firmware POLL_INTERVAL_MS), expiry 60 s (command.expiry_seconds), expiry check on every poll and every minute, actuator OFFLINE after 5 min, maximum 10 min per irrigation, engine every 30 s. Checked live: a command left without a poll for 62 s was ${expired ? expired.status : 'not found'} and was not delivered.`, [
      states, params.proof,
      P.code('iot/esp32_smartgreen/esp32_smartgreen.ino', 'const unsigned long POLL_INTERVAL_MS', 3),
      P.code('server/src/modules/commands/service.js', 'async function expireStale', 14),
    ]);
    L.condition(t.key, 3, 'Review by Oscar Abraham Talavera Nava (owner of US-16, which reuses the flow for automatic irrigation).', [], {
      pending: 'Oscar Abraham Talavera Nava must review the protocol section of docs/API.md and confirm it (team chat or meeting record). Then add the approval record to tools/evidence/board_sprint3.js (APPROVAL["US15-T10"]) and rebuild this document.',
    });
    L.condition(t.key, 4, 'API and polling protocol documentation (section above; docs/API.md in the repository).', []);
  });

  await T(ctx, '3:US16-T7', async (t) => {
    const files = ['server/tests/unit/irrigation-engine.test.js'];
    const run = await jestRun(ctx, t, files, { noDb: true });
    const jf = L.saveFile(t, 'txt', run.out);
    const rules = [
      ['Start: 2 consecutive readings below the minimum', /2 consecutive readings below the minimum -> ON|only one reading below|single reading available|exactly at the minimum|configurable/],
      ['Stop at the target moisture', /target is reached -> OFF/],
      ['Stop at the maximum duration', /beyond the maximum duration/],
      ['Cooldown after the previous irrigation', /cooldown/],
      ['Low water tank (+ LOW_WATER alert, no command)', /water tank below|BLOCK_LOW_WATER|no tank sensor/],
      ['Stale sensor (no soil reading for 5 min)', /stale sensor/],
      ['No second command while one is in flight', /already in flight/],
      ['MANUAL mode / engine disabled', /MANUAL mode disables|disabled in the configuration/],
    ].map(([rule, re]) => { const list = testsLike(run, re); return [rule, list.map((x) => x.title).join('; ') || 'NOT COVERED', statusOf(list)]; });
    L.must(rules.every((r) => r[1] !== 'NOT COVERED'), 'every rule covered');
    L.condition(t.key, 1, `Every rule and safety condition of the engine has at least one test (${run.tests.length} tests of decide() and apply()):`, [P.table('Rules covered', ['Rule / safety condition', 'Tests', 'Result'], rules, [2800, 5360, 1200])]);
    L.condition(t.key, 2, 'The readings are mocked: each test describes the situation (soil-moisture averages, age of the newest reading, minutes since the last irrigation, tank level, pump state, configuration) and the database, command flow and alert engine modules are replaced by Jest mocks. No device and no database are needed: the suite ran with DATABASE_URL pointing to a closed port.', [
      P.code(files[0], 'function scenario({', 24),
    ]);
    await passAndCommitted(t, 3, run, files, jf);
    L.condition(t.key, 4, `Test runner output with all tests passing (${jf}).`, []);
    L.testCases(t.key, testRows(run, 'IE'), 'Automated unit tests (Jest run)');
  });

  await T(ctx, '3:US17-T3', async (t) => {
    const files = ['server/tests/integration/events.test.js'];
    const run = await jestRun(ctx, t, files);
    const jf = L.saveFile(t, 'txt', run.out);
    const missing = testsLike(run, /an event without/);
    const daily = testsLike(run, /daily irrigation minutes/);
    const sources = testsLike(run, /source (MANUAL|AUTOMATIC|AI) is accepted|distinguishes MANUAL/);
    const order = testsLike(run, /newest first/);
    L.condition(t.key, 1, `recordEvent rejects events with missing fields (${statusOf(missing)}): an event without actuator, action or source is refused by the database constraints and nothing is stored; unknown sources, actions and actuators are refused too. Valid sources MANUAL, AUTOMATIC and AI are accepted (${statusOf(sources)}) and the query returns the newest event first (${statusOf(order)}).`, [
      P.code(files[0], "describe('US17-T3 recordEvent'", 38),
    ]);
    L.condition(t.key, 2, `Daily irrigation minutes covered (${statusOf(daily)}): an ON closed by the next OFF counts the real minutes, an ON without OFF counts its commanded duration, a late OFF never counts more than the duration, and several irrigations of the same day are added while other actuators are ignored.`, [
      P.code(files[0], "describe('US17-T3 daily irrigation minutes'", 34),
    ]);
    await passAndCommitted(t, 3, run, files, jf);
    L.condition(t.key, 4, `Test runner output with all tests passing (${jf}).`, []);
    L.testCases(t.key, testRows(run, 'EV'), 'Automated tests (Jest run)');
  });

  await T(ctx, '3:US19-T7', async (t) => {
    const files = ['server/tests/unit/anomaly-detection.test.js'];
    const run = await jestRun(ctx, t, files, { noDb: true });
    const jf = L.saveFile(t, 'txt', run.out);
    const methods = ['OUT_OF_RANGE', 'SUDDEN_JUMP', 'ZSCORE', 'MISSING_DATA', 'FLATLINE'].map((m) => {
      const list = run.tests.filter((x) => x.ancestorTitles.some((a) => a.includes(`US19-T7 ${m}`)));
      const pos = list.filter((x) => /^positive/.test(x.title));
      const neg = list.filter((x) => /^negative/.test(x.title));
      return [m, pos.map((x) => x.title.replace(/^positive: /, '')).join('; ') || 'NONE', neg.map((x) => x.title.replace(/^negative: /, '')).join('; ') || 'NONE', statusOf(list)];
    });
    L.must(methods.every((m) => m[1] !== 'NONE' && m[2] !== 'NONE'), 'a positive and a negative test per method');
    L.condition(t.key, 1, 'Each of the five methods has at least one positive and one negative test:', [P.table('Positive and negative tests per method', ['Method', 'Positive (detected)', 'Negative (not detected)', 'Result'], methods, [1500, 3500, 3360, 1000])]);
    L.condition(t.key, 2, 'The tests run without the database: the db module is replaced by an in-memory fake that serves small fixed data sets (for example 24 hourly temperatures around 21.5 °C for the z-score, or four tank readings of exactly 80 % for the flatline) and computes the same aggregates as the SQL. The suite was run with a Jest configuration without the database setup and DATABASE_URL pointing to a closed port.', [
      P.code(files[0], 'const STABLE_TEMP', 3),
      P.block('Jest configuration used (no database)', JSON.stringify(run.config, null, 2)),
    ]);
    await passAndCommitted(t, 3, run, files, jf);
    L.condition(t.key, 4, `Test runner output with all tests passing (${jf}).`, []);
    L.testCases(t.key, testRows(run, 'AD'), 'Automated unit tests (Jest run)');
  });

  await T(ctx, '3:US19-T9', async (t) => {
    const out = path.join(ctx.OUT, 'tune_detection.json');
    const fresh = fs.existsSync(out) && Date.now() - fs.statSync(out).mtimeMs < 24 * 3600 * 1000;
    if (!fresh) {
      const r = await L.run('node', ['tools/evidence/tune_detection.js', '--out', out], { timeout: 1800000 });
      L.must(r.code === 0, `tune_detection.js finished (${r.out.slice(-300)})`);
    }
    const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
    const jsonName = L.copyFile(t, out, 'json');
    const beforeFile = path.join(ctx.OUT, 'tune_detection_before_fix.json');
    const before = fs.existsSync(beforeFile) ? JSON.parse(fs.readFileSync(beforeFile, 'utf8')) : null;
    const beforeName = before ? L.copyFile(t, beforeFile, 'json') : null;
    const chosen = L.must(rep.candidates.find((c) => c.name === rep.chosen), 'a parameter set that meets the target');
    const initial = rep.candidates[0];
    const yes = (v) => (v ? '✓' : '✗');
    const p = (c, k) => String(c.params[k]);
    const candTable = P.table('Candidate parameter sets (24 h of normal data, same data for every set)',
      ['Set', 'z', 'Temp. jump', 'Flatline', 'Tank flatline', 'Ingestion FP', 'Periodic FP', 'Spike', 'Range', 'Outlier', 'Flat', 'Disc.', 'Target'],
      rep.candidates.map((c) => [c.name, p(c, 'anomaly.zscore_threshold'), `${p(c, 'anomaly.jump.temperature')} °C`, `${p(c, 'anomaly.flatline_minutes')} min`, `${p(c, 'anomaly.flatline_minutes.water_level')} min`,
        `${c.ingestion.rate_pct} %`, `${c.periodic.rate_pct} %`, yes(c.detected.spike), yes(c.detected.out_of_range), yes(c.detected.outlier), yes(c.detected.flatline), yes(c.detected.disconnection), c.meets_target ? 'MET' : '—']),
      [1700, 450, 700, 700, 750, 800, 800, 550, 550, 600, 500, 500, 760]);
    const chart = await L.renderChart(t, {
      type: 'bar',
      data: { labels: rep.candidates.map((c) => c.name.split(' — ')[0]), datasets: [
        { label: 'Ingestion false positives (% of readings)', data: rep.candidates.map((c) => c.ingestion.rate_pct), backgroundColor: '#1f5fa8' },
        { label: 'Periodic false positives (% of sensor checks)', data: rep.candidates.map((c) => c.periodic.rate_pct), backgroundColor: '#9e1b32' },
        { type: 'line', label: 'Target 5 %', data: rep.candidates.map(() => 5), borderColor: '#2e7d32', borderDash: [6, 4], pointRadius: 0 },
      ] },
      options: { plugins: { title: { display: true, text: 'False-positive rate on normal data per parameter set (A = initial values)' } }, scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } } },
    }, 'False-positive rates of the candidate sets (data: attached JSON).', { width: 1100, height: 440 });
    const PARAM_ROWS = [
      ['anomaly.zscore_threshold', 'z-score > 3 caused all ingestion false positives (US19-T8: 127 = 5.49 %, night humidity, CO2, light); 3.5 removes two thirds of them and the injected outlier (z ≈ 4) is still found; 4 leaves no margin (the outlier sits at z ≈ 4.0).'],
      ['anomaly.jump.temperature', 'No false positive with 5 °C; a tighter 3 °C finds the same spike and adds nothing, so the initial value is kept.'],
      ['anomaly.jump.soil_moisture', 'No false positive with 15 %; kept.'],
      ['anomaly.flatline_minutes', '15 min adds pH and soil flatlines on normal data, 60 min halves detection speed and still flags the tank; 30 min kept.'],
      ['anomaly.flatline_minutes.water_level', `New per-type window: a tank nobody draws from keeps the same level for hours (${initial.periodic.findings['WL-01 FLATLINE'] || 0} of ${initial.periodic.total} periodic false positives with the initial values). The shortest window that meets the target is kept.`],
    ].map(([k, why]) => [k, String(initial.params[k]), String(chosen.params[k]), why]);
    const paramTable = P.table('Before / after (parameters stored in system_parameters)', ['Parameter', 'Before (US19-T1)', 'After (US19-T9)', 'Reason'], PARAM_ROWS, [2300, 1000, 1000, 5060]);
    const live = await L.sqlProof(t, 'Final values in the running database', "SELECT key, value, description FROM system_parameters WHERE key IN ('anomaly.zscore_threshold', 'anomaly.flatline_minutes', 'anomaly.flatline_minutes.water_level', 'anomaly.jump.temperature', 'anomaly.jump.soil_moisture') ORDER BY key");
    const det = chosen.detected;
    const detTable = P.table(`Injected anomalies with the final set (${chosen.name})`, ['Anomaly (as in US19-T8)', 'Injection', 'Detected'], [
      ['Spike (sudden jump)', 'TMP-01 22 → 30 °C', yes(det.spike)],
      ['Out-of-range value', 'SM-02 = 140 %', yes(det.out_of_range)],
      ['Outlier (z-score)', `CO2-01 880 → 1 260 ppm (z = ${det.outlier_z})`, yes(det.outlier)],
      ['Flatline', `HUM-01 frozen at 61 % for ${chosen.params['anomaly.flatline_minutes'] + 10} min`, yes(det.flatline)],
      ['Disconnection', 'SM-01 silent for 7 min', yes(det.disconnection)],
    ], [3000, 4360, 2000]);
    if (before) {
      const b = before.candidates[0];
      L.section(t.key, 'Defect found while tuning (D-12)', [
        P.text(`The first tuning run (original code, ${before.executed_at.slice(0, 16).replace('T', ' ')} UTC) showed that no flatline time could bring the periodic checks under 5 %: with the initial values the job flagged ${b.periodic.total} of ${b.periodic.sensor_checks} sensor checks (${b.periodic.rate_pct} %) on normal data. Two causes: the light sensor reads a constant 0 lux all night, which is darkness and not a frozen sensor, and an idle water tank keeps the same level for hours. Fix (anomalies service, runPeriodicChecks): FLATLINE is checked on light only during the daylight hours of the greenhouse (the same rule the alert engine already used), and the window can be set per sensor type (anomaly.flatline_minutes.<type>). The unit tests of US19-T7 cover both rules.`),
        P.table('Periodic findings on normal data before the fix (initial values)', ['Sensor and method', 'Findings'], Object.entries(b.periodic.findings).map(([k, n]) => [k, String(n)]), [6000, 3360]),
        P.code('server/src/modules/anomalies/service.js', '// --- 5. Flatline', 22),
      ], 2);
    }
    const week = rep.week_replay;
    L.condition(t.key, 1, `False-positive rate below 5 % on normal data with the final set: ${chosen.ingestion.rate_pct} % of the readings at ingestion (${chosen.ingestion.total} of ${chosen.ingestion.accepted}, 24 h) and ${chosen.periodic.rate_pct} % of the periodic sensor checks (${chosen.periodic.total} of ${chosen.periodic.sensor_checks}).${week ? ` Over 7 days of normal seed data (${week.accepted} readings replayed through the API): ${week.rate_pct} %.` : ''} Before: ${initial.ingestion.rate_pct} % at ingestion in this run (5.49 % measured in US19-T8) and ${initial.periodic.rate_pct} % in the periodic checks. Method: fresh test database, seed-history model without faults, readings replayed in time order through POST /api/measurements; the periodic job evaluated every 30 minutes of the day.`, [candTable, chart]);
    L.condition(t.key, 2, `Every injected anomaly is still detected with the final set (${chosen.all_detected ? 'all five' : 'NOT all'}); set C (z-score 4) is rejected because the injected outlier sits at z ≈ ${det.outlier_z} and has no margin.`, [detTable]);
    L.condition(t.key, 3, 'Final parameters approved by the team.', [paramTable, live.proof], {
      pending: 'The team must approve the final values (z-score 3.5, tank flatline 300 min, the rest unchanged) at a meeting or in the team chat. Then add the approval record to tools/evidence/board_sprint3.js (APPROVAL["US19-T9"]) and rebuild this document.',
    });
    L.condition(t.key, 4, `Before/after table of parameters and detection results (${jsonName}${beforeName ? `, ${beforeName}` : ''}; script tools/evidence/tune_detection.js).`, []);
  });

  // =========================================================================
  // Sprint-level tasks
  // =========================================================================
  await T(ctx, '3:SPR-T1', async (t) => {
    const videoDir = path.join(ctx.OUT, 'video');
    fs.mkdirSync(videoDir, { recursive: true });
    const steps = [];
    const { context, page } = await L.openPage({ role: 'producer', video: videoDir });
    await L.device.exclusive(async () => {
      await L.device.execute();
      await irrigationConfig({ cooldown_min: 1 });
      await setMode('AUTOMATIC');
      await L.sleep(61000);
      await normal();
      await L.goto(page, '/producer/', '.sensor-card');
      await send([['SM-01', 59.4, 1], ['SM-02', 59.1, 1], ['SM-01', 57.2], ['SM-02', 56.8]]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      steps.push(await L.shot(t, page, 'Step 1–2 — low soil moisture from the node: alert with severity on the dashboard.', { fullPage: false }));
      await L.goto(page, '/producer/alerts.html', 'table');
      steps.push(await L.shot(t, page, 'Step 3 — the alert in the alert history.', { fullPage: false }));
      L.must(await waitFor(async () => (await L.sql("SELECT id FROM actuator_commands WHERE source = 'AUTOMATIC' AND action = 'ON' AND created_at > NOW() - INTERVAL '2 minutes'"))[0], 70000, 2000), 'automatic ON during the integration test');
      await L.device.execute();
      await L.goto(page, '/producer/', '.sensor-card');
      await page.locator(ACT_PANEL).scrollIntoViewIfNeeded();
      steps.push(await L.shot(t, page, 'Step 4 — automatic irrigation started by the engine.', { selector: ACT_PANEL }));
      await send([['SM-01', 61.8], ['SM-02', 61.5]]);
      await L.sleep(1000);
      await send([['SM-01', 65.9], ['SM-02', 65.6]]);
      L.must(await waitFor(async () => (await L.sql("SELECT id FROM actuator_commands WHERE source = 'AUTOMATIC' AND action = 'OFF' AND created_at > NOW() - INTERVAL '2 minutes'"))[0], 70000, 2000), 'automatic OFF during the integration test');
      await L.device.execute();
      await L.goto(page, '/producer/irrigation.html', 'table');
      steps.push(await L.shot(t, page, 'Step 5 — the event log with the automatic activation.', { fullPage: false }));
      await setMode('MANUAL');
      await irrigationConfig({ cooldown_min: 30 });
      await L.goto(page, '/producer/', '.sensor-card');
      await page.click(`${ACT_PANEL} button:has-text("Start irrigation")`);
      await page.fill('.modal input[name="duration_min"]', '1');
      await page.click('.modal button.primary');
      await page.waitForSelector('.toast');
      await L.device.execute();
      await page.reload({ waitUntil: 'networkidle' });
      steps.push(await L.shot(t, page, 'Step 6 — manual irrigation from the dashboard.', { selector: ACT_PANEL }));
      await send([['SM-02', 150]]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#anomalies-panel').scrollIntoViewIfNeeded();
      steps.push(await L.shot(t, page, 'Step 7 — anomaly detection: an impossible reading is flagged and explained.', { selector: '#anomalies-panel' }));
      await send([['SM-02', 65.5]]);
      await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' } });
      await L.device.execute();
    });
    const video = await L.saveVideo(t, context, page);
    const defects = [
      ['D-06', 'US-11', 'A z-score outlier suppressed real threshold alerts (a heat spike raised no alert)', 'Only fault anomalies (out of range, sudden jump) suppress alerts', 'Fixed and retested'],
      ['D-07', 'US-16 / US-20', 'Z-score flags hid a real drying trend from the engine and the AI (no irrigation)', 'Z-score anomalies no longer invalidate readings', 'Fixed and retested'],
      ['D-08', 'US-13', 'A second acknowledgement overwrote who acknowledged the alert', 'Acknowledgement is idempotent', 'Fixed and retested'],
      ['D-09', 'FR-18', 'The lighting window used UTC hours instead of the greenhouse time', 'platform.timezone = America/Mexico_City', 'Fixed and retested'],
      ['D-10', 'US-16', 'Manual and automatic commands could conflict (Daily Meeting 3)', 'Never create a command while another one is pending', 'Fixed'],
      ['D-11', 'US-06', 'Accelerated simulator runs sent timestamps in the future', 'Readings carry the real clock time; physics accelerated only', 'Fixed and retested'],
    ];
    L.condition(t.key, 1, 'The complete flow was executed from the low-moisture reading to the recorded irrigation events: alert with severity → history → automatic irrigation → event log → manual irrigation → anomaly detection.', steps);
    L.condition(t.key, 2, 'Every story of the sprint took part through its owner\'s component: US-11 (Jorge), US-12 and US-13 (Carlos), US-15 (Vicente), US-16 (Oscar), US-17 (Carlos), US-19 (Alexis).', []);
    L.condition(t.key, 3, `Video (${video}) and screenshots are saved; defects found are listed with their resolution (docs/TEST_PLAN.md).`, [P.table('Defects found', ['ID', 'Story', 'Defect', 'Resolution', 'Status'], defects, [600, 1100, 3300, 2800, 1560])]);
    L.condition(t.key, 4, 'Integration video, step screenshots and list of defects.', []);
  });

  await T(ctx, '3:SPR-T2', async (t) => {
    const index = L.catalog.tasks.filter((x) => x.sprint === 3).map((x) => {
      const dir = L.dirOf(x);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${x.base}_`)).length : 0;
      return [x.id, x.title, x.responsible, `${x.folder}/${x.file}`, String(files), x.key === t.key ? 'this document' : 'collected'];
    });
    const burn = [['Sprint start', 'Oct 12', 76.5, 76.5], ['End of Week 1', 'Oct 16', 51, 53.5], ['End of Week 2', 'Oct 23', 25.5, 25.5], ['End of Week 3', 'Oct 30', 0, 0]];
    const chart = await L.renderChart(t, {
      type: 'line',
      data: { labels: burn.map((b) => `${b[0]} (${b[1]})`), datasets: [
        { label: 'Ideal remaining hours', data: burn.map((b) => b[2]), borderColor: '#5f6368', borderDash: [6, 4] },
        { label: 'Actual remaining hours', data: burn.map((b) => b[3]), borderColor: '#9e1b32', backgroundColor: '#9e1b32' },
      ] },
      options: { plugins: { title: { display: true, text: 'Sprint 3 burndown (Scrum board, 76.5 h)' } }, scales: { y: { beginAtZero: true } } },
    }, 'Sprint 3 burndown from the Monday checkpoints.', { width: 900, height: 380 });
    const demo = [
      '1. Simulator scenario "dry": soil moisture falls below 60 %; the alert appears with its severity (US-11, US-12).',
      '2. Alert history with filters and CSV export (US-13).',
      '3. Manual mode: start and stop irrigation with confirmation; the pump reacts in about 5 s (US-15).',
      '4. Automatic mode: the engine irrigates until the target and respects cooldown, tank and stale data (US-16).',
      '5. Irrigation history with manual and automatic events and minutes per day (US-17).',
      '6. Inject an out-of-range value and a spike: badge and plain-language list (US-19).',
    ];
    const demoFile = L.saveFile(t, 'md', `# Sprint 3 — demo script (Sprint Review, October 30, 2026)\n\n${demo.join('\n')}\n`);
    L.condition(t.key, 1, `Every task of Sprint 3 has its evidence file in evidence/Sprint 3/Evidence/<User Story>/ (${index.length} documents).`, [P.table('Sprint 3 evidence index', ['Task', 'Title', 'Responsible', 'Evidence file', 'Attachments', 'Status'], index, [900, 2500, 1500, 2860, 800, 800])]);
    L.condition(t.key, 2, 'Board and burndown updated by the Scrum Master after each Monday meeting (chart from the Review checkpoints).', [chart]);
    L.condition(t.key, 3, 'Demo script ready before the Review.', [P.block('Demo script', demo.join('\n'), demoFile)]);
    L.condition(t.key, 4, 'Evidence folder and demo script ready before the Review.', []);
  });
};
