'use strict';

// US-14 actuator status, US-15 manual control (commands, polling, confirmation,
// expiry, mode), US-17 event log.

const { db, api, device, reseed } = require('../helpers');
const commands = require('../../src/modules/commands/service');

beforeAll(reseed);
afterAll(() => db.close());

async function resetActuation() {
  await db.query('DELETE FROM actuator_events');
  await db.query('DELETE FROM actuator_commands');
  await db.query("UPDATE actuators SET state = 'OFF', last_update = NOW()");
}

describe('US-14 actuator status', () => {
  test('never-updated actuators are shown OFFLINE; a recent report shows its state', async () => {
    await db.query("UPDATE actuators SET last_update = NULL WHERE id = 'ACT-SHADE-01'");
    await db.query("UPDATE actuators SET last_update = NOW(), state = 'ON' WHERE id = 'ACT-FAN-01'");
    const res = await api('producer').get('/actuators/status');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.actuators.map((a) => [a.id, a]));
    expect(byId['ACT-SHADE-01'].state).toBe('OFFLINE');
    expect(byId['ACT-FAN-01'].state).toBe('ON');
    expect(byId['ACT-FAN-01']).toHaveProperty('last_change');
  });

  test('no report for more than 5 minutes -> OFFLINE', async () => {
    await db.query("UPDATE actuators SET last_update = NOW() - INTERVAL '6 minutes' WHERE id = 'ACT-LIGHT-01'");
    const res = await api('producer').get('/actuators/status');
    expect(res.body.actuators.find((a) => a.id === 'ACT-LIGHT-01').state).toBe('OFFLINE');
  });
});

describe('US-15 manual control', () => {
  beforeEach(resetActuation);

  test('commands are refused while the area is in AUTOMATIC mode', async () => {
    await api('admin').patch('/areas/AREA-1/mode', { mode: 'AUTOMATIC' });
    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 3 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/AUTOMATIC/);
  });

  test('full cycle: ON -> device polls (SENT) -> device confirms (EXECUTED) -> event MANUAL', async () => {
    const mode = await api('producer').patch('/areas/AREA-1/mode', { mode: 'MANUAL' });
    expect(mode.status).toBe(200);

    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', source: 'MANUAL', requested_by: 'usr-producer' });

    const poll = await device().get('/devices/me/commands');
    expect(poll.status).toBe(200);
    expect(poll.body.commands.map((c) => c.id)).toContain(res.body.id);
    const sent = await db.one('SELECT status, sent_at FROM actuator_commands WHERE id = $1', [res.body.id]);
    expect(sent.status).toBe('SENT');

    const again = await device().get('/devices/me/commands');
    expect(again.body.count).toBe(0); // handed out only once

    const st = await device().post('/actuators/ACT-PUMP-01/state', { state: 'ON', duration_min: 3 });
    expect(st.status).toBe(200);
    expect(st.body.command_id).toBe(res.body.id);
    const done = await db.one('SELECT status, executed_at FROM actuator_commands WHERE id = $1', [res.body.id]);
    expect(done.status).toBe('EXECUTED');

    const ev = await api('producer').get('/actuators/events?actuator_id=ACT-PUMP-01');
    expect(ev.body[0]).toMatchObject({ action: 'ON', source: 'MANUAL', user_email: 'producer@smartgreen.ai' });
    expect(Number(ev.body[0].duration_min)).toBe(3);

    const status = await api('producer').get('/actuators/status');
    expect(status.body.actuators.find((a) => a.id === 'ACT-PUMP-01').state).toBe('ON');
  });

  test('a second command while one is in flight -> 409 ERR_CONFLICT', async () => {
    await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'OFF' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ERR_CONFLICT');
  });

  test.each([
    ['duration above the configured maximum (10 min)', { action: 'ON', duration_min: 30 }],
    ['non-positive duration', { action: 'ON', duration_min: 0 }],
    ['unknown action', { action: 'TOGGLE' }],
  ])('%s -> 400', async (_n, body) => {
    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', body);
    expect(res.status).toBe(400);
  });

  test('unknown actuator -> 404', async () => {
    const res = await api('producer').post('/actuators/ACT-NOPE/command', { action: 'OFF' });
    expect(res.status).toBe(404);
  });

  test('commands not collected within 60 s expire and are never delivered', async () => {
    const res = await api('producer').post('/actuators/ACT-FAN-01/command', { action: 'ON', duration_min: 5 });
    await db.query("UPDATE actuator_commands SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [res.body.id]);
    expect(await commands.expireStale()).toBe(1);
    const row = await db.one('SELECT status FROM actuator_commands WHERE id = $1', [res.body.id]);
    expect(row.status).toBe('EXPIRED');
    const poll = await device().get('/devices/me/commands');
    expect(poll.body.commands.map((c) => c.id)).not.toContain(res.body.id);
  });

  test('a device cannot report the state of an actuator of another device', async () => {
    await db.query("INSERT INTO devices (id, name, organization_id, greenhouse_id, area_id, api_key_hash) VALUES ('dev-y', 'Y', 'org-team3', 'GH-01', 'AREA-1', 'y') ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO actuators (id, device_id, area_id, name, type) VALUES ('ACT-Y', 'dev-y', 'AREA-1', 'Y pump', 'irrigation_pump') ON CONFLICT DO NOTHING");
    const res = await device().post('/actuators/ACT-Y/state', { state: 'ON' });
    expect(res.status).toBe(404);
  });
});

describe('US15-T8 command API: roles and authentication', () => {
  beforeEach(resetActuation);

  test('without a token -> 401 ERR_AUTH_REQUIRED', async () => {
    const res = await api(null).post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ERR_AUTH_REQUIRED');
  });

  test('a device API key cannot send a user command', async () => {
    const res = await device().post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    expect(res.status).toBe(401);
  });

  test('a role without actuators.command -> 403 ERR_INSUFFICIENT_PERMISSIONS', async () => {
    await db.query("DELETE FROM role_permissions WHERE role_id = 'role-producer' AND permission_id = 'perm-actuators-command'");
    try {
      const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_INSUFFICIENT_PERMISSIONS');
    } finally {
      await db.query("INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-producer', 'perm-actuators-command') ON CONFLICT DO NOTHING");
    }
  });

  test.each(['producer', 'admin', 'superadmin'])('%s can send a command in MANUAL mode', async (role) => {
    await api('admin').patch('/areas/AREA-1/mode', { mode: 'MANUAL' });
    const res = await api(role).post('/actuators/ACT-FAN-01/command', { action: 'ON', duration_min: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', source: 'MANUAL' });
  });

  test('polling and acknowledgement need a valid device key', async () => {
    expect((await api('producer').get('/devices/me/commands')).status).toBe(401);
    expect((await device('sec_wrong_key').get('/devices/me/commands')).status).toBe(401);
    expect((await api('producer').post('/actuators/ACT-PUMP-01/state', { state: 'ON' })).status).toBe(401);
  });
});

describe('US15-T8 command API: polling and acknowledgement', () => {
  beforeEach(async () => {
    await resetActuation();
    await api('admin').patch('/areas/AREA-1/mode', { mode: 'MANUAL' });
  });

  test('poll answers device_id, server_time, count and the commands with their expiry', async () => {
    const cmd = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    const poll = await device().get('/devices/me/commands');
    expect(poll.body).toMatchObject({ device_id: 'dev-node-01', count: 1 });
    expect(new Date(poll.body.server_time).getTime()).not.toBeNaN();
    expect(poll.body.commands[0]).toMatchObject({ id: cmd.body.id, actuator_id: 'ACT-PUMP-01', action: 'ON', source: 'MANUAL' });
    expect(new Date(poll.body.commands[0].expires_at) > new Date()).toBe(true);
  });

  test('OFF cycle: the confirmation closes the OFF command and records an OFF event', async () => {
    const cmd = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'OFF' });
    await device().get('/devices/me/commands');
    const st = await device().post('/actuators/ACT-PUMP-01/state', { state: 'OFF' });
    expect(st.body.command_id).toBe(cmd.body.id);
    const ev = await db.one('SELECT action, source, command_id FROM actuator_events ORDER BY created_at DESC LIMIT 1');
    expect(ev).toMatchObject({ action: 'OFF', source: 'MANUAL', command_id: cmd.body.id });
  });

  test('a state report without a pending command is recorded with source SYSTEM', async () => {
    const st = await device().post('/actuators/ACT-PUMP-01/state', { state: 'ON', duration_min: 1 });
    expect(st.status).toBe(200);
    expect(st.body.command_id ?? null).toBeNull();
    const ev = await db.one('SELECT action, source, command_id FROM actuator_events');
    expect(ev).toMatchObject({ action: 'ON', source: 'SYSTEM', command_id: null });
  });

  test('invalid state reports -> 400', async () => {
    expect((await device().post('/actuators/ACT-PUMP-01/state', { state: 'MAYBE' })).status).toBe(400);
    expect((await device().post('/actuators/ACT-PUMP-01/state', { state: 'ON', duration_min: -1 })).status).toBe(400);
  });
});

describe('US15-T8 command API: expiry (offline device)', () => {
  beforeEach(async () => {
    await resetActuation();
    await api('admin').patch('/areas/AREA-1/mode', { mode: 'MANUAL' });
  });

  test('a command gets expires_at = created_at + command.expiry_seconds (60 s)', async () => {
    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    const secs = (new Date(res.body.expires_at) - new Date(res.body.created_at)) / 1000;
    expect(secs).toBeCloseTo(60, 0);
  });

  test('the poll itself expires stale commands, and an expired command frees the actuator', async () => {
    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    await db.query("UPDATE actuator_commands SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [res.body.id]);
    expect(await commands.hasInFlight('ACT-PUMP-01')).toBe(false);
    const poll = await device().get('/devices/me/commands');
    expect(poll.body.count).toBe(0);
    expect((await db.one('SELECT status FROM actuator_commands WHERE id = $1', [res.body.id])).status).toBe('EXPIRED');
    const next = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    expect(next.status).toBe(201);
  });

  test('a SENT command the device never confirmed also expires', async () => {
    const res = await api('producer').post('/actuators/ACT-PUMP-01/command', { action: 'ON', duration_min: 2 });
    await device().get('/devices/me/commands');
    await db.query("UPDATE actuator_commands SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [res.body.id]);
    expect(await commands.expireStale()).toBe(1);
    const hist = await api('producer').get('/actuators/ACT-PUMP-01/commands');
    expect(hist.body.find((c) => c.id === res.body.id).status).toBe('EXPIRED');
  });
});
