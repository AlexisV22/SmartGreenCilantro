'use strict';

// US-10 thresholds, US-11 alert engine, US-12 severity, US-13 alert history.

const { db, api, device, reading, reseed } = require('../helpers');

beforeAll(reseed);
afterAll(() => db.close());

describe('US-10 thresholds', () => {
  test('GET /thresholds lists one row per variable of the area', async () => {
    const res = await api('producer').get('/thresholds?area_id=AREA-1');
    expect(res.status).toBe(200);
    const types = res.body.map((t) => t.sensor_type);
    expect(new Set(types)).toEqual(new Set(['temperature', 'air_humidity', 'soil_moisture', 'light', 'co2', 'water_level', 'ph']));
    const soil = res.body.find((t) => t.sensor_type === 'soil_moisture');
    expect([soil.min_value, soil.max_value]).toEqual([60, 80]);
  });

  test('admin updates a threshold; updated_by and updated_at are stored and audited', async () => {
    const res = await api('admin').put('/thresholds/th-a1-soil-moisture', { min_value: 58, max_value: 78 });
    expect(res.status).toBe(200);
    expect(res.body.min_value).toBe(58);
    const row = await db.one("SELECT updated_by, updated_at FROM thresholds WHERE id = 'th-a1-soil-moisture'");
    expect(row.updated_by).toBe('usr-admin');
    await new Promise((r) => setTimeout(r, 300));
    const audit = await db.one("SELECT before_data, after_data FROM audit_logs WHERE entity = 'thresholds' ORDER BY created_at DESC LIMIT 1");
    expect(audit.before_data.min_value).toBe(60);
    await api('admin').put('/thresholds/th-a1-soil-moisture', { min_value: 60, max_value: 80 });
  });

  test.each([
    ['min greater than max', { min_value: 80, max_value: 60 }],
    ['min equal to max', { min_value: 70, max_value: 70 }],
    ['below the physical range of the sensor', { min_value: -5, max_value: 80 }],
    ['above the physical range of the sensor', { min_value: 60, max_value: 120 }],
  ])('%s -> 400 with details', async (_n, body) => {
    const res = await api('admin').put('/thresholds/th-a1-soil-moisture', body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION_FAILED');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  test('non-numeric values -> 400', async () => {
    const res = await api('admin').put('/thresholds/th-a1-soil-moisture', { min_value: 'low' });
    expect(res.status).toBe(400);
  });

  test('unknown threshold -> 404', async () => {
    const res = await api('admin').put('/thresholds/nope', { min_value: 1, max_value: 2 });
    expect(res.status).toBe(404);
  });
});

describe('US-11 / US-12 alert engine', () => {
  let alertId;

  test('a reading below the minimum creates a LOW alert with LOW severity (10 %)', async () => {
    const res = await device().post('/measurements', reading('SM-01', 58, 3));
    expect(res.body.alert).toMatchObject({ type: 'LOW', severity: 'LOW', created: true });
    alertId = res.body.alert.id;
    const a = await db.one('SELECT * FROM alerts WHERE id = $1', [alertId]);
    expect(a.status).toBe('OPEN');
    expect(Number(a.deviation_pct)).toBeCloseTo(10);
    expect(a.message).toMatch(/below the configured minimum of 60/);
  });

  test('repeated out-of-range readings do not duplicate the alert; the severity is upgraded', async () => {
    const res = await device().post('/measurements', reading('SM-01', 56.5, 2));
    expect(res.body.alert.id).toBe(alertId);
    expect(res.body.alert.created).toBe(false);
    expect(res.body.alert.severity).toBe('MEDIUM');
    const count = await db.one("SELECT COUNT(*)::int AS n FROM alerts WHERE sensor_id = 'SM-01' AND status <> 'RESOLVED'");
    expect(count.n).toBe(1);
  });

  test('a HIGH temperature alert above the maximum', async () => {
    const res = await device().post('/measurements', reading('TMP-01', 28, 1));
    expect(res.body.alert).toMatchObject({ type: 'HIGH', severity: 'HIGH' });
  });

  test('the value returning to range resolves the alert with resolved_at', async () => {
    await device().post('/measurements', reading('SM-01', 66, 1));
    const a = await db.one('SELECT status, resolved_at FROM alerts WHERE id = $1', [alertId]);
    expect(a.status).toBe('RESOLVED');
    expect(a.resolved_at).not.toBeNull();
  });

  test('a reading outside the physical range raises an anomaly, not a threshold alert', async () => {
    const res = await device().post('/measurements', reading('SM-02', 150, 0));
    expect(res.body.alert).toBeNull();
    expect(res.body.anomalies.map((a) => a.method)).toContain('OUT_OF_RANGE');
  });
});

describe('US-13 alert history', () => {
  test('acknowledge an open alert records who and when; a later ack keeps the first acknowledger', async () => {
    const open = await api('producer').get('/alerts?status=OPEN');
    const alert = open.body.data[0];
    const res = await api('producer').patch(`/alerts/${alert.id}/ack`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACKNOWLEDGED');
    const row = await db.one('SELECT acknowledged_by, acknowledged_at FROM alerts WHERE id = $1', [alert.id]);
    expect(row.acknowledged_by).toBe('usr-producer');
    const again = await api('admin').patch(`/alerts/${alert.id}/ack`);
    expect(again.status).toBe(200);
    expect(again.body.acknowledged_by).toBe('usr-producer');
  });

  test('filters by status, severity, sensor and date with pagination metadata', async () => {
    const res = await api('producer').get('/alerts?sensor_id=SM-01&status=RESOLVED&limit=5&offset=0');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 5, offset: 0 });
    expect(res.body.data.every((a) => a.sensor_id === 'SM-01' && a.status === 'RESOLVED')).toBe(true);
    const future = await api('producer').get(`/alerts?from=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
    expect(future.body.total).toBe(0);
    const bad = await api('producer').get('/alerts?severity=CRITICAL');
    expect(bad.status).toBe(400);
  });

  test('CSV export with the same filters', async () => {
    const res = await api('producer').get('/alerts/export.csv?sensor_id=SM-01');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toMatch(/severity/i);
    expect(lines.length).toBeGreaterThan(1);
  });
});
