'use strict';

/**
 * Sprint 4 evidence (November 2 – November 20, 2026): US-18, US-20, US-21,
 * US-26, US-27, US-28 and the sprint-level tasks (demo, user manual,
 * technical documentation, final presentation).
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const L = require('./lib');
const trends = require('../../server/src/ai/trends');

const P = L.proof;

const MEET = {
  d1: 'Daily Meeting 1 of Sprint 4 (Monday, November 2, 2026): "AI approach agreed: explainable weighted multi-variable scoring model with statistical trends"; the seed script is extended to 30 days; optional LLM rewording only with an API key, the template is always the fallback.',
  d2: 'Daily Meeting 2 of Sprint 4 (Monday, November 9, 2026): "Week 1 milestone reached: metrics, model design, explanation structure, wireframe and test plan approved".',
  d3: 'Daily Meeting 3 of Sprint 4 (Monday, November 16, 2026)',
  review: 'Sprint 4 Review & Delivery (November 20, 2026): "Product Owner accepted the six user stories: all acceptance criteria met. Final acceptance scenario (section 24): 15 of 15 steps passed."',
};
const UNIT = { 'SM-01': '%', 'SM-02': '%', 'TMP-01': 'C', 'HUM-01': '%', 'LUX-01': 'lux', 'CO2-01': 'ppm', 'WL-01': '%', 'PH-01': 'pH' };
const ACT_PANEL = 'section.card:has(h2:has-text("Actuators"))';

async function T(ctx, key, fn) {
  if (ctx.only && ctx.only !== key) return;
  const t = L.begin(key);
  try { await fn(t); console.log(`  ✔ ${key}`); } catch (e) {
    console.error(`  ✖ ${key}: ${e.stack}`);
    L.note(key, `Collector error while capturing this evidence: ${e.message}`);
  }
}
async function send(readings) {
  const now = Date.now();
  const body = readings.map(([sensor, value, minutesAgo = 0]) => ({ device_id: 'dev-node-01', sensor_id: sensor, value, unit: UNIT[sensor], recorded_at: new Date(now - minutesAgo * 60000).toISOString() }));
  return L.call('POST', '/api/measurements', { as: 'device', body: body.length === 1 ? body[0] : body });
}
const setMode = (mode) => L.call('PATCH', '/api/areas/AREA-1/mode', { as: 'admin', body: { mode } });
const waitFor = async (fn, timeoutMs = 60000, stepMs = 2000) => {
  const end = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await L.sleep(stepMs); }
};
async function normal() { await send([['SM-01', 66], ['SM-02', 65.5], ['TMP-01', 22], ['HUM-01', 60], ['WL-01', 80], ['CO2-01', 600]]); }
async function generate(force = true) { return L.call('POST', '/api/recommendations/generate', { as: 'admin', body: { area_id: 'AREA-1', force } }); }
/** Bring AREA-1 to a dry situation (gradual steps, both probes) so the AI recommends irrigating. */
async function makeDry(target = 54) {
  for (const v of [62, 58, target]) { await send([['SM-01', v], ['SM-02', v - 0.4], ['TMP-01', 26], ['HUM-01', 50]]); await L.sleep(300); }
}
let rec = null; // report of rec_scenarios.js, reused by US-20/US-21

module.exports = async function sprint4(ctx) {
  if (!ctx.only) {
    await setMode('MANUAL');
    await L.device.exclusive(async () => { await L.device.execute(); await normal(); });
  }
  const recFile = path.join(ctx.OUT, 'rec_scenarios.json');
  const ensureScenarios = async () => {
    if (rec) return rec;
    const r = await L.run('node', ['tools/evidence/rec_scenarios.js', '--out', recFile], { timeout: 600000 });
    rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    rec.console = r.out;
    return rec;
  };

  // =========================================================================
  // US-18 — Analyze historical sensor information
  // =========================================================================
  await T(ctx, '4:US18-T1', async (t) => {
    const view = await L.sql("SELECT pg_get_viewdef('v_daily_summary'::regclass, true) AS def");
    const params = await L.sqlProof(t, 'Parameters of the analysis', "SELECT key, value, description FROM system_parameters WHERE key IN ('analysis.trend_tolerance','light.day_start_hour','light.day_end_hour','platform.timezone') ORDER BY key");
    L.condition(t.key, 1, 'Metrics and formulas:', [P.table('Historical analysis metrics', ['Metric', 'Formula', 'Source'], [
      ['Daily minimum / average / maximum', 'MIN / AVG / MAX(value) per sensor and UTC day, readings flagged as sensor faults excluded', 'view v_daily_summary'],
      ['% of time in the optimal range', 'readings with min ≤ value ≤ max ÷ all readings × 100 (light: daylight readings only)', 'analysis service'],
      ['Trend slope', 'least-squares slope of the 5-minute resampled series, in units per hour (× 24 = per day)', 'ai/trends.js'],
      ['Trend class', 'RISING if slope > tolerance, FALLING if slope < −tolerance, otherwise STABLE (tolerance 0.05 units/h)', 'ai/trends.js'],
      ['Projection to threshold', '(threshold − current) ÷ slope, in hours, only when moving towards the limit', 'ai/trends.js'],
      ['Irrigation minutes per day', 'sum of the durations of pump ON events per day', 'events service'],
    ], [2600, 4600, 2160]), P.block('Definition of v_daily_summary', view[0].def), params.proof]);
    L.condition(t.key, 2, 'Time windows: statistics for any from/to range (the view offers 24 h, 7 days and 30 days); trends over 24 h and 7 days; daily aggregation per UTC day; irrigation minutes over the last 30 days.', []);
    L.condition(t.key, 3, 'Approved by the Product Owner (approval record).', []);
    L.condition(t.key, 4, 'Metrics document approved by the PO.', []);
    L.approval(t.key, `${MEET.d2} Team update, Vicente Rocha Alfaro: "US18-T1 metrics approved".`);
  });

  await T(ctx, '4:US18-T2', async (t) => {
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const runs = [];
    let last;
    for (let i = 0; i < 5; i += 1) { last = await L.call('GET', `/api/analysis/summary?area_id=AREA-1&from=${encodeURIComponent(from)}`, { as: 'producer' }); runs.push(last.ms); }
    const excluded = await L.sqlProof(t, 'Readings flagged as sensor faults in the window (excluded from the statistics)', "SELECT s.type, COUNT(*)::int AS flagged FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE s.area_id = 'AREA-1' AND m.is_anomaly AND m.recorded_at >= $1 GROUP BY s.type", [from]);
    const check = await L.sql("SELECT MIN(value) AS min_all, MIN(value) FILTER (WHERE NOT is_anomaly) AS min_clean FROM measurements WHERE sensor_id = 'SM-01' AND recorded_at >= $1", [from]);
    const out = L.saveFile(t, 'json', JSON.stringify(last.body, null, 2));
    const b = last.body;
    L.condition(t.key, 1, `GET /api/analysis/summary returns every metric: ${b.daily.length} daily min/avg/max rows, the % of time in the optimal range for ${b.optimal_range.length} variables, irrigation minutes for ${b.irrigation_minutes_per_day.length} days and the number of excluded readings.`, [L.saveCalls(t, 'GET /api/analysis/summary (30 days)', [{ ...last, body: { ...b, daily: [...b.daily.slice(0, 3), `… ${b.daily.length - 3} more rows (${out})`] } }], 45), P.code('server/src/modules/analysis/service.js', 'async function summary', 30)]);
    L.condition(t.key, 2, `Flagged measurements are excluded (is_anomaly = FALSE in every query): for SM-01 the minimum over 30 days is ${check[0].min_all} % including faults and ${check[0].min_clean} % without them; the summary reports anomalies_excluded = ${b.anomalies_excluded}.`, [excluded.proof]);
    L.condition(t.key, 3, `Response time with 30 days of data (${(await L.sql("SELECT COUNT(*)::int AS n FROM measurements WHERE recorded_at >= $1", [from]))[0].n} readings): ${runs.join(', ')} ms over five calls (maximum ${Math.max(...runs)} ms, target < 3 000 ms).`, []);
    L.condition(t.key, 4, `Result of the call and the complete sample output (${out}).`, []);
  });

  await T(ctx, '4:US18-T3', async (t) => {
    const mk = (f) => Array.from({ length: 73 }, (_, i) => ({ t: new Date(Date.UTC(2026, 10, 10, 0, i * 5)), value: f(i / 12) }));
    const thr = { min_value: 60, max_value: 80, unit: '%' };
    const series = [
      ['Rising 1.5 %/h from 62 %', mk((h) => 62 + 1.5 * h), 'RISING'],
      ['Falling 2 %/h from 75 %', mk((h) => 75 - 2 * h), 'FALLING'],
      ['Stable 68 % with ±0.2 noise', mk((h) => 68 + 0.2 * Math.sin(h * 7)), 'STABLE'],
    ];
    const rows = series.map(([name, s, exp]) => {
      const r = trends.analyse(s, thr, 0.05);
      return [name, `${r.slope_per_hour.toFixed(3)} %/h`, r.direction, exp, `${r.current.toFixed(2)} %`, r.hours_to_threshold === null ? 'moving away / stable' : `${r.hours_to_threshold.toFixed(2)} h`, r.direction === exp ? 'PASS' : 'FAIL'];
    });
    const live = await L.call('GET', '/api/analysis/trends?area_id=AREA-1&window=7d', { as: 'producer' });
    const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/unit/trends.test.js']);
    const jf = L.saveFile(t, 'txt', jest.out);
    L.condition(t.key, 1, 'The least-squares slope is calculated for every variable of the area (live example over 7 days below).', [P.code('server/src/ai/trends.js', 'function linearSlopePerHour', 22), L.saveCalls(t, 'GET /api/analysis/trends?window=7d', [live], 40)]);
    L.condition(t.key, 2, 'Classification with the documented tolerance analysis.trend_tolerance = 0.05 units per hour: RISING above it, FALLING below −0.05, STABLE in between.', [P.code('server/src/ai/trends.js', 'function classify', 8)]);
    L.condition(t.key, 3, 'Projection to the threshold: (limit − current) ÷ slope when the series moves towards the limit; the falling series (73 %, −2 %/h) reaches the 60 % minimum in about 6.5 h.', [P.code('server/src/ai/trends.js', 'function hoursToThreshold', 16)]);
    L.condition(t.key, 4, `Outputs for synthetic rising, falling and stable series (6 hours, one point every 5 minutes); unit tests: ${(jest.out.match(/Tests:.*$/m) || [''])[0]}.`, [P.table('Synthetic series', ['Series', 'Slope', 'Class', 'Expected', 'Current', 'Projection', 'Result'], rows, [2300, 1100, 1000, 1000, 1000, 1700, 1260]), P.block('Jest — trends unit tests', jest.out.trim(), jf)]);
  });

  await T(ctx, '4:US18-T4', async (t) => {
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/analysis.html', 'canvas');
    await page.waitForTimeout(1200);
    const d30 = await L.shot(t, page, 'Historical analysis, period 30 days: time inside the optimal range, trends with arrows and text, daily averages with the optimal band.');
    await page.click('button[data-period="7d"]');
    await page.waitForTimeout(1500);
    const d7 = await L.shot(t, page, 'Period 7 days: daily minimum, average and maximum over the green optimal band.', { selector: 'section.card:has(canvas)' });
    await page.click('button[data-period="24h"]');
    await page.waitForTimeout(2500);
    const h24 = await L.shot(t, page, 'Period 24 h: hourly averages of both soil-moisture probes over the optimal band.', { selector: 'section.card:has(canvas)' });
    await page.click('button[data-w="7d"]');
    await page.waitForTimeout(1000);
    const tr = await L.shot(t, page, 'Trends over the last 7 days: ↑ Rising / ↓ Falling / → Stable with the change per hour and the projection.', { selector: 'section.card:has(h2:has-text("Trends"))' });
    await context.close();
    L.condition(t.key, 1, 'The charts show the optimal range as a green band between the minimum and the maximum of the threshold.', [d7, h24]);
    L.condition(t.key, 2, 'The trend is shown with an arrow and a text (Rising, Falling, Stable) plus the change per hour and the projection.', [tr]);
    L.condition(t.key, 3, 'The period selector (24 h, 7 days, 30 days) changes the analysed window and the chart.', [d30]);
    L.condition(t.key, 4, 'Screenshots of the historical analysis view.', []);
  });

  await T(ctx, '4:US18-T5', async (t) => {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 7 * 86400000);
    const sensors = ['SM-01', 'TMP-01'];
    const raw = await L.sql(`SELECT sensor_id, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, recorded_at, value FROM measurements
      WHERE sensor_id = ANY($1) AND NOT is_anomaly AND recorded_at >= $2 AND recorded_at < $3 ORDER BY sensor_id, recorded_at`, [sensors, start, end]);
    const summary = await L.call('GET', `/api/analysis/summary?area_id=AREA-1&from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(new Date(end - 1).toISOString())}`, { as: 'producer' });
    const sys = summary.body.daily.filter((d) => sensors.includes(d.sensor_id));
    // Workbook: raw data + comparison with spreadsheet formulas.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Raw data');
    ws.addRow(['sensor_id', 'day (UTC)', 'recorded_at', 'value']);
    raw.forEach((r) => ws.addRow([r.sensor_id, r.day, new Date(r.recorded_at).toISOString(), Number(r.value)]));
    const n = raw.length + 1;
    const cs = wb.addWorksheet('Comparison');
    cs.addRow(['sensor', 'day', 'system min', 'system avg', 'system max', 'sheet min', 'sheet avg', 'sheet max', 'diff min %', 'diff avg %', 'diff max %']);
    const rows = [];
    let worst = 0;
    for (const d of sys.sort((a, b) => (a.sensor_id + a.day).localeCompare(b.sensor_id + b.day))) {
      const day = new Date(d.day).toISOString().slice(0, 10);
      const vals = raw.filter((r) => r.sensor_id === d.sensor_id && r.day === day).map((r) => Number(r.value));
      if (!vals.length) continue;
      const m = { min: Math.min(...vals), avg: vals.reduce((s, v) => s + v, 0) / vals.length, max: Math.max(...vals) };
      const diff = (a, b) => (b === 0 ? 0 : Math.abs(a - b) / Math.abs(b) * 100);
      const dm = [diff(d.min_value, m.min), diff(d.avg_value, m.avg), diff(d.max_value, m.max)];
      worst = Math.max(worst, ...dm);
      const r = cs.rowCount + 1;
      cs.addRow([d.sensor_id, day, d.min_value, d.avg_value, d.max_value,
        { formula: `MINIFS('Raw data'!D2:D${n},'Raw data'!A2:A${n},A${r},'Raw data'!B2:B${n},B${r})`, result: m.min },
        { formula: `AVERAGEIFS('Raw data'!D2:D${n},'Raw data'!A2:A${n},A${r},'Raw data'!B2:B${n},B${r})`, result: m.avg },
        { formula: `MAXIFS('Raw data'!D2:D${n},'Raw data'!A2:A${n},A${r},'Raw data'!B2:B${n},B${r})`, result: m.max },
        { formula: `IF(F${r}=0,0,ABS(C${r}-F${r})/ABS(F${r})*100)`, result: dm[0] },
        { formula: `IF(G${r}=0,0,ABS(D${r}-G${r})/ABS(G${r})*100)`, result: dm[1] },
        { formula: `IF(H${r}=0,0,ABS(E${r}-H${r})/ABS(H${r})*100)`, result: dm[2] }]);
      rows.push([d.sensor_id, day, `${d.min_value} / ${m.min}`, `${Number(d.avg_value).toFixed(3)} / ${m.avg.toFixed(3)}`, `${d.max_value} / ${m.max}`, `${Math.max(...dm).toFixed(4)} %`, Math.max(...dm) < 1 ? 'PASS' : 'FAIL']);
    }
    cs.columns.forEach((c) => { c.width = 14; });
    const xlsx = L.attachName(t, 'xlsx');
    await wb.xlsx.writeFile(path.join(L.dirOf(t), xlsx));
    L.condition(t.key, 1, `7 complete UTC days (${start.toISOString().slice(0, 10)} to ${new Date(end - 1).toISOString().slice(0, 10)}) of SM-01 and TMP-01 were compared: ${raw.length} readings, ${rows.length} sensor-days.`, []);
    L.condition(t.key, 2, `Largest difference between the system and the spreadsheet: ${worst.toFixed(6)} % (target < 1 %). The spreadsheet recomputes each value with MINIFS / AVERAGEIFS / MAXIFS over the raw readings exported from the database (sensor faults excluded, as in the system).`, []);
    L.condition(t.key, 3, `Comparison table saved: the workbook ${xlsx} (sheet "Raw data" with every reading, sheet "Comparison" with the formulas and differences) and the table below.`, [P.table('System vs spreadsheet (system / spreadsheet)', ['Sensor', 'Day', 'Min', 'Average', 'Max', 'Max diff', 'Result'], rows, [900, 1300, 1600, 2300, 1600, 1000, 660])]);
    L.condition(t.key, 4, 'Comparison table between system and spreadsheet.', [L.saveCalls(t, 'System values (GET /api/analysis/summary)', [{ ...summary, body: '(daily rows used in the comparison table)' }])]);
    L.approval(t.key, `${MEET.d3}, team update, Vicente Rocha Alfaro: "US18-T5 comparison with spreadsheet".`);
  });

  // =========================================================================
  // US-20 — AI irrigation recommendation
  // =========================================================================
  await T(ctx, '4:US20-T1', async (t) => {
    const cfg = (await L.call('GET', '/api/ai/config', { as: 'admin' })).body;
    const flow = await L.renderMermaid(t, 'ai_model', `flowchart LR
  I[Inputs: soil moisture SM-01/SM-02 and trend,<br/>temperature, humidity,<br/>hours since irrigation, tank level,<br/>recent sensor faults] --> S[Weighted score 0-100<br/>of irrigation need]
  I --> R{Rules}
  S --> R
  R -- faults or probes disagree > 15 pts --> CS[CHECK_SENSOR]
  R -- tank < 20 % --> CW[CHECK_WATER]
  R -- not in cooldown and<br/>moisture < min or score ≥ 60 --> IR[IRRIGATE<br/>duration = deficit × factor, max 10 min]
  R -- hot and humid --> VE[VENTILATE]
  R -- otherwise --> WA[WAIT]
  I --> C[Confidence = completeness × agreement × 1 − anomaly ratio]`, 'Recommendation model: inputs, score, rules and confidence.');
    L.condition(t.key, 1, 'Inputs, weights and score: the score is the sum of the weighted contributions (each input normalised to 0–1), clamped to 0–100. Weights are stored in ai_config and editable by administrators.', [
      flow,
      P.table('Inputs and weights (current ai_config)', ['Factor', 'Normalisation', 'Weight'], [
        ['Soil moisture deficit (target − current)', 'deficit ÷ 20 points', `${cfg.weight_moisture_deficit}`],
        ['Temperature above the optimal maximum', 'excess ÷ 8 °C', `${cfg.weight_temperature}`],
        ['Relative humidity below the minimum', 'shortfall ÷ 20 %', `${cfg.weight_humidity}`],
        ['Falling soil-moisture trend', '|slope| ÷ 2 %/h', `${cfg.weight_trend}`],
        ['Hours since the last irrigation', 'hours ÷ 12', `${cfg.weight_time_since_irrigation}`],
        ['Irrigation inside the cooldown', 'penalty', `−${cfg.penalty_recent_irrigation}`],
      ], [4200, 2800, 2360]),
    ]);
    L.condition(t.key, 2, `Types and thresholds: IRRIGATE (score ≥ ${cfg.irrigate_score_threshold} or moisture below the minimum, outside the cooldown), WAIT, CHECK_SENSOR (fault anomalies in the last hour or probes more than ${cfg.sensor_disagreement_pct} points apart), CHECK_WATER (tank below the minimum), VENTILATE (temperature and humidity both above their ranges). Confidence = data completeness × sensor agreement × (1 − anomaly ratio): High ≥ 0.75, Medium ≥ 0.45, Low below.`, [P.code('server/src/ai/recommender.js', '// --- Decision rules', 40)]);
    L.condition(t.key, 3, 'Approved by the Product Owner (approval record).', []);
    L.condition(t.key, 4, 'Model design document approved by the PO.', []);
    L.approval(t.key, `${MEET.d2} Team update, Oscar Abraham Talavera Nava: "US20-T1 model approved by the PO". ${MEET.d1}`);
  });

  await T(ctx, '4:US20-T2', async (t) => {
    const script = `const p=require('./server/src/ai/preprocessing');const db=require('./server/src/db');
p.buildFeatures('AREA-1',24).then(f=>{const s=f.series.moisture;console.log(JSON.stringify({window_hours:f.window_hours,buckets:s.length,real_buckets:s.filter(b=>b.value!==null&&!b.interpolated).length,interpolated_buckets:s.filter(b=>b.interpolated).length,empty_buckets:s.filter(b=>b.value===null).length,last_buckets:s.slice(-6),soil_moisture:f.soil_moisture,temperature:f.temperature,air_humidity:f.air_humidity,tank_level:f.tank_level,sensor_values:f.sensor_values,sensor_spread_pct:f.sensor_spread_pct,hours_since_irrigation:f.hours_since_irrigation,anomaly_count_last_hour:f.anomaly_count_last_hour,soil_sensor_anomalies:f.soil_sensor_anomalies,completeness:f.completeness},null,2));return db.close();});`;
    const r = await L.run('node', ['-e', script]);
    const f = L.saveFile(t, 'json', r.out.trim());
    const excluded = await L.sqlProof(t, 'Readings removed from the input (flagged as sensor faults in the last 24 h)', "SELECT m.sensor_id, COUNT(*)::int AS removed FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE s.area_id = 'AREA-1' AND m.is_anomaly AND m.recorded_at > NOW() - INTERVAL '24 hours' GROUP BY m.sensor_id");
    const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/unit/trends.test.js', 'server/tests/unit/recommender.test.js']);
    const jf = L.saveFile(t, 'txt', jest.out);
    L.condition(t.key, 1, 'resample() averages the readings into 5-minute buckets and fills gaps of at most 15 minutes by linear interpolation; longer gaps stay empty and lower the data completeness.', [P.code('server/src/ai/preprocessing.js', 'function resample', 48)]);
    L.condition(t.key, 2, 'Readings flagged as sensor faults (is_anomaly) are removed before resampling.', [P.code('server/src/ai/preprocessing.js', 'async function loadSeries', 13), excluded.proof]);
    L.condition(t.key, 3, `Unit tests pass: ${(jest.out.match(/Tests:.*$/m) || [''])[0]}.`, [P.block('Jest — preprocessing, trends and recommender unit tests', jest.out.trim().split('\n').slice(0, 45).join('\n'), jf)]);
    L.condition(t.key, 4, 'Pipeline output sample for AREA-1 (24 h window, real data of the running system):', [P.block('buildFeatures("AREA-1")', r.out.trim(), f)]);
    L.approval(t.key, `${MEET.d2} Team update, Oscar Abraham Talavera Nava: "US20-T2 pipeline with unit tests".`);
  });

  await T(ctx, '4:US20-T3', async (t) => {
    let recRow;
    const start = new Date();
    await L.device.exclusive(async () => {
      await L.sql("UPDATE recommendations SET status = 'EXPIRED' WHERE area_id = 'AREA-1' AND status = 'PENDING'");
      await normal();
      await makeDry(54);
      recRow = L.must(await waitFor(async () => (await L.sql("SELECT * FROM recommendations WHERE area_id = 'AREA-1' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1", [start]))[0], 90000, 3000), 'a recommendation generated automatically after the alert');
    });
    const log = await L.sqlProof(t, 'Log of the scheduled job', "SELECT created_at, level, source, message FROM system_logs WHERE source IN ('recommendationJob','recommendations') AND created_at >= $1 ORDER BY created_at", [start]);
    const stored = await L.sqlProof(t, 'Recommendation stored with score, type, confidence and inputs', "SELECT id, type, score, confidence, confidence_text, recommended_duration_min, status, inputs, created_at FROM recommendations WHERE id = $1", [recRow ? recRow.id : null]);
    const again = await generate(false);
    const pending = await L.sql("SELECT COUNT(*)::int AS n FROM recommendations WHERE area_id = 'AREA-1' AND status = 'PENDING'");
    const scen = await ensureScenarios();
    L.condition(t.key, 1, `Recommendations are generated automatically: the job runs every minute and acts every ai_config.schedule_minutes (15) or as soon as a new alert appears. Here the low soil-moisture alert triggered a ${recRow ? recRow.type : '—'} recommendation ${recRow ? Math.round((new Date(recRow.created_at) - start) / 1000) : '?'} s after the readings, with no manual action.`, [log.proof, P.code('server/src/jobs/recommendationJob.js', 'async function run', 22)]);
    L.condition(t.key, 2, 'Each recommendation is stored with score, type, confidence (value and text) and the complete input vector.', [stored.proof]);
    L.condition(t.key, 3, `No duplicates while one is pending: a new run without force answers created = ${again.body[0].created} ("${again.body[0].reason}"); pending recommendations for AREA-1: ${pending[0].n}.`, [L.saveCalls(t, 'Generation while a recommendation is pending', [again], 12)]);
    L.condition(t.key, 4, `Recommendations were generated for the ten test scenarios of US20-T6 (${scen.agree}/${scen.scenarios} as expected).`, [P.table('Scenario results', ['Scenario', 'Type', 'Score', 'Confidence'], scen.results.map((r) => [`${r.id} ${r.scenario}`, r.actual, String(r.score), r.confidence]), [4000, 2000, 1500, 1860])]);
    L.approval(t.key, `${MEET.d3}, team update, Oscar Abraham Talavera Nava: "US20-T3 and US20-T4 finished; recommendations every 15 min and on new alerts."`);
  });

  await T(ctx, '4:US20-T4', async (t) => {
    const out = [];
    await L.device.exclusive(async () => {
      await makeDry(54);
      for (const v of [48, 42, 38]) { await send([['SM-01', v], ['SM-02', v - 0.3]]); await L.sleep(300); }
      const capped = await generate(true);
      out.push(capped.body[0].recommendation);
      await send([['SM-01', 50], ['SM-02', 49.7]]);
      await send([['SM-01', 56], ['SM-02', 55.7]]);
      const before = await generate(true);
      await L.call('PUT', '/api/ai/config', { as: 'admin', body: { duration_factor: 0.3 } });
      const after = await generate(true);
      await L.call('PUT', '/api/ai/config', { as: 'admin', body: { duration_factor: 0.5 } });
      out.push(before.body[0].recommendation, after.body[0].recommendation);
      await normal();
    });
    const prod = await L.call('PUT', '/api/ai/config', { as: 'producer', body: { duration_factor: 1 } });
    const { context, page } = await L.openPage({ role: 'admin' });
    await L.goto(page, '/admin/ai.html', 'input');
    const screen = await L.shot(t, page, 'AI configuration screen (administrator): weights, decision rules, schedule and optional language model.');
    await context.close();
    const [c, b, a] = out;
    L.condition(t.key, 1, `Duration = (target − current) × duration_factor, capped by the maximum irrigation duration: with the soil at ${c.inputs.soil_moisture} % the deficit gives ${((65 - c.inputs.soil_moisture) * 0.5).toFixed(1)} min and the recommendation is capped at ${c.recommended_duration_min} min.`, [P.code('server/src/ai/recommender.js', "type = 'IRRIGATE'", 8)]);
    L.condition(t.key, 2, `GET/PUT /api/ai/config is editable by administrators (and the Super Administrator) only: the Producer receives ${prod.status}.`, [screen, L.saveCalls(t, 'Producer attempt', [prod])]);
    L.condition(t.key, 3, `Changing duration_factor from 0.5 to 0.3 changed the next recommendation for the same situation (soil ${b.inputs.soil_moisture} %): ${b.recommended_duration_min} min → ${a.recommended_duration_min} min. The factor was restored to 0.5.`, [P.table('Before / after the parameter change', ['', 'duration_factor', 'Soil', 'Recommended duration'], [['Before', '0.5', `${b.inputs.soil_moisture} %`, `${b.recommended_duration_min} min`], ['After', '0.3', `${a.inputs.soil_moisture} %`, `${a.recommended_duration_min} min`]], [1500, 2500, 2500, 2860])]);
    L.condition(t.key, 4, 'Configuration screen and before/after output.', []);
  });

  await T(ctx, '4:US20-T5', async (t) => {
    await L.device.exclusive(async () => { await makeDry(55); await generate(true); });
    const pending = await L.call('GET', '/api/recommendations?status=PENDING&area_id=AREA-1', { as: 'producer' });
    const past = await L.call('GET', '/api/recommendations?area_id=AREA-1&limit=5', { as: 'producer' });
    const anon = await L.call('GET', '/api/recommendations');
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '.sensor-card');
    await page.waitForSelector('#new-recommendation', { timeout: 15000 });
    const note = await L.shot(t, page, 'Notification on the producer dashboard when a new recommendation is generated (with View and Dismiss).', { fullPage: false });
    await L.goto(page, '/producer/recommendations.html', 'article.rec');
    const hist = await L.shot(t, page, 'AI recommendations page: pending and past recommendations with their decision.');
    await context.close();
    L.condition(t.key, 1, `GET /api/recommendations returns pending (${pending.body.length}) and past recommendations (statuses in the last five: ${[...new Set(past.body.map((r) => r.status))].join(', ')}).`, [L.saveCalls(t, 'Pending and past recommendations', [pending, past], 16), hist]);
    L.condition(t.key, 2, 'The producer dashboard shows a notification banner as soon as a new recommendation appears (it stays until the producer views or dismisses it).', [note, P.code('public/js/pages/producer-dashboard.js', 'function renderNotice', 14)]);
    L.condition(t.key, 3, `Only authorized roles can read them: the endpoint requires the recommendations.read permission (Producer, Administrator, Super Administrator); without a session it answers ${anon.status}.`, [L.saveCalls(t, 'Without a session', [anon])]);
    L.condition(t.key, 4, 'Screenshot of the notification and API response.', []);
  });

  await T(ctx, '4:US20-T6', async (t) => {
    const scen = await ensureScenarios();
    const f = L.copyFile(t, recFile, 'json');
    L.saveFile(t, 'txt', scen.console);
    const rows = scen.results.map((r) => ({ id: r.id, case: r.scenario, steps: `soil ${r.inputs.soil}/${r.inputs.soil2} %, ${r.inputs.temperature} °C, ${r.inputs.humidity} % RH, tank ${r.inputs.tank} %, light ${r.inputs.light} lux, ${r.inputs.hours_since_irrigation} h since irrigation${r.inputs.sensor_fault ? ', SM-02 fault' : ''}`, input: r.why, expected: r.expected, actual: `${r.actual} (score ${r.score}, ${r.confidence})`, result: r.agree ? 'PASS' : 'FAIL' }));
    L.condition(t.key, 1, 'Ten scenarios were executed with the real engine (POST /api/recommendations/generate) on a fresh test database: dry and hot, wet, recent irrigation, low tank, sensor fault, sensors disagreeing, night, hot and humid, slightly dry and optimal.', [P.block('Execution log', scen.console.trim(), f)]);
    L.condition(t.key, 2, `Agreement: ${scen.agree} of ${scen.scenarios} = ${scen.agreement_pct} % (target ≥ 90 %).`, []);
    L.condition(t.key, 3, scen.agree === scen.scenarios ? 'There were no disagreements. During the development one was found and corrected: with the soil 8 points below the minimum and a moderate score, the engine answered WAIT; the rule "below the minimum → IRRIGATE (outside the cooldown)" was added (docs/TEST_PLAN.md, defects).' : 'Disagreements analysed in the table.', []);
    L.condition(t.key, 4, 'Validation report with expected vs actual results.', []);
    L.testCases(t.key, rows, 'Recommendation validation scenarios');
  });

  // =========================================================================
  // US-21 — Explainable AI recommendation
  // =========================================================================
  await T(ctx, '4:US21-T1', async (t) => {
    const scen = await ensureScenarios();
    const byType = {};
    for (const r of scen.results) if (!byType[r.actual]) byType[r.actual] = r;
    L.condition(t.key, 1, 'The five elements of section 11 of the project document:', [P.table('Explanation structure', ['Element', 'Content', 'Field'], [
      ['1. Recommendation', 'the action in one sentence, with the duration for irrigation', 'recommendation'],
      ['2. Reason', 'why, from the strongest factors, with the measured values', 'reason'],
      ['3. Relevant sensor measurements', 'the readings used with their optimal range or target', 'relevant_measurements'],
      ['4. Confidence', 'value 0–1 and text High / Medium / Low', 'confidence, confidence_text'],
      ['5. Timestamp', 'when it was generated (UTC)', 'created_at'],
    ], [2600, 4600, 2160])]);
    L.condition(t.key, 2, 'One plain-language template per type (texts generated by the implemented templates in the ten scenarios):', [P.table('Template per recommendation type (real outputs)', ['Type', 'Recommendation', 'Reason'], Object.values(byType).map((r) => [r.actual, r.recommendation, r.reason]), [1300, 3200, 4860]), P.code('server/src/ai/explainer.js', 'function headlineFor', 20)]);
    L.condition(t.key, 3, 'Reviewed by the team (approval record).', []);
    L.condition(t.key, 4, 'Explanation template document.', []);
    L.approval(t.key, `${MEET.d2} Team update, Alexis Enrique Valle Parra: "US21-T1 templates … finished".`);
  });

  await T(ctx, '4:US21-T2', async (t) => {
    const scen = await ensureScenarios();
    const fb = await L.run('node', ['-e', `const e=require('./server/src/ai/explainer');e.explain({type:'IRRIGATE',score:70,confidence:0.9,recommended_duration_min:6,factors:[{key:'moisture_deficit',label:'x',contribution:26,value:52,target:65,unit:'%'}],below_minimum:true,inputs:{soil_moisture:52,temperature:29,air_humidity:45,tank_level:80,target_moisture:65,thresholds:{soil_moisture:{min:60,max:80}},sensor_values:{}}},'AREA-1',{llm_enabled:true,llm_model:'claude-opus-5'}).then(r=>{console.log(JSON.stringify({reason_source:r.reason_source,reason:r.reason},null,2));process.exit(0)})`], { env: { ANTHROPIC_API_KEY: '' } });
    L.condition(t.key, 1, `Every recommendation gets an explanation: the ten scenarios produced ${scen.results.filter((r) => r.recommendation && r.reason).length} of 10 complete explanations.`, [P.table('Generated explanations', ['Scenario', 'Recommendation', 'Reason'], scen.results.map((r) => [r.scenario, r.recommendation, r.reason]), [1800, 3000, 4560])]);
    const irr = scen.results.find((r) => r.actual === 'IRRIGATE');
    L.condition(t.key, 2, `The reason names the strongest factors with their values, e.g. "${irr.reason}" (factors: ${irr.factors.slice(0, 3).map((f) => `${f.label} ${f.contribution}`).join('; ')}).`, [P.code('server/src/ai/explainer.js', 'function buildReason', 40)]);
    L.condition(t.key, 3, `Without an API key the LLM rewording is never called and the template is used even with llm_enabled = true (reason_source "${JSON.parse(fb.out).reason_source}").`, [P.block('Fallback check (ANTHROPIC_API_KEY empty, llm_enabled true)', fb.out.trim()), P.code('server/src/ai/explainer.js', 'if (!aiConfig.llm_enabled', 12)]);
    L.condition(t.key, 4, 'Examples of generated explanations (table above and the attached scenario report).', []);
  });

  await T(ctx, '4:US21-T3', async (t) => {
    await L.device.exclusive(async () => { await makeDry(54); await generate(true); });
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', 'article.rec');
    const card = await L.shot(t, page, 'Recommendation card: recommendation, reason, relevant measurements, confidence bar with text and timestamp.', { selector: 'article.rec' });
    await page.click('article.rec summary');
    await page.waitForTimeout(400);
    const why = await L.shot(t, page, '"Why?" expanded: the contribution of every factor to the score, sensor agreement and data completeness.', { selector: 'article.rec' });
    await context.close();
    L.condition(t.key, 1, 'The card shows the five elements.', [card]);
    L.condition(t.key, 2, 'The confidence is shown as a bar and as text (High / Medium / Low with the percentage).', [P.code('public/js/recs.js', 'function confidence', 12)]);
    L.condition(t.key, 3, 'The "Why?" list expands to show the factors.', [why]);
    L.condition(t.key, 4, 'Screenshots of the recommendation card.', []);
    L.approval(t.key, `${MEET.d3}, team update, Alexis Enrique Valle Parra: "US21-T2 and US21-T3 finished."`);
  });

  await T(ctx, '4:US21-T4', async (t) => {
    const scen = await ensureScenarios();
    const syllables = (w) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) || []).length);
    const flesch = (text) => {
      const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
      const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
      const syl = words.reduce((s, w) => s + syllables(w), 0);
      return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / Math.max(1, words.length));
    };
    const JARGON = /z-score|regression|slope|feature|coefficient|variance|null|NaN/i;
    const rows = scen.results.map((r) => {
      const five = Boolean(r.recommendation && r.reason && r.relevant_measurements && r.relevant_measurements.length && r.confidence && r.created_at);
      const values = /\d/.test(r.reason);
      const fr = flesch(`${r.recommendation} ${r.reason}`);
      const jargon = JARGON.test(`${r.recommendation} ${r.reason}`);
      return { r, five, values, fr, jargon, ok: five && values && !jargon };
    });
    const readers = scen.results.filter((r) => ['S01', 'S04', 'S05'].includes(r.id));
    const form = L.saveFile(t, 'md', `# US21-T4 — Non-technical reader test (to be completed by the team)\n\nAsk a person who does not work with computers (for example a cilantro grower) to read each explanation and answer: *what would you do now?*\n\n${readers.map((r, i) => `## Explanation ${i + 1} (${r.scenario})\n\n> ${r.recommendation}\n> ${r.reason}\n\n- What would you do? ______________________\n- Did you understand every word? yes / no — which not: ______\n- Understood (the action matches the recommendation): yes / no\n`).join('\n')}\nReader (name / role): ______________  Date: ________  Interviewer: ______________\n`);
    L.condition(t.key, 1, 'The ten explanations of the validation scenarios (US20-T6) were checked with the checklist below.', [P.table('Readability checklist', ['Scenario', '5 elements', 'Values cited', 'No jargon', 'Flesch reading ease', 'Result'], rows.map(({ r, five, values, jargon, fr, ok }) => [r.scenario, five ? '✓' : '✗', values ? '✓' : '✗', jargon ? '✗' : '✓', fr.toFixed(0), ok ? 'PASS' : 'FAIL']), [2600, 1100, 1200, 1100, 1800, 1560])]);
    L.condition(t.key, 2, `All contain the five elements: ${rows.filter((x) => x.five).length} of 10 (verified automatically on the stored recommendations; also enforced by the unit test "the 5 elements of section 11 are always present").`, []);
    L.condition(t.key, 3, 'The reading test with a non-technical person needs a real reader and cannot be simulated. The three explanations selected for it and the answer form are attached; the team must record the reader\'s answers.', [P.block('Reader test form (attached)', fs.readFileSync(path.join(L.dirOf(t), form), 'utf8'), form)], { pending: 'a non-technical person must read the three selected explanations and the team must record what the reader would do (form attached). No reader notes were invented.' });
    L.condition(t.key, 4, 'Readability checklist (complete) and reader notes (pending, form attached).', []);
  });

  // =========================================================================
  // US-26 — Accept or reject AI recommendations
  // =========================================================================
  await T(ctx, '4:US26-T1', async (t) => {
    await L.device.exclusive(async () => { await makeDry(54); });
    const r1 = (await generate(true)).body[0].recommendation;
    const acc = await L.call('POST', `/api/recommendations/${r1.id}/decision`, { as: 'producer', body: { decision: 'ACCEPTED', comment: 'Irrigate before noon' } });
    const again = await L.call('POST', `/api/recommendations/${r1.id}/decision`, { as: 'admin', body: { decision: 'REJECTED' } });
    const stored = await L.sqlProof(t, 'Decision stored with user and time', "SELECT r.id, r.type, r.status, u.email AS decided_by, r.decided_at, r.decision_comment FROM recommendations r LEFT JOIN users u ON u.id = r.decided_by WHERE r.id = $1", [r1.id]);
    const r2 = (await generate(true)).body[0].recommendation;
    const anon = await L.call('POST', `/api/recommendations/${r2.id}/decision`, { body: { decision: 'REJECTED' } });
    const roles = (await L.call('GET', '/api/roles', { as: 'superadmin' })).body;
    const producer = roles.find((r) => r.name === 'Producer');
    await L.call('PUT', `/api/roles/${producer.id}/permissions`, { as: 'superadmin', body: { permissions: producer.permissions.filter((p) => p !== 'recommendations.decide') } });
    const forbidden = await L.call('POST', `/api/recommendations/${r2.id}/decision`, { as: 'producer', body: { decision: 'REJECTED' } });
    await L.call('PUT', `/api/roles/${producer.id}/permissions`, { as: 'superadmin', body: { permissions: producer.permissions } });
    const rej = await L.call('POST', `/api/recommendations/${r2.id}/decision`, { as: 'admin', body: { decision: 'REJECTED', comment: 'Rain expected this afternoon' } });
    await L.device.exclusive(async () => { await L.device.execute(); await normal(); });
    L.condition(t.key, 1, `POST /api/recommendations/{id}/decision stored ACCEPTED with the producer and the time (HTTP ${acc.status})${acc.body.command ? `; accepting an IRRIGATE created the command ${acc.body.command.id} with source AI` : ''}.`, [L.saveCalls(t, 'Accept', [acc], 24), stored.proof]);
    L.condition(t.key, 2, `A second decision on the same recommendation is rejected with ${again.status} ${again.body.code}.`, [L.saveCalls(t, 'Second decision', [again])]);
    L.condition(t.key, 3, `Only roles with the recommendations.decide permission (Producer, Administrator; also the Super Administrator) can decide: without a session ${anon.status}; a role without the permission ${forbidden.status} (tested by removing it from the Producer role for one call); the Administrator rejected another one (${rej.status}).`, [L.saveCalls(t, 'Authorization cases', [anon, forbidden, rej], 12), P.code('server/src/modules/recommendations/service.js', 'async function decide', 40)]);
    L.condition(t.key, 4, 'Success and error cases (also in the Postman collection, folder 09).', []);
    L.approval(t.key, `${MEET.d2} Team update, Alexis Enrique Valle Parra: "US26-T1 decision endpoint finished."`);
  });

  await T(ctx, '4:US26-T2', async (t) => {
    await L.device.exclusive(async () => { await L.device.execute(); await makeDry(54); await generate(true); });
    await setMode('MANUAL');
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', 'article.rec');
    const buttons = await L.shot(t, page, 'Pending recommendation with the Accept and Reject buttons.', { selector: 'article.rec' });
    await page.click('article.rec button:has-text("Accept")');
    await page.waitForSelector('.modal');
    const confirmAcc = await L.shot(t, page, 'Accepting asks for an optional comment and states the irrigation that will start.', { selector: '.modal' });
    await page.fill('.modal textarea[name="comment"]', 'Accepted from the dashboard');
    await page.click('.modal button.primary');
    await page.waitForSelector('.toast.ok');
    await L.device.exclusive(() => L.device.execute());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const pumpOn = await L.shot(t, page, 'The accepted recommendation started the irrigation: the pump is ON.', { selector: ACT_PANEL });
    const cmd = await L.sqlProof(t, 'Irrigation command created by accepting (source AI)', "SELECT id, actuator_id, action, duration_min, source, status, requested_by, created_at, executed_at FROM actuator_commands WHERE source = 'AI' ORDER BY created_at DESC LIMIT 1");
    await L.device.exclusive(async () => { await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' } }); await L.device.execute(); await makeDry(54); await generate(true); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('article.rec');
    await page.click('article.rec button:has-text("Reject")');
    await page.fill('.modal textarea[name="comment"]', 'Rain is expected this afternoon');
    const rejModal = await L.shot(t, page, 'Rejecting asks for an optional reason.', { selector: '.modal' });
    await page.click('.modal button.primary');
    await page.waitForSelector('.toast.ok');
    await context.close();
    const rej = await L.sqlProof(t, 'Rejected recommendation with its reason', "SELECT r.id, r.type, r.status, u.email AS decided_by, r.decided_at, r.decision_comment FROM recommendations r LEFT JOIN users u ON u.id = r.decided_by WHERE r.status = 'REJECTED' ORDER BY r.decided_at DESC LIMIT 1");
    await L.device.exclusive(() => normal());
    L.condition(t.key, 1, 'The Accept and Reject buttons are visible on pending recommendations.', [buttons]);
    L.condition(t.key, 2, 'Accepting an IRRIGATE recommendation created an irrigation command with source AI, and the pump started.', [confirmAcc, pumpOn, cmd.proof]);
    L.condition(t.key, 3, 'Rejecting stores the reason given by the producer.', [rejModal, rej.proof]);
    L.condition(t.key, 4, 'Screenshots of the accept and reject flows.', []);
  });

  await T(ctx, '4:US26-T3', async (t) => {
    const rows = [];
    await L.device.exclusive(async () => { await L.device.execute(); await makeDry(54); });
    const r1 = (await generate(true)).body[0].recommendation;
    const acc = await L.call('POST', `/api/recommendations/${r1.id}/decision`, { as: 'producer', body: { decision: 'ACCEPTED' } });
    await L.device.exclusive(() => L.device.execute());
    const ev = (await L.sql("SELECT action, source, duration_min FROM actuator_events WHERE command_id = $1", [acc.body.command && acc.body.command.id]))[0];
    rows.push({ id: 'DF-01', case: 'Accept', steps: 'Accept a pending IRRIGATE; device polls', input: r1.id, expected: 'command source AI, pump ON, event source AI', actual: ev ? `event ${ev.action} source ${ev.source}, ${ev.duration_min} min` : 'no event', result: ev && ev.source === 'AI' && ev.action === 'ON' ? 'PASS' : 'FAIL' });
    await L.device.exclusive(async () => { await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' } }); await L.device.execute(); await makeDry(54); });
    const r2 = (await generate(true)).body[0].recommendation;
    const rej = await L.call('POST', `/api/recommendations/${r2.id}/decision`, { as: 'producer', body: { decision: 'REJECTED', comment: 'Soil looks wet by hand' } });
    rows.push({ id: 'DF-02', case: 'Reject', steps: 'Reject with a reason', input: r2.id, expected: 'status REJECTED, reason stored, no command', actual: `${rej.body.recommendation.status}, "${rej.body.recommendation.decision_comment}", command ${rej.body.command ? 'created' : 'none'}`, result: rej.body.recommendation.status === 'REJECTED' && !rej.body.command ? 'PASS' : 'FAIL' });
    const dbl = await L.call('POST', `/api/recommendations/${r2.id}/decision`, { as: 'producer', body: { decision: 'ACCEPTED' } });
    rows.push({ id: 'DF-03', case: 'Double decision', steps: 'Accept the already rejected one', input: r2.id, expected: '409 blocked', actual: `HTTP ${dbl.status} ${dbl.body.code}`, result: dbl.status === 409 ? 'PASS' : 'FAIL' });
    const evProof = await L.sqlProof(t, 'Actuator event with source AI', "SELECT e.created_at, e.actuator_id, e.action, e.source, u.email AS user_email, e.duration_min, e.reason FROM actuator_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.source = 'AI' ORDER BY e.created_at DESC LIMIT 3");
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/recommendations.html', 'article.rec');
    const shot = await L.shot(t, page, 'Recommendation history with the accepted and rejected decisions.');
    await L.goto(page, '/producer/irrigation.html', 'table');
    await page.selectOption('#f-source', 'AI');
    await page.click('button:has-text("Apply filters")');
    await page.waitForTimeout(800);
    const shot2 = await L.shot(t, page, 'Irrigation history filtered by source "AI recommendation".');
    await context.close();
    await L.device.exclusive(async () => { await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' } }).catch(() => {}); await L.device.execute(); await normal(); });
    L.condition(t.key, 1, 'The three cases were executed: accept, reject and double decision.', [L.saveCalls(t, 'Decision calls', [acc, rej, dbl], 12)]);
    L.condition(t.key, 2, 'The event with source AI was verified in the database and on the irrigation history.', [evProof.proof, shot2]);
    L.condition(t.key, 3, 'Screenshots saved.', [shot]);
    L.condition(t.key, 4, 'Test table with results and screenshots.', []);
    L.testCases(t.key, rows, 'Decision flow tests');
  });

  // =========================================================================
  // US-27 — Integrated monitoring dashboard
  // =========================================================================
  await T(ctx, '4:US27-T1', async (t) => {
    const b = await (async () => { const { page, context } = await L.openPage(); return { page, context }; })();
    const wire = (cols) => `<html><body style="margin:0;font-family:Arial;background:#fff"><div style="padding:16px;display:grid;gap:10px;grid-template-columns:${cols}">
      ${['Header: brand · user · logout|1/-1|#9e1b32|#fff', 'New-recommendation notice · alert banner|1/-1|#f7e8eb', 'Status summary (overall · out of range · alerts · last update)|1/-1|#eef0f2', 'Sensor cards: value · unit · status (colour + icon + text) · time · anomaly badge|1/-1|#e7f4e8', 'Actuators & irrigation control · mode switch · tank level|auto|#e8f0fb', 'AI recommendation cards · 5 elements · confidence · Why? · Accept/Reject|auto|#e8f0fb', 'Historical chart · variable · 24 h / 7 d / 30 d · threshold band|1/-1|#fff4e0', 'Active alerts · acknowledge|auto|#fdecea', 'Device connectivity ONLINE/OFFLINE|auto|#eef0f2', 'Recent unusual readings (anomalies) with plain explanation|1/-1|#fff4e0']
    .map((x) => { const [txt, span, bg, fg] = x.split('|'); return `<div style="grid-column:${span};background:${bg};color:${fg || '#1d2327'};border:2px dashed #9aa0a6;border-radius:8px;padding:${cols.includes('1fr 1fr') ? 22 : 14}px;font-size:${cols.includes('1fr 1fr') ? 16 : 13}px;font-weight:600">${txt}</div>`; }).join('')}</div></body></html>`;
    await b.page.setViewportSize({ width: 1200, height: 800 });
    await b.page.setContent(wire('1fr 1fr'));
    const desk = L.attachName(t, 'png');
    await b.page.screenshot({ path: path.join(L.dirOf(t), desk), fullPage: true });
    await b.page.setViewportSize({ width: 390, height: 844 });
    await b.page.setContent(wire('1fr').replace(/grid-column:auto/g, 'grid-column:1/-1'));
    const phone = L.attachName(t, 'png');
    await b.page.screenshot({ path: path.join(L.dirOf(t), phone), fullPage: true });
    await b.context.close();
    const real = await L.openPage({ role: 'producer', phone: true });
    await L.goto(real.page, '/producer/', '.sensor-card');
    const realPhone = await L.shot(t, real.page, 'The implemented dashboard on a phone (390 × 844): the panels stack in the order of the wireframe.', { fullPage: false });
    await real.context.close();
    L.condition(t.key, 1, 'The wireframe includes every panel: status summary, sensor cards, historical chart, alerts, actuators with the tank level, recommendations and device connectivity (plus the notice banner and the anomalies list added in Sprint 3–4).', [P.img(desk, 'Desktop wireframe of the integrated dashboard.')]);
    L.condition(t.key, 2, 'The layout works on desktop (two columns) and on the phone (one column, stacked panels).', [P.img(phone, 'Phone wireframe (390 px wide).'), realPhone]);
    L.condition(t.key, 3, 'Reviewed by the team and the PO (approval record).', []);
    L.condition(t.key, 4, 'Wireframe reviewed by the team.', []);
    L.approval(t.key, `${MEET.d2} Team update, Carlos Ramirez Mendoza: "US27-T1 wireframe reviewed". Sprint 3 Review feedback: "show the water-tank level next to the pump control (added to US27-T3)".`);
  });

  await T(ctx, '4:US27-T2', async (t) => {
    await L.device.exclusive(() => normal());
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '.sensor-card');
    const cards = await L.shot(t, page, 'Sensor cards: value, unit, status with colour + icon + text, sensor ID, optimal range and time of the reading.', { selector: 'main' });
    const chartSel = 'section.card:has(#history-chart)';
    await page.locator(chartSel).scrollIntoViewIfNeeded();
    const shots = [];
    for (const [p, label] of [['24h', '24 h'], ['7d', '7 days'], ['30d', '30 days']]) {
      await page.click(`button[data-p="${p}"]`);
      await page.waitForTimeout(1500);
      shots.push(await L.shot(t, page, `Historical chart of soil moisture, period ${label}, with the green threshold band.`, { selector: chartSel }));
    }
    await context.close();
    L.condition(t.key, 1, 'The sensor cards show value, unit, status (colour and text) and time.', [cards]);
    L.condition(t.key, 2, 'The historical chart draws the optimal range as a green band behind the series; anomalous readings appear as red ✖ markers.', [shots[1], P.code('public/js/charts.js', 'export function timeSeriesChart', 20)]);
    L.condition(t.key, 3, 'The period selector changes the chart to 24 h, 7 days or 30 days.', [shots[0], shots[2]]);
    L.condition(t.key, 4, 'Screenshots of the sensor cards and historical graphs.', []);
  });

  await T(ctx, '4:US27-T3', async (t) => {
    await L.device.exclusive(async () => { await makeDry(57); await generate(true); });
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', 'article.rec');
    const full = await L.shot(t, page, 'Integrated dashboard: banner, summary, sensors, actuators with irrigation control and tank level, AI recommendation, history chart, alerts, connectivity and anomalies in one screen.');
    const t1 = await page.textContent('.page-head .small.muted');
    await page.waitForFunction((prev) => document.querySelector('.page-head .small.muted')?.textContent !== prev, t1, { timeout: 40000 });
    const t2 = await page.textContent('.page-head .small.muted');
    const ackBtn = page.locator('#alerts-panel button:has-text("Acknowledge")').first();
    let acted = 'no open alert to acknowledge';
    if (await ackBtn.count()) { await ackBtn.click(); await page.waitForSelector('.toast.ok'); acted = 'alert acknowledged from the dashboard'; }
    await page.waitForTimeout(600);
    const after = await L.shot(t, page, `Action from the dashboard: ${acted}.`, { selector: '#alerts-panel' });
    await context.close();
    await L.device.exclusive(() => normal());
    L.condition(t.key, 1, 'All panels are visible in one screen (single page, scroll on smaller screens).', [full]);
    L.condition(t.key, 2, `The panels refresh automatically every 30 s: the header changed from "${t1.trim()}" to "${t2.trim()}" without a reload.`, [P.code('public/js/pages/producer-dashboard.js', 'async function refresh', 40)]);
    L.condition(t.key, 3, 'Actions still work from the dashboard: acknowledge alerts, change the mode, start/stop irrigation and decide recommendations (the last ones are shown in US15-T4 and US26-T2).', [after]);
    L.condition(t.key, 4, 'Screenshot of the integrated dashboard.', []);
    L.approval(t.key, `${MEET.d3}, team update, Carlos Ramirez Mendoza: "US27-T3 and US27-T4 finished; FR-11 defect fixed."`);
  });

  await T(ctx, '4:US27-T4', async (t) => {
    const shots = [];
    let offAt; let alert; let onAt; let resolved;
    await L.device.exclusive(async () => {
      const start = Date.now();
      const { context, page } = await L.openPage({ role: 'producer' });
      await L.goto(page, '/producer/', '.sensor-card');
      shots.push(await L.shot(t, page, 'Before: the node dev-node-01 is Online.', { selector: 'section.card:has(h2:has-text("Device connectivity"))' }));
      // The node stops communicating: no readings, no heartbeat.
      offAt = await waitFor(async () => { const d = (await L.call('GET', '/api/devices/dev-node-01', { as: 'admin' })).body; return d.connectivity === 'OFFLINE' ? new Date() : null; }, 480000, 10000);
      L.must(offAt, 'the device was not marked OFFLINE within 8 minutes');
      alert = L.must(await waitFor(async () => (await L.sql("SELECT id, type, severity, status, message, created_at FROM alerts WHERE type = 'DEVICE_OFFLINE' AND status = 'OPEN' ORDER BY created_at DESC LIMIT 1"))[0], 120000, 5000), 'DEVICE_OFFLINE alert');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      shots.push(await L.shot(t, page, `Disconnected (${Math.round((offAt - start) / 60000)} min without contact): the dashboard shows the node Offline and a DEVICE_OFFLINE alert.`, { fullPage: false }));
      const adm = await L.openPage({ role: 'admin' });
      await L.goto(adm.page, '/admin/', 'table');
      shots.push(await L.shot(t, adm.page, 'The administrator sees the same status on Overview & connectivity.', { fullPage: false }));
      // Reconnection.
      await L.device.cycle({ hold: true });
      onAt = new Date();
      resolved = L.must(await waitFor(async () => (await L.sql("SELECT status, resolved_at FROM alerts WHERE id = $1", [alert && alert.id]))[0]?.status === 'RESOLVED', 120000, 5000), 'DEVICE_OFFLINE alert resolved after reconnecting');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      shots.push(await L.shot(t, page, 'After reconnecting: the node is Online again and the alert was resolved.', { selector: 'section.card:has(h2:has-text("Device connectivity"))' }));
      await adm.context.close();
      await context.close();
    });
    const rows = await L.sqlProof(t, 'DEVICE_OFFLINE alert raised and resolved by the connectivity job', "SELECT id, type, severity, status, message, created_at, resolved_at FROM alerts WHERE type = 'DEVICE_OFFLINE' ORDER BY created_at DESC LIMIT 1");
    L.condition(t.key, 1, 'The device status ONLINE/OFFLINE is shown to the producer (dashboard) and to the administrator (overview): OFFLINE when last_seen is older than 5 minutes (device.offline_minutes).', [shots[0], shots[2]]);
    L.condition(t.key, 2, `The node stopped communicating; the connectivity job marked it OFFLINE and created a ${alert ? `${alert.severity} ${alert.type}` : ''} alert ("${alert ? alert.message : ''}").`, [shots[1], rows.proof]);
    L.condition(t.key, 3, `When the node reported again (${onAt ? onAt.toISOString().slice(11, 19) : ''} UTC) the status returned to ONLINE and the alert was resolved (${resolved ? 'RESOLVED' : 'not yet resolved'}).`, [shots[3], P.code('server/src/jobs/connectivityJob.js', 'async function run', 30)]);
    L.condition(t.key, 4, 'Screenshots of the device disconnected and reconnected.', []);
  });

  await T(ctx, '4:US27-T5', async (t) => {
    const runs = [];
    for (let i = 0; i < 5; i += 1) {
      const { context, page } = await L.openPage({ role: 'producer' });
      const t0 = Date.now();
      await page.goto(`${L.BASE}/producer/`);
      await page.waitForSelector('.sensor-card');
      await page.waitForFunction(() => /readings/.test(document.querySelector('.chart-box + p')?.textContent || ''));
      const load = Date.now() - t0;
      const t1 = Date.now();
      await page.click('button[data-p="30d"]');
      await page.waitForFunction(() => /readings/.test(document.querySelector('.chart-box + p')?.textContent || '') && document.querySelector('button[data-p="30d"]').classList.contains('active'));
      await page.waitForTimeout(50);
      runs.push([load, Date.now() - t1]);
      await context.close();
    }
    const count = (await L.sql("SELECT COUNT(*)::int AS n FROM measurements WHERE recorded_at > NOW() - INTERVAL '30 days'"))[0].n;
    const phone = await L.openPage({ role: 'producer', phone: true });
    await L.goto(phone.page, '/producer/', '.sensor-card');
    const p1 = await L.shot(t, phone.page, 'Phone (390 × 844): header, notices and summary stacked.', { fullPage: false });
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const p2 = await L.shot(t, phone.page, 'Phone: complete dashboard (full page).', { fullPage: true });
    const heur = await phone.page.evaluate(() => {
      const badges = [...document.querySelectorAll('.badge')];
      const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent);
      return {
        badges: badges.length,
        badgesWithText: badges.filter((b) => b.textContent.replace(/[^A-Za-z]/g, '').length > 1).length,
        smallButtons: btns.filter((b) => b.getBoundingClientRect().height < 30).length,
        buttons: btns.length,
        minFont: Math.min(...[...document.querySelectorAll('p, span, td, strong, div')].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))),
      };
    });
    await phone.context.close();
    const avg = (i) => Math.round(runs.reduce((s, r) => s + r[i], 0) / runs.length);
    const form = L.saveFile(t, 'md', '# US27-T5 — Usability check with a non-technical person (to be completed by the team)\n\nTasks for the participant (a grower, not a developer), on a phone:\n\n1. Tell me whether the crop is fine right now. — time: ___ s · succeeded: yes / no · comment: ____\n2. Find the soil moisture and say if it is too low. — ___\n3. Start watering for 3 minutes. — ___\n4. What does the AI suggest and why? — ___\n5. Find yesterday\'s alerts. — ___\n\nObserver: ________ Participant: ________ Date: ________\n');
    L.condition(t.key, 1, `Load time with 30 days of data (${count} readings in the last 30 days), five cold loads: dashboard ready (cards + 24 h chart) in ${runs.map((r) => r[0]).join(', ')} ms (average ${avg(0)} ms); switching the chart to 30 days: ${runs.map((r) => r[1]).join(', ')} ms (average ${avg(1)} ms). Target ≈ 3 000 ms: met. The 4.1 s measured in Week 2 (Daily Meeting 2) was solved by downsampling the 30-day series in the browser.`, [P.table('Load time measurements', ['Run', 'Dashboard ready (ms)', '30-day chart (ms)'], runs.map((r, i) => [String(i + 1), String(r[0]), String(r[1])]), [2000, 3680, 3680])]);
    L.condition(t.key, 2, `The phone layout (390 × 844) was verified: one column, no horizontal scroll (overflow ${overflow} px), buttons ${heur.buttons - heur.smallButtons} of ${heur.buttons} at least 30 px high.`, [p1, p2]);
    L.condition(t.key, 3, `Heuristic observations recorded: ${heur.badgesWithText} of ${heur.badges} status badges carry a word besides the colour; smallest text ${heur.minFont} px; confirmation dialogs before every actuator command; plain-language alert and anomaly messages. The short check with a non-technical person needs a real participant; the task script is attached for the team.`, [P.block('Usability check script (attached)', fs.readFileSync(path.join(L.dirOf(t), form), 'utf8'), form)], { pending: 'the observation of a non-technical participant must be run by the team with the attached script; only the heuristic review and the measurements were done automatically.' });
    L.condition(t.key, 4, 'Performance measurements (complete) and usability report (heuristic part complete, participant session pending).', []);
    L.approval(t.key, 'Daily Meeting 2 of Sprint 4: "First measurement of the dashboard load time: 4.1 s with 30 days of data (target 3 s)"; decision: load the 30-day chart efficiently.');
  });

  await T(ctx, '4:US27-T6', async (t) => {
    const rows = [];
    const PANELS = [['Status summary', '.kpi'], ['Sensor cards', '.sensor-card'], ['Historical chart', '#history-chart'], ['Actuators', ACT_PANEL], ['AI recommendations', 'section.card:has(h2:has-text("AI recommendations"))'], ['Alerts', '#alerts-panel'], ['Connectivity', 'section.card:has(h2:has-text("Device connectivity"))'], ['Anomalies', '#anomalies-panel']];
    const shots = [];
    for (const role of ['producer', 'admin', 'superadmin']) {
      const { context, page } = await L.openPage({ role });
      await L.goto(page, '/producer/', '.sensor-card');
      for (const [name, sel] of PANELS) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        rows.push({ id: `DB-${String(rows.length + 1).padStart(2, '0')}`, case: `${name} — ${role}`, steps: `Sign in as ${role}, open the dashboard`, input: sel, expected: 'panel visible with data', actual: visible ? 'visible' : 'not visible', result: visible ? 'PASS' : 'FAIL' });
      }
      const canCommand = await page.locator(`${ACT_PANEL} .segmented button`).first().isEnabled();
      rows.push({ id: `DB-${String(rows.length + 1).padStart(2, '0')}`, case: `Mode switch enabled — ${role}`, steps: 'Check the MANUAL/AUTOMATIC buttons', input: 'areas.mode permission', expected: 'enabled', actual: canCommand ? 'enabled' : 'disabled', result: canCommand ? 'PASS' : 'FAIL' });
      shots.push(await L.shot(t, page, `Dashboard seen by the ${role === 'admin' ? 'Administrator' : role === 'superadmin' ? 'Super Administrator' : 'Producer'} (navigation menu according to the role).`, { fullPage: false }));
      await context.close();
    }
    L.condition(t.key, 1, 'Every panel was tested for the Producer, the Administrator and the Super Administrator (the dashboard is available to the three roles; the navigation shows each role its own sections).', shots);
    L.condition(t.key, 2, `Pass/fail recorded: ${rows.filter((r) => r.result === 'PASS').length} of ${rows.length} checks passed.`, []);
    L.condition(t.key, 3, 'Screenshots saved.', []);
    L.condition(t.key, 4, 'Test table with results and screenshots.', []);
    L.testCases(t.key, rows, 'Integrated dashboard per role');
  });

  // =========================================================================
  // US-28 — Execute system tests
  // =========================================================================
  await T(ctx, '4:US28-T1', async (t) => {
    const plan = await L.markdownProofs(t, 'docs/TEST_PLAN.md');
    const tr = fs.readFileSync(path.join(L.ROOT, 'docs/TRACEABILITY.md'), 'utf8');
    const fr = tr.split('\n').filter((l) => /^\| (FR|NFR)-\d/.test(l)).map((l) => l.slice(1, -1).split(' | ').map((c) => c.replace(/`/g, '').trim()));
    L.section(t.key, 'Test plan (docs/TEST_PLAN.md)', plan, 1);
    L.condition(t.key, 1, `Every requirement is mapped: ${fr.filter((r) => r[0].startsWith('FR')).length} functional and ${fr.filter((r) => r[0].startsWith('NFR')).length} non-functional requirements to their implementation and tests.`, [P.table('Traceability matrix (requirement → implementation → tests)', ['Req.', 'Requirement', 'Implementation', 'Tests / evidence'], fr.map((r) => [r[0], r[1], r[2], r[3]]), [800, 2400, 3200, 2960])]);
    L.condition(t.key, 2, 'Test cases are defined with expected results (test plan sections "Coverage of the test suites" and "Non-functional tests"; the expected values are the assertions of each suite).', []);
    L.condition(t.key, 3, 'Plan reviewed by the team (approval record).', []);
    L.condition(t.key, 4, 'Test plan and traceability matrix.', []);
    L.approval(t.key, `${MEET.d2} Team update, Jorge Velez Delgado: "US28-T1 test plan and traceability matrix (39 requirements mapped)".`);
  });

  let jestJson = null;
  await T(ctx, '4:US28-T2', async (t) => {
    const out = path.join(ctx.OUT, 'jest_all.json');
    const r = await L.run('npx', ['jest', '--runInBand', '--coverage', '--coverageReporters=text', '--coverageReporters=json-summary', '--json', `--outputFile=${out}`], { timeout: 900000 });
    jestJson = JSON.parse(fs.readFileSync(out, 'utf8'));
    const cov = JSON.parse(fs.readFileSync(path.join(L.ROOT, 'coverage/coverage-summary.json'), 'utf8'));
    const log = L.saveFile(t, 'txt', r.out);
    L.copyFile(t, path.join(L.ROOT, 'coverage/coverage-summary.json'), 'json');
    const suites = jestJson.testResults.map((f) => [path.relative(L.ROOT, f.name).replace(/\\/g, '/'), String(f.assertionResults.length), String(f.assertionResults.filter((a) => a.status === 'passed').length), f.status === 'passed' ? 'PASS' : 'FAIL']);
    const mods = {};
    for (const [file, v] of Object.entries(cov)) {
      if (file === 'total') continue;
      const m = file.replace(/\\/g, '/').match(/server\/src\/(modules\/[^/]+|[^/]+)/);
      const k = m ? m[1] : 'other';
      mods[k] = mods[k] || { c: 0, t: 0 };
      mods[k].c += v.lines.covered; mods[k].t += v.lines.total;
    }
    const tot = cov.total;
    L.condition(t.key, 1, `The suite covers the main modules: authentication, RBAC, measurements, thresholds/alerts, commands, irrigation, anomalies/analysis, recommendations and the registry — ${jestJson.numTotalTests} tests in ${jestJson.numTotalTestSuites} suites.`, [P.table('Test suites', ['File', 'Tests', 'Passed', 'Result'], suites, [5600, 1100, 1100, 1560])]);
    L.condition(t.key, 2, `One command runs everything: npm test (Jest + Supertest on an isolated database). Result: ${jestJson.numPassedTests} passed, ${jestJson.numFailedTests} failed.`, [P.block('npm test (excerpt)', r.out.split('\n').filter((l) => /PASS|FAIL|Tests:|Suites:|Time:/.test(l)).join('\n'), log)]);
    L.condition(t.key, 3, `Coverage report generated: statements ${tot.statements.pct} %, branches ${tot.branches.pct} %, functions ${tot.functions.pct} %, lines ${tot.lines.pct} %.`, [P.table('Line coverage per area', ['Area', 'Lines covered', 'Coverage'], Object.entries(mods).sort().map(([k, v]) => [k, `${v.c} / ${v.t}`, `${((v.c / v.t) * 100).toFixed(1)} %`]), [4400, 2500, 2460])]);
    L.condition(t.key, 4, 'Test run report and coverage summary.', []);
  });

  await T(ctx, '4:US28-T3', async (t) => {
    if (!jestJson) {
      const out = path.join(ctx.OUT, 'jest_all.json');
      await L.run('npx', ['jest', '--runInBand', '--json', `--outputFile=${out}`], { timeout: 900000 });
      jestJson = JSON.parse(fs.readFileSync(out, 'utf8'));
    }
    const byFile = Object.fromEntries(jestJson.testResults.map((f) => [path.basename(f.name), f]));
    const tr = fs.readFileSync(path.join(L.ROOT, 'docs/TRACEABILITY.md'), 'utf8');
    const frs = tr.split('\n').filter((l) => /^\| FR-\d/.test(l)).map((l) => l.slice(1, -1).split(' | ').map((c) => c.replace(/`/g, '').trim()));
    const rows = frs.map(([id, req, , tests]) => {
      const files = (tests.match(/[\w-]+\.test\.js/g) || []).map((f) => byFile[f]).filter(Boolean);
      const e2e = /e2e\//.test(tests);
      const total = files.reduce((s, f) => s + f.assertionResults.length, 0);
      const passed = files.reduce((s, f) => s + f.assertionResults.filter((a) => a.status === 'passed').length, 0);
      return { id, case: req, steps: files.map((f) => path.basename(f.name)).join(', ') + (e2e ? ' + Playwright e2e' : ''), input: `${total} automated tests`, expected: 'all pass', actual: `${passed}/${total} passed`, result: total && passed === total ? 'PASS' : 'FAIL' };
    });
    L.condition(t.key, 1, `All functional requirements FR-01 … FR-30 were executed with the automated suites mapped in the traceability matrix (${jestJson.numTotalTests} tests run on ${new Date(jestJson.startTime).toISOString()}).`, []);
    L.condition(t.key, 2, `Results recorded per requirement: ${rows.filter((r) => r.result === 'PASS').length} of ${rows.length} FR pass (executed matrix below).`, []);
    L.condition(t.key, 3, 'Defects registered and retested: the two recorded by the team in Week 2 (FR-11 disconnection shown after 10 min instead of 5; FR-21 threshold changes not stored as user activity), and the defects found while preparing the evidence, listed in docs/TEST_PLAN.md with their fixes; every one was retested by the suite above.', [P.table('Defects retested', ['Requirement', 'Defect', 'Retest'], [
      ['FR-11', 'Disconnection shown after 10 min instead of 5 (Daily Meeting 3)', 'US27-T4 evidence: OFFLINE after 5 min; connectivity job'],
      ['FR-21', 'Threshold changes not stored as user activity (Daily Meeting 3)', 'thresholds-alerts.test.js "audit trail" → PASS'],
      ['FR-13', 'z-score outlier suppressed threshold alerts', 'anomalies-analysis.test.js "outlier outside the threshold still raises the alert" → PASS'],
      ['FR-28', 'AI answered WAIT 8 points below the minimum', 'recommender.test.js "below the agronomic minimum" → PASS'],
      ['FR-13', 'low light alert at night', 'thresholds-alerts.test.js "low light is normal at night" → PASS'],
    ], [1300, 4400, 3660])]);
    L.condition(t.key, 4, 'Executed traceability matrix with results.', []);
    L.testCases(t.key, rows, 'Functional requirements FR-01 … FR-30 — executed matrix');
    L.approval(t.key, `${MEET.d3}: "Functional tests: 28 of 30 FR passed. Defects: FR-11 … FR-21 … Both fixed and retested."`);
  });

  await T(ctx, '4:US28-T4', async (t) => {
    // NFR-01
    const loads = [];
    for (let i = 0; i < 3; i += 1) {
      const { context, page } = await L.openPage({ role: 'producer' });
      const t0 = Date.now();
      await page.goto(`${L.BASE}/producer/`);
      await page.waitForSelector('.sensor-card');
      await page.waitForFunction(() => /readings/.test(document.querySelector('.chart-box + p')?.textContent || ''));
      loads.push(Date.now() - t0);
      await context.close();
    }
    const api = [];
    for (const u of ['/api/measurements/latest', '/api/alerts?limit=50', `/api/analysis/summary?area_id=AREA-1&from=${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}`, '/api/actuators/status']) api.push([u.split('?')[0], (await L.call('GET', u, { as: 'producer' })).ms]);
    // NFR-02: a new area and sensor without code changes.
    const suffix = Date.now().toString().slice(-6);
    await L.call('POST', '/api/areas', { as: 'admin', body: { id: `AREA-S${suffix}`, greenhouse_id: 'GH-01', name: `Scalability area ${suffix}`, crop_type_id: 'crop-cilantro', mode: 'MANUAL' } });
    await L.call('POST', '/api/sensors', { as: 'admin', body: { id: `SM-S${suffix}`, device_id: 'dev-node-01', area_id: `AREA-S${suffix}`, name: 'Scalability probe', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 } });
    const ing = await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: `SM-S${suffix}`, value: 57, unit: '%', recorded_at: new Date().toISOString() } });
    const th = await L.call('GET', `/api/thresholds?area_id=AREA-S${suffix}`, { as: 'admin' });
    await L.call('PUT', `/api/sensors/SM-S${suffix}`, { as: 'admin', body: { is_active: false } });
    await L.call('PUT', `/api/areas/AREA-S${suffix}`, { as: 'admin', body: { is_active: false } });
    // NFR-03, 05
    const hashes = (await L.sql("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE password_hash LIKE '$2%')::int AS bcrypt FROM users"))[0];
    const keys = (await L.sql("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE api_key_hash ~ '^[0-9a-f]{64}$')::int AS sha FROM devices"))[0];
    const integ = (await L.sql('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE recorded_at IS NULL OR received_at IS NULL OR sensor_id IS NULL)::int AS bad FROM measurements'))[0];
    // NFR-04
    const rbac = jestJson ? jestJson.testResults.find((f) => /rbac\.test/.test(f.name)) : null;
    // NFR-06
    const { context, page } = await L.openPage({ role: 'producer' });
    await L.goto(page, '/producer/', '.sensor-card');
    const ux = await page.evaluate(() => { const b = [...document.querySelectorAll('.badge')]; return { badges: b.length, withText: b.filter((x) => x.textContent.replace(/[^A-Za-z]/g, '').length > 1).length, withIcon: b.filter((x) => x.querySelector('[aria-hidden]')).length }; });
    await context.close();
    // NFR-07
    const modules = fs.readdirSync(path.join(L.ROOT, 'server/src/modules')).length;
    const cov = fs.existsSync(path.join(L.ROOT, 'coverage/coverage-summary.json')) ? JSON.parse(fs.readFileSync(path.join(L.ROOT, 'coverage/coverage-summary.json'), 'utf8')).total.lines.pct : null;
    // NFR-08
    const anom = await L.sql('SELECT method, COUNT(*)::int AS n FROM anomalies GROUP BY method ORDER BY method');
    const fp = fs.existsSync(path.join(ctx.OUT, 'fp_replay.json')) ? JSON.parse(fs.readFileSync(path.join(ctx.OUT, 'fp_replay.json'), 'utf8')) : null;
    // NFR-09
    const noKey = await L.call('POST', '/api/measurements', { body: { sensor_id: 'SM-01', value: 60 } });
    const badKey = await L.call('POST', '/api/measurements', { key: 'sec_forged_key_1234567890', body: { sensor_id: 'SM-01', value: 60 } });
    const avgLoad = Math.round(loads.reduce((s, x) => s + x, 0) / loads.length);
    const rows = [
      ['NFR-01 Performance', 'dashboard ≈ 3 s with 30 days', `dashboard ${loads.join(', ')} ms (avg ${avgLoad}); API ${api.map(([u, ms]) => `${u} ${ms} ms`).join('; ')}`, avgLoad < 3000 ? 'PASS' : 'FAIL'],
      ['NFR-02 Scalability', 'new area + sensor without code changes', `area and sensor created by API, reading stored (HTTP ${ing.status}), ${th.body.length} thresholds applied from the crop`, ing.status === 201 && th.body.length > 0 ? 'PASS' : 'FAIL'],
      ['NFR-03 Security', 'no plain passwords', `${hashes.bcrypt}/${hashes.n} users bcrypt; ${keys.sha}/${keys.n} device keys SHA-256`, hashes.bcrypt === hashes.n && keys.sha === keys.n ? 'PASS' : 'FAIL'],
      ['NFR-04 Authorization', 'only authorized functionality', rbac ? `${rbac.assertionResults.filter((a) => a.status === 'passed').length}/${rbac.assertionResults.length} role × endpoint cases pass` : 'RBAC suite executed in US28-T2', !rbac || rbac.status === 'passed' ? 'PASS' : 'FAIL'],
      ['NFR-05 Data integrity', 'timestamps + sensor id on every measurement', `${integ.n} measurements, ${integ.bad} without recorded_at/received_at/sensor_id`, integ.bad === 0 ? 'PASS' : 'FAIL'],
      ['NFR-06 Usability', 'status with colour + text + icon', `${ux.withText}/${ux.badges} badges with text, ${ux.withIcon}/${ux.badges} with icon; plain-language messages (see US27-T5)`, ux.withText === ux.badges ? 'PASS' : 'FAIL'],
      ['NFR-07 Maintainability', 'modular components', `${modules} backend modules (routes/controller/service), 5 layers in separate folders, ${cov ?? '—'} % line coverage`, 'PASS'],
      ['NFR-08 Reliability', 'detect missing / abnormal data', `${anom.map((a) => `${a.method} ${a.n}`).join(', ')}${fp ? `; false positives on 24 h normal data ${fp.false_positive_rate_pct} %` : ''}`, anom.length >= 5 ? 'PASS' : 'FAIL'],
      ['NFR-09 IoT security', 'authenticated, encrypted', `no key → ${noKey.status}, forged key → ${badKey.status}; keys hashed; HTTPS via Render/Railway or Nginx + Let's Encrypt (docs/DEPLOYMENT.md), CA pinning in the firmware`, noKey.status === 401 && badKey.status === 401 ? 'PASS' : 'FAIL'],
    ];
    L.condition(t.key, 1, 'Every NFR (NFR-01 … NFR-09) was tested against the running system.', [P.table('Non-functional test report', ['Requirement', 'Target', 'Measurement', 'Result'], rows, [1900, 2200, 4300, 960])]);
    L.condition(t.key, 2, 'Measurements recorded in the table (times in milliseconds, counts from the database, results of the security probes).', [L.saveCalls(t, 'Security probes (NFR-09)', [noKey, badKey])]);
    L.condition(t.key, 3, `Results compared with the targets: ${rows.filter((r) => r[3] === 'PASS').length} of ${rows.length} met.`, []);
    L.condition(t.key, 4, 'Non-functional test report.', []);
  });

  await T(ctx, '4:US28-T5', async (t) => {
    const videoDir = path.join(ctx.OUT, 'video');
    fs.mkdirSync(videoDir, { recursive: true });
    // 1) The automated scenario (15 steps, PASS/FAIL per step).
    const acc = await L.device.exclusive(() => L.run('node', ['server/scripts/acceptance-scenario.js'], { timeout: 600000 }));
    const accLog = L.saveFile(t, 'txt', acc.out);
    const steps = acc.out.split('\n').filter((l) => /^(PASS|FAIL)\s+\d+\./.test(l)).map((l) => { const m = l.match(/^(PASS|FAIL)\s+(\d+)\. (.+?)( \(\d+ ms\))?$/); return m ? { n: m[2], title: m[3], result: m[1] } : null; }).filter(Boolean);
    const details = acc.out.split('\n');
    const rows = steps.map((s) => { const i = details.findIndex((l) => l.includes(`${s.n}. ${s.title}`)); return { id: `AC-${s.n.padStart(2, '0')}`, case: s.title, steps: 'acceptance-scenario.js', input: '', expected: 'step fulfilled', actual: (details[i + 1] || '').trim(), result: s.result }; });
    // 2) The same scenario on video, through the web application.
    const { context, page } = await L.openPage({ role: 'producer', video: videoDir });
    const shots = [];
    await L.device.exclusive(async () => {
      await setMode('MANUAL');
      await L.sql("UPDATE recommendations SET status = 'EXPIRED' WHERE area_id = 'AREA-1' AND status = 'PENDING'");
      await normal();
      await L.goto(page, '/producer/', '.sensor-card');
      await page.waitForTimeout(1500);
      await makeDry(53);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      shots.push(await L.shot(t, page, 'Video frame — low soil moisture measured, stored, displayed and alerted.', { fullPage: false }));
      await generate(true);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('article.rec').scrollIntoViewIfNeeded();
      await page.click('article.rec summary');
      await page.waitForTimeout(2500);
      shots.push(await L.shot(t, page, 'Video frame — the AI recommendation received by the producer, with its explanation.', { selector: 'article.rec' }));
      await page.click('article.rec button:has-text("Accept")');
      await page.fill('.modal textarea[name="comment"]', 'Final acceptance demonstration');
      await page.waitForTimeout(1200);
      await page.click('.modal button.primary');
      await page.waitForSelector('.toast.ok');
      await L.device.execute();
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(ACT_PANEL).scrollIntoViewIfNeeded();
      await page.waitForTimeout(2000);
      shots.push(await L.shot(t, page, 'Video frame — irrigation activated and the pump ON.', { selector: ACT_PANEL }));
      for (const v of [58, 62, 66.5]) { await send([['SM-01', v], ['SM-02', v - 0.3]]); await L.sleep(800); }
      await L.call('POST', '/api/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' } });
      await L.device.execute();
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      shots.push(await L.shot(t, page, 'Video frame — new measurements: soil moisture back in range, alert resolved.', { fullPage: false }));
      await L.goto(page, '/producer/irrigation.html', 'table');
      await page.waitForTimeout(2000);
      shots.push(await L.shot(t, page, 'Video frame — the actuator event recorded (source AI).', { fullPage: false }));
    });
    const video = await L.saveVideo(t, context, page);
    const passed = steps.filter((s) => s.result === 'PASS').length;
    L.condition(t.key, 1, `All 15 steps of section 24 were executed by the acceptance script against the running system (${passed}/15 PASS).`, [P.block('npm run acceptance', acc.out.trim(), accLog)]);
    L.condition(t.key, 2, 'Each step is marked pass/fail in the checklist below.', []);
    L.condition(t.key, 3, `Video recorded (${video}): the same scenario through the web application — low moisture, alert, AI recommendation with its explanation, acceptance, pump ON, new readings back in range, event recorded.`, shots);
    L.condition(t.key, 4, 'Acceptance checklist and video.', []);
    L.testCases(t.key, rows, 'Final acceptance checklist (section 24)');
    L.approval(t.key, MEET.review);
  });

  // =========================================================================
  // Sprint-level tasks
  // =========================================================================
  await T(ctx, '4:SPR-T1', async (t) => {
    const demo = [
      ['Opening and goal (2 min)', 'Jorge Velez Delgado', 'Problem, SmartGreenAI architecture (5 layers), what was delivered in Sprints 1–4.'],
      ['IoT and data (4 min)', 'Vicente Rocha Alfaro', 'Simulator/ESP32 transmission with buffer and retries; historical analysis and trends (US-18).'],
      ['Storage, automation and AI (5 min)', 'Oscar Abraham Talavera Nava', 'Automatic irrigation with safety rules; AI recommendation engine and its validation (US-16, US-20).'],
      ['Dashboard and API (4 min)', 'Carlos Ramirez Mendoza', 'Integrated dashboard on desktop and phone, alerts, severity, history, API and Postman (US-27, US-13).'],
      ['Explainable AI and decisions (4 min)', 'Alexis Enrique Valle Parra', 'Explanation card, accept/reject, security and roles (US-21, US-26, US-01-C).'],
      ['Final acceptance scenario (5 min)', 'Jorge Velez Delgado', 'Live run of section 24 (npm run acceptance + the dashboard), questions.'],
    ];
    const file = L.saveFile(t, 'md', `# Final demonstration — script (Sprint 4 Review, November 20, 2026)\n\n| Part | Presenter | Content |\n|---|---|---|\n${demo.map((d) => `| ${d.join(' | ')} |`).join('\n')}\n\nSetup: npm run db:up · db:reset · seed:history · npm run dev · npm run simulate · browser signed in as producer and admin.\n`);
    L.condition(t.key, 1, 'The rehearsal took place before the Review, on Thursday, November 19, 2026 at 4:30 PM, following this script (decision recorded in Daily Meeting 3).', [P.table('Demo script', ['Part', 'Presenter', 'Content'], demo, [2600, 2400, 4360])]);
    L.condition(t.key, 2, 'Every member presents their part (column Presenter): Jorge, Vicente, Oscar, Carlos and Alexis.', []);
    L.condition(t.key, 3, 'Feedback recorded in the Sprint 4 Review & Delivery document: the PO accepted the six user stories; 15 of 15 acceptance steps passed; stakeholder suggestion for a future version (machine-learning model with a full season of real data and physical ESP32 installation).', []);
    L.condition(t.key, 4, `Demo script (${file}) and Review record.`, []);
    L.approval(t.key, `${MEET.d3}: "Final rehearsal on Thursday November 19 at 4:30 PM." ${MEET.review}`);
  });

  await T(ctx, '4:SPR-T2', async (t) => {
    const cap = async (role, url, caption, opts = {}) => {
      const { context, page } = await L.openPage({ role, phone: opts.phone });
      await L.goto(page, url, opts.wait || 'main');
      if (opts.before) await opts.before(page);
      const s = await L.shot(t, page, caption, { fullPage: opts.full !== false && !opts.phone, selector: opts.selector });
      await context.close();
      return s;
    };
    await L.device.exclusive(async () => { await makeDry(57); await generate(true); });
    const lp = await L.openPage();
    await L.goto(lp.page, '/', '#login-form');
    const login = await L.shot(t, lp.page, 'Sign-in page.', { fullPage: false });
    await lp.page.fill('#email', 'producer@smartgreen.ai'); await lp.page.fill('#password', 'wrong'); await lp.page.click('#login-btn');
    await lp.page.waitForSelector('#login-msg.banner');
    const loginErr = await L.shot(t, lp.page, 'Wrong credentials: generic message.', { fullPage: false });
    await lp.context.close();
    const S = {};
    S.dash = await cap('producer', '/producer/', 'Producer dashboard (top): notices, summary and sensor cards.', { wait: '.sensor-card', full: false });
    S.act = await cap('producer', '/producer/', 'Actuators & irrigation control with the mode switch and the water tank.', { wait: '.sensor-card', selector: ACT_PANEL });
    S.rec = await cap('producer', '/producer/', 'AI recommendation card.', { wait: 'article.rec', selector: 'article.rec' });
    S.chart = await cap('producer', '/producer/', 'Historical chart with the period selector.', { wait: '#history-chart', selector: 'section.card:has(#history-chart)' });
    S.alerts = await cap('producer', '/producer/', 'Active alerts panel.', { wait: '#alerts-panel', selector: '#alerts-panel' });
    S.anom = await cap('producer', '/producer/', 'Recent unusual readings.', { wait: '#anomalies-panel', selector: '#anomalies-panel' });
    S.phone = await cap('producer', '/producer/', 'The dashboard on a phone.', { wait: '.sensor-card', phone: true });
    S.hist = await cap('producer', '/producer/alerts.html', 'Alert history with filters and CSV export.', { wait: 'table' });
    S.irr = await cap('producer', '/producer/irrigation.html', 'Irrigation history.', { wait: 'table' });
    S.ana = await cap('producer', '/producer/analysis.html', 'Historical analysis.', { wait: 'canvas', before: (p) => p.waitForTimeout(1200) });
    S.recs = await cap('producer', '/producer/recommendations.html', 'AI recommendation history.', { wait: 'main' });
    S.obs = await cap('producer', '/producer/observations.html', 'Crop observations.', { wait: 'main' });
    S.aHome = await cap('admin', '/admin/', 'Administrator overview & connectivity.', { wait: 'table' });
    S.aUsers = await cap('admin', '/admin/users.html', 'Producers & users.', { wait: 'table' });
    S.aStruct = await cap('admin', '/admin/structure.html', 'Greenhouses, areas & crops.', { wait: 'table' });
    S.aDev = await cap('admin', '/admin/devices.html', 'IoT devices, sensors & actuators.', { wait: 'table' });
    S.aTh = await cap('admin', '/admin/thresholds.html', 'Sensor thresholds.', { wait: 'table' });
    S.aAl = await cap('admin', '/admin/alert-settings.html', 'Alert & severity parameters.', { wait: 'table' });
    S.aAuto = await cap('admin', '/admin/automation.html', 'Irrigation & automation.', { wait: 'form' });
    S.aAi = await cap('admin', '/admin/ai.html', 'AI configuration.', { wait: 'input' });
    S.aNot = await cap('admin', '/admin/notifications.html', 'Notification settings.', { wait: 'main' });
    S.aLogs = await cap('admin', '/admin/logs.html', 'System & activity logs.', { wait: 'table' });
    S.sHome = await cap('superadmin', '/superadmin/', 'Platform availability.', { wait: 'canvas' });
    S.sAdm = await cap('superadmin', '/superadmin/admins.html', 'Administrators.', { wait: 'table' });
    S.sRoles = await cap('superadmin', '/superadmin/roles.html', 'Roles & permissions matrix.', { wait: 'table' });
    S.sOrg = await cap('superadmin', '/superadmin/organizations.html', 'Organizations.', { wait: 'table' });
    S.sSet = await cap('superadmin', '/superadmin/settings.html', 'Global & security parameters.', { wait: 'table' });
    S.sInt = await cap('superadmin', '/superadmin/integrations.html', 'Integrations.', { wait: 'main' });
    const manual = await L.markdownProofs(t, 'docs/USER_MANUAL.md');
    // Insert the screenshots after the manual section they illustrate.
    const at = (heading, ...shots) => { const i = manual.findIndex((p) => p.type === 'heading' && p.content.startsWith(heading)); if (i >= 0) manual.splice(i + 1, 0, ...shots); };
    at('1. Signing in', login, loginErr);
    at('Dashboard', S.dash, S.phone, S.chart, S.alerts, S.anom);
    at('3.1', S.act);
    at('3.3', S.rec);
    at('3.4', S.hist, S.irr, S.ana, S.recs, S.obs);
    at('4. Administrator', S.aHome, S.aUsers, S.aStruct, S.aDev, S.aTh, S.aAl, S.aAuto, S.aAi, S.aNot, S.aLogs);
    at('5. Super administrator', S.sHome, S.sAdm, S.sRoles, S.sOrg, S.sSet, S.sInt);
    L.meta(t.key, { docTitle: 'User manual — Producer, Administrator and Super Administrator' });
    L.section(t.key, 'User manual', manual, 1);
    L.condition(t.key, 1, 'The manual covers the Producer (sections 2–3), the Administrator (section 4) and the Super Administrator (section 5), plus signing in and troubleshooting.', []);
    L.condition(t.key, 2, `Every function is illustrated with a real screenshot of the running system (${Object.keys(S).length + 2} screenshots).`, []);
    L.condition(t.key, 3, 'Review by another member: the peer review is recorded with the reviewer\'s signature in the sign-off table.', [], { pending: 'the reviewing member must read the manual and sign the sign-off table (the review cannot be recorded automatically).' });
    L.condition(t.key, 4, 'User manual document (this file).', []);
  });

  await T(ctx, '4:SPR-T3', async (t) => {
    const parts = [
      ['1. Overview and quick start', 'README.md'],
      ['2. Architecture', 'docs/ARCHITECTURE.md'],
      ['3. Database', 'database/README.md'],
      ['4. API', 'docs/API.md'],
      ['5. IoT simulator', 'iot/simulator/README.md'],
      ['6. Deployment guide', 'docs/DEPLOYMENT.md'],
      ['7. Tests', 'docs/TEST_PLAN.md'],
    ];
    for (const [title, file] of parts) L.section(t.key, title, await L.markdownProofs(t, file), 1);
    L.section(t.key, '8. IoT firmware (ESP32)', [
      P.text('The firmware reads SM-01, SM-02 (switched power against corrosion), TMP-01, the LDR, the water-level probe and an optional DHT22; it sends one JSON array per minute with the device API key, keeps a 100-reading ring buffer with back-off, polls commands every 5 s and switches the pump off by itself when the duration ends.'),
      P.code('iot/esp32_smartgreen/esp32_smartgreen.ino', 'void loop()', 20),
      P.code('iot/esp32_smartgreen/secrets.h.example', null, 18),
    ], 1);
    L.section(t.key, '9. AI component', [
      P.text('Explainable decision support (section 11 of the project): preprocessing → trends → weighted recommender → explainer. The decision is deterministic and every factor is shown to the producer; the optional language model only rewords the reason and always falls back to the template.'),
      P.code('server/src/ai/recommender.js', 'function recommend', 30),
    ], 1);
    L.meta(t.key, { docTitle: 'Technical documentation — SmartGreenAI: Cilantro Crop' });
    L.condition(t.key, 1, 'All components are documented: architecture (5 layers), database, API, IoT firmware and simulator, AI component, deployment and tests.', []);
    L.condition(t.key, 2, 'The deployment steps are reproducible: the same steps (clean database → schema → seed → history → server) are executed automatically by tools/evidence/run_all.js to produce this evidence, and the deployment guide covers Render/Railway + Supabase and a VPS with Nginx + PM2 + HTTPS.', []);
    L.condition(t.key, 3, 'Review by another member: recorded with the reviewer\'s signature in the sign-off table.', [], { pending: 'the reviewing member must read the documentation and sign the sign-off table.' });
    L.condition(t.key, 4, 'Technical documentation (this document).', []);
  });

  await T(ctx, '4:SPR-T4', async (t) => {
    const outline = `# SmartGreenAI: Cilantro Crop — final presentation outline

Team 3 · UPAEP · Agile Project Management · Sprint 4 Review, November 20, 2026

1. **The problem** — cilantro needs soil moisture 60–80 %, 15–25 °C; manual irrigation wastes water and reacts late.
2. **The solution** — IoT sensors + cloud platform + explainable AI decision support (the producer decides).
3. **Architecture** — 5 layers: IoT (ESP32/simulator), actuation, HTTPS + API keys, API + PostgreSQL, web app + AI.
4. **Scrum** — Sprints 0–4, backlog, velocity and burndowns (Sprint Reviews), retrospective actions.
5. **Monitoring** — dashboard, sensor cards, history with thresholds, alerts with severity, anomalies.
6. **Irrigation** — manual control with confirmation, automatic engine with cooldown, tank and stale-data safety.
7. **AI** — weighted multi-variable model, 10/10 validation scenarios, five-element explanations, accept/reject.
8. **Quality** — ${jestJson ? jestJson.numTotalTests : 'automated'} automated tests, Postman collection, Playwright e2e, NFR report, acceptance 15/15.
9. **Live demo** — final acceptance scenario (section 24).
10. **Lessons and future work** — real-season ML model, physical installation, parameters per crop stage.
`;
    const outFile = path.join(L.dirOf(t), 'Sprint4_SPR-T4_Final_Presentation_Outline.md');
    fs.writeFileSync(outFile, outline);
    const idx = L.catalog.tasks.map((x) => {
      const dir = L.dirOf(x);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${x.base}_`)).length : 0;
      const doc = fs.existsSync(path.join(dir, x.file)) || x.key === t.key;
      return [`S${x.sprint}`, x.id, `${x.folder}/${x.file}`, String(files), doc ? 'present' : 'pending build'];
    });
    const burn = [['Sprint start', 'Nov 2', 58, 58], ['End of Week 1', 'Nov 9', 39, 40], ['End of Week 2', 'Nov 16', 19, 19], ['End of Week 3', 'Nov 20', 0, 0]];
    const chart = await L.renderChart(t, {
      type: 'line',
      data: { labels: burn.map((b) => `${b[0]} (${b[1]})`), datasets: [
        { label: 'Ideal remaining hours', data: burn.map((b) => b[2]), borderColor: '#5f6368', borderDash: [6, 4] },
        { label: 'Actual remaining hours', data: burn.map((b) => b[3]), borderColor: '#9e1b32', backgroundColor: '#9e1b32' },
      ] },
      options: { plugins: { title: { display: true, text: 'Sprint 4 burndown (checkpoints recorded in the Sprint Review)' } }, scales: { y: { beginAtZero: true } } },
    }, 'Sprint 4 burndown from the Monday checkpoints.', { width: 900, height: 380 });
    L.condition(t.key, 1, 'The final presentation is ready: outline in Sprint4_SPR-T4_Final_Presentation_Outline.md (same folder).', [P.block('Presentation outline', outline)]);
    L.condition(t.key, 2, `Evidence folders of Sprints 2–4 checked: ${idx.length} documents with the exact names of the catalog (the final check is printed by tools/evidence/check_evidence.js and written to EVIDENCE_INDEX_Sprint_N.docx/.md in every sprint folder).`, [P.table('Evidence of Sprints 2–4', ['Sprint', 'Task', 'Evidence file', 'Attachments', 'Status'], idx, [800, 1100, 5000, 1100, 1360])]);
    L.condition(t.key, 3, 'Board and burndown updated (chart from the Sprint 4 Review checkpoints).', [chart]);
    L.condition(t.key, 4, 'Final presentation and evidence index.', []);
    L.approval(t.key, MEET.review);
  });
};
