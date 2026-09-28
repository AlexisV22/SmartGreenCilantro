'use strict';

// US-16 automatic irrigation (trigger, target, max duration, cooldown, low
// tank, stale sensor, manual mode ignored, no duplicate commands) and FR-18
// generic automation rules.

const { db, api, insertHistory, reseed } = require('../helpers');
const irrigation = require('../../src/modules/irrigation/service');
const automation = require('../../src/modules/automation/service');
const automationEngine = require('../../src/jobs/automationEngine');

beforeAll(reseed);
afterAll(() => db.close());

async function reset({ mode = 'AUTOMATIC' } = {}) {
  await db.query('DELETE FROM measurements');
  await db.query('DELETE FROM actuator_commands');
  await db.query('DELETE FROM actuator_events');
  await db.query('DELETE FROM alerts');
  await db.query("UPDATE actuators SET state = 'OFF', last_update = NOW()");
  await db.query('UPDATE areas SET mode = $1 WHERE id = $2', [mode, 'AREA-1']);
  await db.query("UPDATE irrigation_config SET enabled = TRUE, target_moisture = 65, max_duration_min = 10, cooldown_min = 30, consecutive_readings = 2, min_tank_level = 20 WHERE area_id = 'AREA-1'");
}

/** Two consecutive minutes of soil readings (both probes) + tank level. */
async function soil(values, { tank = 80, endMinutesAgo = 0 } = {}) {
  await insertHistory('SM-01', values, { stepMinutes: 1, endMinutesAgo });
  await insertHistory('SM-02', values.map((v) => v - 1), { stepMinutes: 1, endMinutesAgo });
  await insertHistory('WL-01', [tank], { endMinutesAgo });
}

const area = () => db.one("SELECT * FROM areas WHERE id = 'AREA-1'");

describe('US16-T2 start condition', () => {
  beforeEach(() => reset());

  test('N consecutive readings below the minimum -> ON with duration from the deficit', async () => {
    await soil([56, 55]);
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('ON');
    // average of the newest bucket: (55 + 54) / 2 = 54.5 -> (65 - 54.5) * 0.5 = 5.25 -> 5.3 min
    expect(d.duration_min).toBeCloseTo(5.3, 1);
    expect(d.reason).toMatch(/below the minimum of 60/);

    const applied = await irrigation.apply(await area(), d);
    expect(applied.command).toMatchObject({ action: 'ON', source: 'AUTOMATIC', status: 'PENDING' });
  });

  test('a single low reading is not enough (noise protection)', async () => {
    await soil([66, 55]);
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('SKIP');
    expect(d.reason).toMatch(/consecutive readings/);
  });

  test('never a second command while one is PENDING/SENT', async () => {
    await soil([56, 55]);
    await irrigation.apply(await area(), await irrigation.decide(await area()));
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('SKIP');
    expect(d.reason).toMatch(/already pending/);
  });

  test('duration is capped by max_duration_min', async () => {
    await soil([35, 30]);
    const d = await irrigation.decide(await area());
    expect(d.duration_min).toBe(10);
  });
});

describe('US16-T3 stop conditions', () => {
  beforeEach(() => reset());

  test('pump ON and target moisture reached -> OFF', async () => {
    await db.query("UPDATE actuators SET state = 'ON' WHERE id = 'ACT-PUMP-01'");
    await db.query("INSERT INTO actuator_events (actuator_id, action, source, created_at) VALUES ('ACT-PUMP-01', 'ON', 'AUTOMATIC', NOW() - INTERVAL '3 minutes')");
    await soil([64, 67]);
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('OFF');
    expect(d.reason).toMatch(/reached the target/);
  });

  test('pump ON beyond the maximum duration -> OFF', async () => {
    await db.query("UPDATE actuators SET state = 'ON' WHERE id = 'ACT-PUMP-01'");
    await db.query("INSERT INTO actuator_events (actuator_id, action, source, created_at) VALUES ('ACT-PUMP-01', 'ON', 'AUTOMATIC', NOW() - INTERVAL '11 minutes')");
    await soil([55, 56]);
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('OFF');
    expect(d.reason).toMatch(/maximum irrigation duration/);
  });
});

describe('US16-T4 safety rules', () => {
  beforeEach(() => reset());

  test('cooldown: no irrigation 30 minutes after the previous one', async () => {
    await db.query("INSERT INTO actuator_events (actuator_id, action, source, created_at) VALUES ('ACT-PUMP-01', 'ON', 'AUTOMATIC', NOW() - INTERVAL '10 minutes')");
    await soil([56, 55]);
    const d = await irrigation.decide(await area());
    expect(d).toMatchObject({ action: 'SKIP', blocked: true, safety: 'COOLDOWN' });
  });

  test('water tank below the minimum -> blocked + LOW_WATER alert', async () => {
    await soil([56, 55], { tank: 12 });
    const d = await irrigation.decide(await area());
    expect(d).toMatchObject({ action: 'BLOCK_LOW_WATER', safety: 'LOW_WATER' });
    await irrigation.apply(await area(), d);
    const alert = await db.one("SELECT * FROM alerts WHERE type = 'LOW_WATER'");
    expect(alert.severity).toBe('HIGH');
    const cmds = await db.one('SELECT COUNT(*)::int AS n FROM actuator_commands');
    expect(cmds.n).toBe(0);
  });

  test('soil sensors silent for more than 5 minutes -> blocked (stale data)', async () => {
    await soil([56, 55], { endMinutesAgo: 8 });
    const d = await irrigation.decide(await area());
    expect(d).toMatchObject({ action: 'SKIP', safety: 'STALE_SENSOR' });
  });

  test('anomalous readings are ignored by the engine', async () => {
    await soil([66, 67]);
    await db.query("INSERT INTO measurements (sensor_id, value, unit, recorded_at, is_anomaly) VALUES ('SM-01', 5, '%', NOW(), TRUE), ('SM-02', 5, '%', NOW(), TRUE)");
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('SKIP');
  });
});

describe('US16-T1 mode', () => {
  test('MANUAL mode disables the engine', async () => {
    await reset({ mode: 'MANUAL' });
    await soil([50, 49]);
    const d = await irrigation.decide(await area());
    expect(d.action).toBe('SKIP');
    expect(d.reason).toMatch(/MANUAL/);
  });

  test('irrigation disabled in the configuration -> SKIP', async () => {
    await reset();
    await db.query("UPDATE irrigation_config SET enabled = FALSE WHERE area_id = 'AREA-1'");
    await soil([50, 49]);
    expect((await irrigation.decide(await area())).action).toBe('SKIP');
  });

  test('the scheduled engine applies the decision end to end', async () => {
    await reset();
    await soil([56, 55]);
    await automationEngine.run();
    const cmd = await db.one("SELECT * FROM actuator_commands WHERE actuator_id = 'ACT-PUMP-01'");
    expect(cmd).toMatchObject({ action: 'ON', source: 'AUTOMATIC' });
  });
});

describe('irrigation configuration (admin)', () => {
  test('GET/PUT /irrigation/config/:areaId validates and stores the parameters', async () => {
    const ok = await api('admin').put('/irrigation/config/AREA-1', { target_moisture: 68, max_duration_min: 12 });
    expect(ok.status).toBe(200);
    expect(ok.body.target_moisture).toBe(68);
    const bad = await api('admin').put('/irrigation/config/AREA-1', { target_moisture: 150 });
    expect(bad.status).toBe(400);
    const get = await api('producer').get('/irrigation/config/AREA-1');
    expect(get.body.max_duration_min).toBe(12);
  });
});

describe('FR-18 generic automation rules', () => {
  beforeEach(() => reset());

  test('temperature above the maximum turns the fan ON (AUTOMATIC mode only)', async () => {
    await insertHistory('TMP-01', [27, 28], { stepMinutes: 1 });
    const out = await automation.evaluateArea(await area());
    expect(out.length).toBeGreaterThan(0);
    const cmd = await db.one("SELECT * FROM actuator_commands WHERE actuator_id = 'ACT-FAN-01'");
    expect(cmd).toMatchObject({ action: 'ON', source: 'AUTOMATIC' });
  });

  test('daytime windows use the greenhouse time zone, not UTC', () => {
    // 18:00 UTC is 12:00 in Mexico City (UTC-6, no DST since 2022)
    const at = new Date(Date.UTC(2026, 9, 1, 18, 0));
    expect(automation.localHour('America/Mexico_City', at)).toBe(12);
    expect(automation.localHour('UTC', at)).toBe(18);
  });

  test('rules are listed and editable by the administrator', async () => {
    const list = await api('admin').get('/automation-rules');
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(3);
    const rule = list.body[0];
    const upd = await api('admin').put(`/automation-rules/${rule.id}`, { enabled: false });
    expect(upd.status).toBe(200);
    expect(upd.body.enabled).toBe(false);
  });
});
