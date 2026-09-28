#!/usr/bin/env node
'use strict';

/**
 * SmartGreenAI IoT simulator — speaks exactly the same protocol as the ESP32
 * firmware (iot/esp32_smartgreen/esp32_smartgreen.ino):
 *
 *   POST /api/measurements          header "apikey"; one reading or an array (batch)
 *   POST /api/devices/heartbeat     firmware + current actuator states
 *   GET  /api/devices/me/commands   polling of pending commands (every 5 s)
 *   POST /api/actuators/:id/state   confirmation of the executed command
 *
 * It keeps a local ring buffer (100 readings) when the API cannot be reached
 * and resends it as one batch after reconnecting (US06-T4), and it runs a
 * closed loop: soil moisture rises while the pump is ON and falls by
 * evaporation depending on temperature and humidity (US16-T5).
 *
 * Usage:
 *   node iot/simulator/simulator.js [options]
 *     --url <base>            API base URL (default $API_BASE_URL or http://localhost:3000/api)
 *     --key <apikey>          device API key (default $DEVICE_API_KEY)
 *     --interval <s>          seconds between reading cycles (default 60)
 *     --speed <x>             time acceleration of the physics (default 1; 60 = one simulated minute per second)
 *     --scenario <name>       normal | dry | hot | wet | spike | flatline | disconnect | low-tank | outlier | acceptance
 *     --count <n>             stop after n cycles and print the delivery report (US06-T5)
 *     --offline-seconds <s>   simulate a network outage of s seconds after the first cycle (buffer test)
 *     --poll <s>              command polling period in seconds (default 5)
 *     --csv <file>            append every cycle to a CSV file (for charts)
 *     --quiet                 only print the summary lines
 */

const fs = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); } catch { /* optional */ }

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
function opt(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const OPTS = {
  url: String(opt('url', process.env.API_BASE_URL || 'http://localhost:3000/api')).replace(/\/$/, ''),
  key: String(opt('key', process.env.DEVICE_API_KEY || 'sec_iot_dev_node_01_smartgreen_team3')),
  interval: Number(opt('interval', 60)),
  speed: Number(opt('speed', 1)),
  scenario: String(opt('scenario', 'normal')),
  count: opt('count', null) === null ? null : Number(opt('count')),
  offlineSeconds: Number(opt('offline-seconds', 0)),
  poll: Number(opt('poll', 5)),
  csv: opt('csv', null),
  quiet: Boolean(opt('quiet', false)),
  firmware: 'simulator-1.0.0',
};

const SCENARIOS = ['normal', 'dry', 'hot', 'wet', 'spike', 'flatline', 'disconnect', 'low-tank', 'outlier', 'acceptance'];
if (!SCENARIOS.includes(OPTS.scenario)) {
  console.error(`Unknown scenario "${OPTS.scenario}". Use one of: ${SCENARIOS.join(', ')}`);
  process.exit(1);
}

const BUFFER_SIZE = 100;

const log = (...args) => { if (!OPTS.quiet) console.log(new Date().toISOString().slice(11, 19), ...args); };

// ---------------------------------------------------------------------------
// Greenhouse model (closed loop)
// ---------------------------------------------------------------------------
const env = {
  moisture: 68, temperature: 22, humidity: 60, light: 20000, co2: 600, tank: 85, ph: 6.5,
  simTime: Date.now(),
};
const actuators = {
  'ACT-PUMP-01': { state: 'OFF', offAt: null },
  'ACT-FAN-01': { state: 'OFF', offAt: null },
  'ACT-SHADE-01': { state: 'OFF', offAt: null },
  'ACT-LIGHT-01': { state: 'OFF', offAt: null },
};

// Scenario starting conditions.
switch (OPTS.scenario) {
  case 'dry': env.moisture = 55; break;
  case 'hot': env.temperature = 30; env.humidity = 45; break;
  case 'wet': env.moisture = 86; break;
  case 'low-tank': env.tank = 12; env.moisture = 57; break;
  // Section 24 of the project: low soil moisture and high temperature.
  case 'acceptance': env.moisture = 56; env.temperature = 29; env.humidity = 48; break;
  default: break;
}

const noise = (a) => (Math.random() - 0.5) * 2 * a;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;

/** Advance the physics by `minutes` of simulated time. */
function step(minutes) {
  env.simTime += minutes * 60000;
  const localHour = (new Date(env.simTime).getUTCHours() - 6 + 24) % 24;
  const daylight = Math.max(0, Math.sin(((localHour - 6) / 13) * Math.PI));

  // Temperature: scenario baseline + gentle day cycle; the fan cools.
  const base = OPTS.scenario === 'hot' || OPTS.scenario === 'acceptance' ? 28.5 : 19 + 5 * daylight;
  env.temperature += (base - env.temperature) * 0.05 * minutes + noise(0.15);
  if (actuators['ACT-FAN-01'].state === 'ON') env.temperature -= 0.08 * minutes;
  if (actuators['ACT-SHADE-01'].state === 'ON') env.temperature -= 0.03 * minutes;

  env.humidity = clamp(env.humidity + ((78 - (env.temperature - 17) * 2.6) - env.humidity) * 0.05 * minutes + noise(0.5), 30, 95);
  env.light = daylight > 0 ? clamp(daylight * 30000 + noise(1200), 0, 90000) : 0;
  if (actuators['ACT-LIGHT-01'].state === 'ON') env.light += 8000;
  if (actuators['ACT-SHADE-01'].state === 'ON') env.light *= 0.6;
  env.co2 = clamp(820 - daylight * 360 + noise(20), 380, 1400);

  // Soil water balance: evaporation grows with heat and dry air.
  const evaporation = 0.007 + Math.max(0, env.temperature - 18) * 0.0018 + Math.max(0, 60 - env.humidity) * 0.0004;
  env.moisture -= evaporation * minutes * (OPTS.scenario === 'dry' ? 2 : 1);
  if (actuators['ACT-PUMP-01'].state === 'ON' && env.tank > 0) {
    env.moisture += 1.1 * minutes;
    env.tank = Math.max(0, env.tank - 0.1 * minutes);
  }
  env.moisture = clamp(env.moisture, 20, 95);
  env.ph = clamp(env.ph + noise(0.01) + (6.5 - env.ph) * 0.02, 6.0, 7.0);

  // Auto-OFF of timed commands (the firmware does the same with millis()).
  for (const [id, a] of Object.entries(actuators)) {
    if (a.state === 'ON' && a.offAt && env.simTime >= a.offAt) {
      a.state = 'OFF';
      a.offAt = null;
      reportState(id, 'OFF', null).catch(() => {});
      log(`⏹  ${id} OFF (duration elapsed)`);
    }
  }
}

let cycle = 0;
let flatValue = null;

function readSensors() {
  cycle += 1;
  const at = new Date(env.simTime).toISOString();
  let sm1 = r1(env.moisture + noise(0.5));
  let sm2 = r1(env.moisture - 1 + noise(0.6));
  let tmp = r1(env.temperature);

  if (OPTS.scenario === 'spike' && cycle % 10 === 0) tmp = r1(tmp + 15);         // SUDDEN_JUMP
  if (OPTS.scenario === 'outlier' && cycle % 8 === 0) sm2 = 150;                 // OUT_OF_RANGE (0-100 %)
  if (OPTS.scenario === 'flatline') { if (flatValue === null) flatValue = sm1; sm1 = flatValue; } // FLATLINE

  return [
    { sensor_id: 'SM-01', value: sm1, unit: '%', recorded_at: at },
    { sensor_id: 'SM-02', value: sm2, unit: '%', recorded_at: at },
    { sensor_id: 'TMP-01', value: tmp, unit: 'C', recorded_at: at },
    { sensor_id: 'HUM-01', value: r1(env.humidity), unit: '%', recorded_at: at },
    { sensor_id: 'LUX-01', value: Math.round(env.light), unit: 'lux', recorded_at: at },
    { sensor_id: 'CO2-01', value: Math.round(env.co2), unit: 'ppm', recorded_at: at },
    { sensor_id: 'WL-01', value: r1(env.tank), unit: '%', recorded_at: at },
    { sensor_id: 'PH-01', value: Math.round(env.ph * 100) / 100, unit: 'pH', recorded_at: at },
  ];
}

// ---------------------------------------------------------------------------
// HTTP with the device API key
// ---------------------------------------------------------------------------
let networkDownUntil = 0;

async function call(method, route, body) {
  if (Date.now() < networkDownUntil) throw new Error('network unavailable (simulated outage)');
  const res = await fetch(`${OPTS.url}${route}`, {
    method,
    headers: { apikey: OPTS.key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`${res.status} ${data && data.code ? data.code : ''} ${data && data.message ? data.message : ''}`.trim());
    err.status = res.status;
    throw err;
  }
  return data;
}

async function reportState(actuatorId, state, durationMin) {
  const body = { state };
  if (durationMin) body.duration_min = durationMin;
  return call('POST', `/actuators/${actuatorId}/state`, body);
}

// ---------------------------------------------------------------------------
// Ring buffer with retry / exponential back-off (US06-T4)
// ---------------------------------------------------------------------------
const buffer = [];
let backoffMs = 0;
let nextRetryAt = 0;
const stats = { cycles: 0, sent: 0, accepted: 0, rejected: 0, failedAttempts: 0, buffered: 0, dropped: 0, delays: [] };

function pushBuffer(readings) {
  for (const r of readings) {
    if (buffer.length >= BUFFER_SIZE) { buffer.shift(); stats.dropped += 1; }
    buffer.push(r);
  }
  stats.buffered += readings.length;
}

async function sendReadings(readings) {
  const batch = [...buffer, ...readings];
  if (Date.now() < nextRetryAt) { pushBuffer(readings); log(`… waiting back-off, ${buffer.length} readings buffered`); return; }

  const started = Date.now();
  try {
    const res = await call('POST', '/measurements', batch);
    const delay = Date.now() - started;
    stats.delays.push(delay);
    stats.sent += batch.length;
    stats.accepted += res.accepted;
    stats.rejected += res.rejected;
    if (buffer.length) log(`⇪  reconnected: resent ${buffer.length} buffered readings in the same batch`);
    buffer.length = 0;
    backoffMs = 0;
    nextRetryAt = 0;
    const alerts = (res.results || []).filter((r) => r.alert && r.alert.created);
    const anomalies = (res.results || []).flatMap((r) => r.anomalies || []);
    log(`→  ${res.accepted}/${res.received} readings stored in ${delay} ms`
      + (readings.length ? ` | soil ${readings[0].value}/${readings[1].value} % temp ${readings[2].value} °C tank ${readings[6].value} %` : '')
      + `${alerts.length ? ` | ${alerts.length} new alert(s)` : ''}${anomalies.length ? ` | anomalies: ${anomalies.map((a) => a.method).join(',')}` : ''}`
      + `${res.rejected ? ` | rejected: ${res.errors.map((e) => `${e.sensor_id} ${e.message}`).join('; ')}` : ''}`);
  } catch (err) {
    stats.failedAttempts += 1;
    buffer.length = 0;
    pushBuffer(batch);
    backoffMs = backoffMs ? Math.min(backoffMs * 2, 60000) : 2000;
    nextRetryAt = Date.now() + backoffMs;
    log(`✖  send failed (${err.message}); ${buffer.length} readings buffered, retry in ${backoffMs / 1000} s`);
  }
}

// ---------------------------------------------------------------------------
// Command polling (every --poll seconds) and heartbeat
// ---------------------------------------------------------------------------
async function pollCommands() {
  let res;
  try { res = await call('GET', '/devices/me/commands'); } catch { return; }
  for (const cmd of res.commands) {
    const a = actuators[cmd.actuator_id];
    if (!a) continue;
    a.state = cmd.action;
    a.offAt = cmd.action === 'ON' && cmd.duration_min ? env.simTime + Number(cmd.duration_min) * 60000 : null;
    log(`⏻  command ${cmd.id}: ${cmd.actuator_id} ${cmd.action}${cmd.duration_min ? ` for ${cmd.duration_min} min` : ''} (source ${cmd.source})`);
    try { await reportState(cmd.actuator_id, cmd.action, cmd.duration_min); } catch (err) { log(`✖  state report failed: ${err.message}`); }
  }
}

async function heartbeat() {
  try {
    await call('POST', '/devices/heartbeat', {
      firmware: OPTS.firmware,
      actuators: Object.entries(actuators).map(([id, a]) => ({ id, state: a.state })),
    });
  } catch { /* the next reading cycle will buffer */ }
}

// ---------------------------------------------------------------------------
// CSV log
// ---------------------------------------------------------------------------
function csv(readings) {
  if (!OPTS.csv) return;
  const file = path.resolve(process.cwd(), String(OPTS.csv));
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'recorded_at,sm01,sm02,temperature,humidity,light,co2,tank,ph,pump,fan,buffered\n');
  const v = Object.fromEntries(readings.map((r) => [r.sensor_id, r.value]));
  fs.appendFileSync(file, [readings[0].recorded_at, v['SM-01'], v['SM-02'], v['TMP-01'], v['HUM-01'], v['LUX-01'], v['CO2-01'], v['WL-01'], v['PH-01'],
    actuators['ACT-PUMP-01'].state, actuators['ACT-FAN-01'].state, buffer.length].join(',') + '\n');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function report() {
  const avg = stats.delays.length ? stats.delays.reduce((s, d) => s + d, 0) / stats.delays.length : 0;
  const expected = stats.cycles * 8;
  const rate = expected ? (stats.accepted / expected) * 100 : 0;
  console.log('\n=== Delivery report (US06-T5) ===');
  console.log(`cycles: ${stats.cycles} · readings generated: ${expected} · accepted by the API: ${stats.accepted} · rejected: ${stats.rejected}`);
  console.log(`success rate: ${rate.toFixed(1)} % · average round-trip: ${avg.toFixed(0)} ms · max: ${Math.max(0, ...stats.delays)} ms`);
  console.log(`failed attempts: ${stats.failedAttempts} · readings that went through the buffer: ${stats.buffered} · dropped (buffer full): ${stats.dropped} · still buffered: ${buffer.length}`);
}

async function main() {
  console.log(`SmartGreenAI simulator · scenario "${OPTS.scenario}" · every ${OPTS.interval} s · speed x${OPTS.speed} · API ${OPTS.url}`);
  await heartbeat();
  let last = Date.now();

  const pollTimer = setInterval(() => { pollCommands(); }, OPTS.poll * 1000);
  const beatTimer = setInterval(() => { heartbeat(); }, 30000);
  const physicsTimer = setInterval(() => {
    const now = Date.now();
    step(((now - last) / 60000) * OPTS.speed);
    last = now;
  }, 1000);

  const stop = () => { clearInterval(pollTimer); clearInterval(beatTimer); clearInterval(physicsTimer); clearTimeout(cycleTimer); report(); process.exit(0); };
  process.on('SIGINT', stop);

  let cycleTimer = null;
  const runCycle = async () => {
    stats.cycles += 1;

    if (OPTS.scenario === 'disconnect' && stats.cycles > 3) {
      log('⚡ disconnect scenario: the device stopped transmitting (the platform should mark it OFFLINE after 5 minutes)');
      clearInterval(pollTimer); clearInterval(beatTimer);
      stats.cycles -= 1;
      return;
    }

    const readings = readSensors();
    csv(readings);
    await sendReadings(readings);

    if (stats.cycles === 1 && OPTS.offlineSeconds > 0) {
      networkDownUntil = Date.now() + OPTS.offlineSeconds * 1000;
      log(`⚡ simulated network outage for ${OPTS.offlineSeconds} s — readings will be buffered`);
    }

    if (OPTS.count && stats.cycles >= OPTS.count) {
      // Give the buffer a last chance to flush once the outage is over.
      const deadline = Date.now() + 15000;
      while (buffer.length && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        if (Date.now() >= networkDownUntil) { nextRetryAt = 0; await sendReadings([]); }
      }
      stop();
      return;
    }
    cycleTimer = setTimeout(runCycle, OPTS.interval * 1000);
  };
  runCycle();
}

main();
