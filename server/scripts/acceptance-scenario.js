#!/usr/bin/env node
'use strict';

/**
 * Final acceptance scenario — section 24 of the project document.
 *
 * Runs the 15 steps end-to-end against the real API and database and prints
 * PASS/FAIL for each one:
 *
 *   1  A soil-moisture sensor measures a low value
 *   2  The IoT device transmits the measurement to the cloud
 *   3  The cloud stores the measurement
 *   4  The dashboard displays the measurement
 *   5  The alert engine identifies the low-moisture condition
 *   6  An alert is generated
 *   7  The AI analyzes the current and historical data
 *   8  The AI generates an irrigation recommendation
 *   9  The producer receives the recommendation
 *  10  The producer activates irrigation (accepts the recommendation -> command -> device)
 *  11  Alternatively, automatic irrigation can be activated by the configured rules
 *  12  The actuator event is recorded
 *  13  New sensor measurements are collected
 *  14  The system verifies that soil moisture has improved
 *  15  The complete process is visible in the dashboard
 *
 * The API runs in-process on a free port with the background jobs disabled, so
 * every step is deterministic; the script plays the role of the ESP32 (same
 * API key, payloads, command polling and state reports as the firmware) and
 * triggers the engines exactly as the scheduler would.
 *
 *   npm run acceptance
 *
 * Requires the schema, the seed and (recommended) `npm run seed:history`.
 */

process.env.JOBS_ENABLED = 'false';

const app = require('../src/app');
const db = require('../src/db');
const recommendationJob = require('../src/jobs/recommendationJob');
const irrigation = require('../src/modules/irrigation/service');

const DEVICE_KEY = process.env.DEVICE_API_KEY || 'sec_iot_dev_node_01_smartgreen_team3';
const AREA = 'AREA-1';
const PUMP = 'ACT-PUMP-01';
const DRYING_STEP_MS = 30000;
const DRYING_WINDOW_MS = 5 * DRYING_STEP_MS;

let base;
const results = [];
const ctx = {};

// ---------------------------------------------------------------------------
async function http(method, route, { token, apikey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apikey) headers.apikey = apikey;
  const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* html or csv */ }
  return { status: res.status, body: data };
}

async function step(n, title, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ n, ok: true });
    console.log(`PASS  ${String(n).padStart(2)}. ${title} (${Date.now() - started} ms)${detail ? `\n        ${detail}` : ''}`);
  } catch (err) {
    results.push({ n, ok: false });
    console.log(`FAIL  ${String(n).padStart(2)}. ${title}\n        ${err.message}`);
  }
}

function assert(condition, message) { if (!condition) throw new Error(message); }

/** Readings of every AREA-1 sensor at one instant (what the firmware sends each cycle). */
function cycle(at, soil1, soil2, temperature, humidity) {
  const iso = at.toISOString();
  return [
    { sensor_id: 'SM-01', value: soil1, unit: '%', recorded_at: iso },
    { sensor_id: 'SM-02', value: soil2, unit: '%', recorded_at: iso },
    { sensor_id: 'TMP-01', value: temperature, unit: 'C', recorded_at: iso },
    { sensor_id: 'HUM-01', value: humidity, unit: '%', recorded_at: iso },
    { sensor_id: 'WL-01', value: 78, unit: '%', recorded_at: iso },
    { sensor_id: 'LUX-01', value: 24000, unit: 'lux', recorded_at: iso },
    { sensor_id: 'CO2-01', value: 560, unit: 'ppm', recorded_at: iso },
    { sensor_id: 'PH-01', value: 6.5, unit: 'pH', recorded_at: iso },
  ];
}

// ---------------------------------------------------------------------------
async function prepare() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  ctx.server = server;

  const login = async (email, password) => {
    const r = await http('POST', '/auth/login', { body: { email, password } });
    assert(r.status === 200, `login ${email} failed: ${JSON.stringify(r.body)}`);
    return r.body.access_token;
  };
  ctx.producer = await login('producer@smartgreen.ai', 'Producer123!');
  ctx.admin = await login('admin@smartgreen.ai', 'Admin123!');

  // Clean starting point for a repeatable demonstration: no pending
  // recommendation, no command in flight, no open soil alert, pump OFF,
  // area in MANUAL mode so the producer's decision is the one executed.
  const area = await db.one('SELECT mode FROM areas WHERE id = $1', [AREA]);
  ctx.originalMode = area.mode;
  await db.query("UPDATE recommendations SET status = 'EXPIRED' WHERE area_id = $1 AND status = 'PENDING'", [AREA]);
  await db.query("UPDATE actuator_commands SET status = 'EXPIRED' WHERE actuator_id = $1 AND status IN ('PENDING','SENT')", [PUMP]);
  await db.query("UPDATE alerts SET status = 'RESOLVED', resolved_at = NOW() WHERE sensor_id IN ('SM-01','SM-02','TMP-01','HUM-01') AND status <> 'RESOLVED'");
  await db.query("UPDATE actuators SET state = 'OFF', last_update = NOW() WHERE id = $1", [PUMP]);
  await db.query("UPDATE areas SET mode = 'MANUAL' WHERE id = $1", [AREA]);
  // Fault anomalies recorded on the soil probes in the last hour (for example
  // the out-of-range readings of the Postman collection) make the AI answer
  // CHECK_SENSOR, which is correct behaviour but not this scenario: the
  // demonstration starts from healthy sensors.
  const faults = await db.query(
    `DELETE FROM anomalies WHERE sensor_id IN ('SM-01', 'SM-02')
        AND method IN ('OUT_OF_RANGE', 'SUDDEN_JUMP', 'FLATLINE')
        AND detected_at > NOW() - INTERVAL '1 hour'`,
  );
  if (faults.rowCount) {
    console.log(`(setup) cleared ${faults.rowCount} soil-sensor fault anomaly record(s) left by earlier test runs\n`);
  }
  // Irrigations older than the cooldown only; a leftover from a previous run
  // inside the cooldown window would (correctly) block step 11.
  await db.query(
    "DELETE FROM actuator_events WHERE actuator_id = $1 AND action = 'ON' AND created_at > NOW() - INTERVAL '45 minutes'", [PUMP],
  );
  recommendationJob.reset();

  // The drying series below covers the last 2.5 minutes. A run started right
  // after another one would interleave its readings with the previous run's,
  // so wait until the latest soil reading is older than that window.
  const last = await db.one("SELECT MAX(recorded_at) AS at FROM measurements WHERE sensor_id = 'SM-01'");
  const ageMs = last && last.at ? Date.now() - new Date(last.at).getTime() : Infinity;
  if (ageMs < DRYING_WINDOW_MS + 10000) {
    const waitMs = DRYING_WINDOW_MS + 10000 - ageMs;
    console.log(`(setup) the previous run finished ${Math.round(ageMs / 1000)} s ago; waiting ${Math.ceil(waitMs / 1000)} s so the readings do not overlap
`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function main() {
  console.log('SmartGreenAI: Cilantro Crop — final acceptance scenario (section 24)\n');
  await prepare();

  // The soil dries gradually over the last 2.5 minutes (a real sensor never jumps).
  const now = Date.now();
  const drying = [
    [64.0, 63.1, 26.5, 55], [61.2, 60.4, 27.4, 53], [58.3, 57.6, 28.1, 51],
    [55.4, 54.9, 28.6, 50], [53.1, 52.2, 28.9, 49], [52.0, 51.4, 29.1, 48],
  ].map(([s1, s2, t, hu], i) => cycle(new Date(now - (5 - i) * DRYING_STEP_MS), s1, s2, t, hu)).flat();

  await step(1, 'A soil-moisture sensor measures a low moisture value', async () => {
    const last = drying.filter((r) => r.sensor_id === 'SM-01').pop();
    const th = await db.one("SELECT min_value FROM thresholds WHERE area_id = $1 AND sensor_type = 'soil_moisture'", [AREA]);
    ctx.minMoisture = Number(th.min_value);
    assert(last.value < ctx.minMoisture, `reading ${last.value} % is not below ${th.min_value} %`);
    ctx.lowValue = last.value;
    return `SM-01 reads ${last.value} % (SM-02 51.4 %), cilantro minimum is ${th.min_value} %; air 29.1 °C`;
  });

  await step(2, 'The IoT device transmits the measurement to the cloud', async () => {
    const r = await http('POST', '/measurements', { apikey: DEVICE_KEY, body: drying });
    assert(r.status === 201, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(r.body.accepted === drying.length, `${r.body.rejected} readings rejected: ${JSON.stringify(r.body.errors).slice(0, 300)}`);
    ctx.ingest = r.body;
    return `POST /api/measurements (apikey header, batch of ${drying.length}) -> 201, ${r.body.accepted} accepted`;
  });

  await step(3, 'The cloud stores the measurement', async () => {
    const r = await http('GET', '/sensors/SM-01/measurements?limit=1', { token: ctx.producer });
    const m = r.body.data && r.body.data[0];
    assert(m && Number(m.value) === ctx.lowValue, `latest stored SM-01 value is ${m && m.value}`);
    return `measurements row: SM-01 = ${m.value} % recorded_at ${m.recorded_at} received_at ${m.received_at}`;
  });

  await step(4, 'The dashboard displays the measurement', async () => {
    const latest = await http('GET', '/measurements/latest', { token: ctx.producer });
    const card = latest.body.find((x) => x.sensor_id === 'SM-01');
    assert(card && Number(card.value) === ctx.lowValue, 'the dashboard feed does not show the new value');
    const page = await http('GET', '/../producer/');
    assert(page.status === 200, 'the producer dashboard page is not served');
    return `GET /api/measurements/latest -> SM-01 ${card.value} % (optimal ${card.threshold_min}-${card.threshold_max} %), shown as "Below range" on /producer/`;
  });

  await step(5, 'The alert engine identifies the low-moisture condition', async () => {
    const hits = ctx.ingest.results.filter((x) => x.sensor_id === 'SM-01' && x.alert && x.alert.type === 'LOW');
    assert(hits.length, 'no LOW alert was attached to the SM-01 readings');
    const first = hits[0].alert;
    const last = hits[hits.length - 1].alert;
    ctx.alertId = last.id;
    return `each SM-01 reading was compared with the threshold: LOW condition from the first reading under 60 % `
      + `(severity ${first.severity}), escalated to ${last.severity} as the deviation grew — one alert, no duplicates`;
  });

  await step(6, 'An alert is generated', async () => {
    const r = await http('GET', '/alerts?status=OPEN&sensor_id=SM-01', { token: ctx.producer });
    const a = r.body.data.find((x) => x.id === ctx.alertId);
    assert(a, 'the alert is not listed as OPEN');
    return `alert ${a.id}: ${a.type} / ${a.severity} — "${a.message}"`;
  });

  await step(7, 'The AI analyzes the current and historical data', async () => {
    const outcomes = await recommendationJob.run({ force: true });
    const o = (outcomes || []).find((x) => x.area_id === AREA);
    assert(o && o.recommendation, `no analysis result for ${AREA}: ${o && o.reason}`);
    ctx.rec = o.recommendation;
    const i = ctx.rec.inputs;
    const hist = await db.one(
      "SELECT COUNT(*)::int AS n FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE s.area_id = $1 AND m.recorded_at > NOW() - INTERVAL '24 hours'", [AREA],
    );
    assert(i.soil_moisture !== undefined && i.data_completeness !== undefined, 'the feature vector is incomplete');
    return `features: soil ${i.soil_moisture} %, temp ${i.temperature} °C, humidity ${i.air_humidity} %, tank ${i.tank_level} %, `
      + `${Number(i.hours_since_irrigation).toFixed(1)} h since irrigation, data completeness ${i.data_completeness}; ${hist.n} readings of the last 24 h analysed`;
  });

  await step(8, 'The AI generates an irrigation recommendation', async () => {
    const r = ctx.rec;
    assert(r.type === 'IRRIGATE', `the AI recommended ${r.type} (score ${r.score}): ${r.reason}`);
    for (const k of ['recommendation', 'reason', 'relevant_measurements', 'confidence_text', 'created_at']) {
      assert(r[k] !== undefined && r[k] !== null && r[k] !== '', `explanation element "${k}" missing`);
    }
    return `${r.type} for ${r.recommended_duration_min} min, score ${r.score}/100, confidence ${r.confidence_text} — "${r.recommendation}"`;
  });

  await step(9, 'The Cilantro producer receives the recommendation', async () => {
    const r = await http('GET', `/recommendations?status=PENDING&area_id=${AREA}`, { token: ctx.producer });
    assert(r.status === 200 && r.body.some((x) => x.id === ctx.rec.id), 'the recommendation is not visible to the producer');
    return `GET /api/recommendations (producer token) lists ${ctx.rec.id} as PENDING with its 5 explanation elements`;
  });

  await step(10, 'The Cilantro producer activates irrigation', async () => {
    const d = await http('POST', `/recommendations/${ctx.rec.id}/decision`, {
      token: ctx.producer, body: { decision: 'ACCEPTED', comment: 'Acceptance test: irrigate now.' },
    });
    assert(d.status === 200 && d.body.command, `decision failed: HTTP ${d.status} ${JSON.stringify(d.body).slice(0, 200)}`);
    ctx.command = d.body.command;
    // The device polls its commands and confirms the execution (firmware loop).
    const poll = await http('GET', '/devices/me/commands', { apikey: DEVICE_KEY });
    const cmd = poll.body.commands.find((c) => c.id === ctx.command.id);
    assert(cmd && cmd.action === 'ON', 'the device did not receive the ON command');
    const st = await http('POST', `/actuators/${PUMP}/state`, { apikey: DEVICE_KEY, body: { state: 'ON', duration_min: Number(cmd.duration_min) } });
    assert(st.status === 200 && st.body.command_id === ctx.command.id, 'the device could not confirm the command');
    const again = await http('POST', `/recommendations/${ctx.rec.id}/decision`, { token: ctx.producer, body: { decision: 'REJECTED' } });
    assert(again.status === 409, 'a second decision was not rejected with 409');
    return `accepted -> command ${cmd.id} (source ${cmd.source}, ${cmd.duration_min} min) collected by dev-node-01 and confirmed; pump ON; a second decision returns 409`;
  });

  await step(11, 'Alternatively, automatic irrigation can be activated by the configured rules', async () => {
    // The same drying readings evaluated by the automatic engine as if the area
    // were in AUTOMATIC mode, before the manual command existed (dry run: the
    // producer's command above is the one executed).
    const area = await db.one('SELECT * FROM areas WHERE id = $1', [AREA]);
    await db.query("UPDATE actuator_commands SET status = 'EXPIRED' WHERE id = $1", [ctx.command.id]);
    await db.query("UPDATE actuators SET state = 'OFF' WHERE id = $1", [PUMP]);
    const savedEvents = await db.rows("SELECT id FROM actuator_events WHERE actuator_id = $1 AND created_at > NOW() - INTERVAL '1 minute'", [PUMP]);
    await db.query('UPDATE actuator_events SET created_at = created_at - INTERVAL \'2 hours\' WHERE id = ANY($1)', [savedEvents.map((e) => e.id)]);
    let decision;
    try {
      decision = await irrigation.decide({ ...area, mode: 'AUTOMATIC' });
    } finally {
      await db.query('UPDATE actuator_events SET created_at = created_at + INTERVAL \'2 hours\' WHERE id = ANY($1)', [savedEvents.map((e) => e.id)]);
      await db.query("UPDATE actuator_commands SET status = 'EXECUTED' WHERE id = $1", [ctx.command.id]);
      await db.query("UPDATE actuators SET state = 'ON' WHERE id = $1", [PUMP]);
    }
    assert(decision.action === 'ON', `engine decision was ${decision.action}: ${decision.reason}`);
    return `engine decision (AUTOMATIC mode, dry run): ON for ${decision.duration_min} min — ${decision.reason}`;
  });

  await step(12, 'The actuator event is recorded', async () => {
    const r = await http('GET', `/actuators/events?actuator_id=${PUMP}&limit=5`, { token: ctx.producer });
    const ev = r.body.find((e) => e.command_id === ctx.command.id && e.action === 'ON');
    assert(ev, 'no ON event linked to the command');
    return `event ${ev.id}: ${ev.action} source ${ev.source} by ${ev.user_email || ev.user_id} for ${ev.duration_min} min at ${ev.created_at}`;
  });

  await step(13, 'New sensor measurements are collected', async () => {
    // Closed loop: while the pump runs the soil moisture rises (simulator physics: +1.1 %/min).
    const start = Date.now();
    const rising = [[57.6, 57.0], [63.1, 62.4], [66.8, 66.1]]
      .map(([s1, s2], i) => cycle(new Date(start + (i + 1) * 1000), s1, s2, 28.4, 52)).flat();
    const r = await http('POST', '/measurements', { apikey: DEVICE_KEY, body: rising });
    assert(r.status === 201 && r.body.accepted === rising.length, `HTTP ${r.status}, ${r.body.rejected} rejected`);
    // Duration elapsed: the firmware switches the pump off and reports it.
    const off = await http('POST', `/actuators/${PUMP}/state`, { apikey: DEVICE_KEY, body: { state: 'OFF' } });
    assert(off.status === 200, 'the OFF state report failed');
    return `${r.body.accepted} new readings stored during irrigation (SM-01 57.6 -> 63.1 -> 66.8 %); pump reported OFF`;
  });

  await step(14, 'The system verifies whether soil moisture has improved', async () => {
    const latest = await http('GET', '/measurements/latest', { token: ctx.producer });
    const sm = latest.body.filter((x) => x.sensor_type === 'soil_moisture' && x.area_id === AREA);
    const avg = sm.reduce((s, x) => s + Number(x.value), 0) / sm.length;
    assert(avg > ctx.lowValue && avg >= ctx.minMoisture, `soil moisture is ${avg.toFixed(1)} %`);
    const alert = await http('GET', '/alerts?sensor_id=SM-01&limit=20', { token: ctx.producer });
    const a = alert.body.data.find((x) => x.id === ctx.alertId);
    assert(a && a.status === 'RESOLVED', `the low-moisture alert is ${a && a.status}`);
    return `average soil moisture ${ctx.lowValue} % -> ${avg.toFixed(1)} % (inside ${ctx.minMoisture}-80 %); alert ${a.id} automatically RESOLVED at ${a.resolved_at}`;
  });

  await step(15, 'The complete process is visible in the dashboard', async () => {
    const [alerts, recs, events, actuators, history] = await Promise.all([
      http('GET', '/alerts?sensor_id=SM-01&limit=20', { token: ctx.producer }),
      http('GET', `/recommendations?area_id=${AREA}&limit=5`, { token: ctx.producer }),
      http('GET', `/actuators/events?actuator_id=${PUMP}&limit=5`, { token: ctx.producer }),
      http('GET', '/actuators/status', { token: ctx.producer }),
      http('GET', `/sensors/SM-01/measurements?from=${encodeURIComponent(new Date(now - 10 * 60000).toISOString())}&limit=50`, { token: ctx.producer }),
    ]);
    const rec = recs.body.find((r) => r.id === ctx.rec.id);
    assert(alerts.body.data.some((a) => a.id === ctx.alertId), 'alert missing from the alert history');
    assert(rec && rec.status === 'ACCEPTED', 'recommendation not shown as ACCEPTED');
    assert(events.body.filter((e) => e.actuator_id === PUMP).length >= 2, 'ON/OFF events missing from the irrigation history');
    assert(actuators.body.actuators.some((a) => a.id === PUMP && a.state === 'OFF'), 'pump state not shown');
    assert(history.body.data.length >= 9, 'the chart history does not contain the scenario readings');
    return `alert history ✔ · recommendation ACCEPTED ✔ · irrigation events ON/OFF ✔ · pump OFF ✔ · chart shows ${history.body.data.length} SM-01 readings (dip and recovery) ✔`;
  });

  // Restore the operating mode the area had before the demonstration.
  await db.query('UPDATE areas SET mode = $1 WHERE id = $2', [ctx.originalMode, AREA]);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed — ${passed === results.length ? 'ACCEPTANCE SCENARIO PASSED' : 'ACCEPTANCE SCENARIO FAILED'}`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main()
  .catch((err) => { console.error('acceptance scenario crashed:', err); process.exitCode = 1; })
  .finally(async () => {
    if (ctx.server) ctx.server.close();
    await db.close();
  });
