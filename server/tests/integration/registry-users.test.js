'use strict';

// US-25 IoT registry (API key shown once, hashed, rotation, deactivation),
// US-22/23/24 users, administrators and roles, FR-21 logs, settings, stats.

const crypto = require('crypto');
const { app, db, request, api, device, reading, reseed } = require('../helpers');

beforeAll(reseed);
afterAll(() => db.close());

describe('US-25 devices', () => {
  let created;

  test('registering a device returns the plain API key only once', async () => {
    const res = await api('admin').post('/devices', { id: 'dev-node-02', name: 'Node 2', mac_address: 'A4:CF:12:00:00:02', greenhouse_id: 'GH-01', area_id: 'AREA-1' });
    expect(res.status).toBe(201);
    created = res.body;
    expect(created.api_key).toMatch(/.{24,}/);
    const row = await db.one("SELECT api_key_hash FROM devices WHERE id = 'dev-node-02'");
    expect(row.api_key_hash).toBe(crypto.createHash('sha256').update(created.api_key).digest('hex'));
    const again = await api('admin').get('/devices/dev-node-02');
    expect(JSON.stringify(again.body)).not.toContain(created.api_key);
    expect(again.body.api_key_hash).toBeUndefined();
  });

  test('the new key authenticates the device', async () => {
    const res = await device(created.api_key).post('/devices/heartbeat', { firmware: 'x' });
    expect(res.status).toBe(200);
  });

  test('invalid MAC or duplicate id -> 400 / 409', async () => {
    expect((await api('admin').post('/devices', { name: 'Bad', mac_address: 'zz' })).status).toBe(400);
    expect((await api('admin').post('/devices', { id: 'dev-node-02', name: 'Dup' })).status).toBe(409);
  });

  test('rotating the key revokes the previous one', async () => {
    const res = await api('admin').post('/devices/dev-node-02/rotate-key');
    expect(res.status).toBe(200);
    expect((await device(created.api_key).post('/devices/heartbeat', {})).status).toBe(401);
    expect((await device(res.body.api_key).post('/devices/heartbeat', {})).status).toBe(200);
    created.api_key = res.body.api_key;
  });

  test('devices are deactivated, never deleted', async () => {
    const res = await api('admin').put('/devices/dev-node-02', { is_active: false });
    expect(res.status).toBe(200);
    expect((await device(created.api_key).post('/devices/heartbeat', {})).status).toBe(401);
    const del = await api('superadmin').delete('/devices/dev-node-02');
    expect(del.status).toBe(404);
    expect(await db.one("SELECT id FROM devices WHERE id = 'dev-node-02'")).not.toBeNull();
  });

  test('sensors: physical range validated, duplicate id 409, readings accepted once registered', async () => {
    const bad = await api('admin').post('/sensors', { id: 'SM-03', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Soil 3', type: 'soil_moisture', unit: '%', physical_min: 100, physical_max: 0 });
    expect(bad.status).toBe(400);
    const ok = await api('admin').post('/sensors', { id: 'SM-03', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Soil 3', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 });
    expect(ok.status).toBe(201);
    expect((await api('admin').post('/sensors', { id: 'SM-03', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Duplicate', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 })).status).toBe(409);
    expect((await device().post('/measurements', reading('SM-03', 66))).status).toBe(201);
  });

  test('actuators can be registered and deactivated', async () => {
    const ok = await api('admin').post('/actuators', { id: 'ACT-FAN-02', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Fan 2', type: 'ventilation_fan' });
    expect(ok.status).toBe(201);
    const off = await api('admin').put('/actuators/ACT-FAN-02', { is_active: false });
    expect(off.body.is_active).toBe(false);
  });
});

describe('US-22 users (FR-04)', () => {
  test('the administrator creates a producer; the password policy is enforced', async () => {
    const weak = await api('admin').post('/users', { email: 'p2@smartgreen.ai', username: 'producer2', password: 'short', role: 'Producer' });
    expect(weak.status).toBe(400);
    const ok = await api('admin').post('/users', { email: 'p2@smartgreen.ai', username: 'producer2', full_name: 'Second Producer', password: 'Cilantro#2026', role: 'Producer' });
    expect(ok.status).toBe(201);
    expect(ok.body.password_hash).toBeUndefined();
    const login = await request(app).post('/api/auth/login').send({ email: 'p2@smartgreen.ai', password: 'Cilantro#2026' });
    expect(login.status).toBe(200);
  });

  test('duplicate email -> 409', async () => {
    const res = await api('admin').post('/users', { email: 'p2@smartgreen.ai', username: 'producer3', password: 'Cilantro#2026', role: 'Producer' });
    expect(res.status).toBe(409);
  });

  test('deactivating a user blocks the login; reactivating restores it', async () => {
    const u = await db.one("SELECT id FROM users WHERE email = 'p2@smartgreen.ai'");
    expect((await api('admin').patch(`/users/${u.id}/status`, { is_active: false })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'p2@smartgreen.ai', password: 'Cilantro#2026' })).status).toBe(401);
    await api('admin').patch(`/users/${u.id}/status`, { is_active: true });
    expect((await request(app).post('/api/auth/login').send({ email: 'p2@smartgreen.ai', password: 'Cilantro#2026' })).status).toBe(200);
  });
});

describe('US-23 administrators and US-24 roles (Super Administrator)', () => {
  test('the super administrator creates an administrator', async () => {
    const res = await api('superadmin').post('/admins', { email: 'admin2@smartgreen.ai', username: 'admin2', password: 'Cilantro#2026', role: 'Administrator' });
    expect(res.status).toBe(201);
    const list = await api('superadmin').get('/admins');
    expect(list.body.map((u) => u.email)).toContain('admin2@smartgreen.ai');
  });

  test('role permissions are editable and take effect on the next request', async () => {
    const before = await api('producer').get('/stats');
    expect(before.status).toBe(403);
    const role = (await api('superadmin').get('/roles')).body.find((r) => r.name === 'Producer');
    const res = await api('superadmin').put(`/roles/${role.id}/permissions`, { permissions: [...role.permissions, 'stats.read'] });
    expect(res.status).toBe(200);
    expect((await api('producer').get('/stats')).status).toBe(200);
    await api('superadmin').put(`/roles/${role.id}/permissions`, { permissions: role.permissions });
    expect((await api('producer').get('/stats')).status).toBe(403);
  });

  test('unknown permission codes are rejected', async () => {
    const role = (await api('superadmin').get('/roles')).body.find((r) => r.name === 'Producer');
    const res = await api('superadmin').put(`/roles/${role.id}/permissions`, { permissions: ['do.anything'] });
    expect(res.status).toBe(400);
  });
});

describe('FR-21 logs, settings and statistics', () => {
  test('audit log records user writes with before/after', async () => {
    await new Promise((r) => setTimeout(r, 300));
    const res = await api('admin').get('/logs/audit?entity=users');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('after_data');
  });

  test('system log is filterable by level', async () => {
    const res = await api('superadmin').get('/logs/system?level=WARN');
    expect(res.status).toBe(200);
    expect(res.body.every((r) => r.level === 'WARN')).toBe(true);
  });

  test('global parameters: unknown keys rejected, known keys stored', async () => {
    expect((await api('superadmin').put('/settings/global', { parameters: { 'no.such': 1 } })).status).toBe(400);
    const ok = await api('superadmin').put('/settings/global', { parameters: { 'severity.low_max_pct': 12 } });
    expect(ok.status).toBe(200);
    expect(ok.body.find((p) => p.key === 'severity.low_max_pct').value).toBe('12');
    await api('superadmin').put('/settings/global', { parameters: { 'severity.low_max_pct': 10 } });
  });

  test('security settings validate their ranges', async () => {
    expect((await api('superadmin').put('/settings/security', { session_hours: 500 })).status).toBe(400);
    expect((await api('superadmin').put('/settings/security', { session_hours: 8 })).status).toBe(200);
  });

  test('statistics expose counts, measurements per day and uptime', async () => {
    const res = await api('admin').get('/stats');
    expect(res.status).toBe(200);
    expect(res.body.counts).toHaveProperty('measurements');
    expect(Array.isArray(res.body.measurements_per_day)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  test('observations: the producer records crop notes per area', async () => {
    const bad = await api('producer').post('/observations', { area_id: 'AREA-1', note: 'x' });
    expect(bad.status).toBe(400);
    const ok = await api('producer').post('/observations', { area_id: 'AREA-1', note: 'Yellow leaves on the north bed.' });
    expect(ok.status).toBe(201);
    const list = await api('producer').get('/observations?area_id=AREA-1');
    expect(list.body[0].note).toMatch(/Yellow leaves/);
  });
});
