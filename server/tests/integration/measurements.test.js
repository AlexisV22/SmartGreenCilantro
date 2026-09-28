'use strict';

// US-06 / US-07 / US-08 — IoT ingestion with the device API key, validation,
// batch (buffered) readings, storage with sensor IDs and timestamps, history.

const { db, api, device, reading, reseed, DEVICE_KEY } = require('../helpers');

beforeAll(reseed);
afterAll(() => db.close());

describe('POST /api/measurements (device apikey)', () => {
  test('a valid reading -> 201 processed and stored with recorded_at and received_at', async () => {
    const r = reading('SM-01', 67.4, 1);
    const res = await device().post('/measurements', r);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('processed');
    expect(res.body.id).toMatch(/^msr-/);
    const row = await db.one('SELECT * FROM measurements WHERE id = $1', [res.body.id]);
    expect(row.sensor_id).toBe('SM-01');
    expect(Number(row.value)).toBe(67.4);
    expect(new Date(row.recorded_at).toISOString()).toBe(r.recorded_at);
    expect(new Date(row.received_at).getTime()).toBeGreaterThanOrEqual(new Date(r.recorded_at).getTime());
  });

  test('the device last_seen is refreshed (FR-11)', async () => {
    await device().post('/measurements', reading('TMP-01', 21.5));
    const d = await db.one("SELECT last_seen FROM devices WHERE id = 'dev-node-01'");
    expect(Date.now() - new Date(d.last_seen).getTime()).toBeLessThan(10000);
  });

  test('the API key is stored only as a SHA-256 hash', async () => {
    const d = await db.one("SELECT api_key_hash FROM devices WHERE id = 'dev-node-01'");
    expect(d.api_key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(d.api_key_hash).not.toContain(DEVICE_KEY);
  });

  test('missing or wrong API key -> 401', async () => {
    const none = await api(null).post('/measurements', reading('SM-01', 60));
    const wrong = await device('sec_wrong_key').post('/measurements', reading('SM-01', 60));
    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  test('API spec 2.2: an authenticated user may also submit a manual reading', async () => {
    const res = await api('admin').post('/measurements', reading('SM-01', 66));
    expect(res.status).toBe(201);
  });

  test.each([
    ['unknown sensor', { ...reading('SM-99', 50) }, 'sensor_id'],
    ['non-numeric value', { ...reading('SM-01', 50), value: 'wet' }, 'value'],
    ['invalid timestamp', { ...reading('SM-01', 50), recorded_at: '28/09/2026 10:00' }, 'recorded_at'],
    ['missing sensor id', { value: 50, unit: '%' }, 'sensor_id'],
  ])('%s -> 400 ERR_VALIDATION_FAILED', async (_name, body, field) => {
    const res = await device().post('/measurements', body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION_FAILED');
    expect(res.body.details.map((d) => d.field)).toContain(field);
  });

  test('a sensor of another device is rejected', async () => {
    await db.query("INSERT INTO devices (id, name, organization_id, greenhouse_id, area_id, api_key_hash) VALUES ('dev-x', 'X', 'org-team3', 'GH-01', 'AREA-1', 'x')");
    await db.query("INSERT INTO sensors (id, device_id, area_id, name, type, unit, physical_min, physical_max) VALUES ('SM-X', 'dev-x', 'AREA-1', 'x', 'soil_moisture', '%', 0, 100)");
    const res = await device().post('/measurements', reading('SM-X', 60));
    expect(res.status).toBe(400);
  });

  test('an inactive sensor is rejected', async () => {
    await db.query("UPDATE sensors SET is_active = FALSE WHERE id = 'PH-01'");
    const res = await device().post('/measurements', reading('PH-01', 6.5));
    expect(res.status).toBe(400);
    await db.query("UPDATE sensors SET is_active = TRUE WHERE id = 'PH-01'");
  });

  test('an inactive device -> 401', async () => {
    await db.query("UPDATE devices SET is_active = FALSE WHERE id = 'dev-node-01'");
    const res = await device().post('/measurements', reading('SM-01', 60));
    expect(res.status).toBe(401);
    await db.query("UPDATE devices SET is_active = TRUE WHERE id = 'dev-node-01'");
  });
});

describe('US06-T4 batch of buffered readings', () => {
  test('an array is processed row by row; one bad row does not discard the batch', async () => {
    const batch = [reading('SM-01', 66, 10), reading('SM-02', 65, 10), reading('SM-99', 1, 10), reading('TMP-01', 22, 10)];
    const res = await device().post('/measurements', batch);
    expect(res.status).toBe(201);
    expect(res.body.received).toBe(4);
    expect(res.body.accepted).toBe(3);
    expect(res.body.rejected).toBe(1);
    expect(res.body.errors[0].sensor_id).toBe('SM-99');
    expect(res.body.results[0]).toHaveProperty('alert');
  });

  test('an empty batch -> 400', async () => {
    const res = await device().post('/measurements', []);
    expect(res.status).toBe(400);
  });
});

describe('US07 / US08 history and latest values', () => {
  test('GET /sensors/:id/measurements filters by from/to and limit, newest first', async () => {
    const from = new Date(Date.now() - 30 * 60000).toISOString();
    const res = await api('producer').get(`/sensors/SM-01/measurements?from=${encodeURIComponent(from)}&limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.sensor_id).toBe('SM-01');
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    const times = res.body.data.map((d) => new Date(d.recorded_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test('unknown sensor history -> 404', async () => {
    const res = await api('producer').get('/sensors/NOPE/measurements');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ERR_RESOURCE_NOT_FOUND');
  });

  test('GET /measurements/latest returns one row per sensor with its threshold', async () => {
    const res = await api('producer').get('/measurements/latest');
    expect(res.status).toBe(200);
    const sm = res.body.find((r) => r.sensor_id === 'SM-01');
    expect(sm.threshold_min).toBe(60);
    expect(sm.threshold_max).toBe(80);
    expect(new Set(res.body.map((r) => r.sensor_id)).size).toBe(res.body.length);
  });

  test('heartbeat refreshes the device and the reported actuator states', async () => {
    const res = await device().post('/devices/heartbeat', { firmware: 'test-fw', actuators: [{ id: 'ACT-FAN-01', state: 'OFF' }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ONLINE');
    expect(res.body.actuators_refreshed).toBe(1);
    const fan = await db.one("SELECT last_update FROM actuators WHERE id = 'ACT-FAN-01'");
    expect(Date.now() - new Date(fan.last_update).getTime()).toBeLessThan(10000);
  });
});
