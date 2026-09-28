'use strict';

// US-19 anomaly detection (each method, no duplicates) and US-18 analysis.

const { db, api, device, reading, insertHistory, reseed } = require('../helpers');
const anomalies = require('../../src/modules/anomalies/service');

beforeAll(reseed);
afterAll(() => db.close());

const methodsFor = async (sensorId) => (await db.rows('SELECT method FROM anomalies WHERE sensor_id = $1', [sensorId])).map((r) => r.method);

describe('US-19 anomaly detection', () => {
  beforeEach(async () => {
    await db.query('DELETE FROM anomalies');
    await db.query('DELETE FROM measurements');
  });

  test('OUT_OF_RANGE: outside the physical range of the sensor, flagged as untrustworthy', async () => {
    const res = await device().post('/measurements', reading('SM-02', 150));
    expect(res.body.anomalies.map((a) => a.method)).toEqual(['OUT_OF_RANGE']);
    const m = await db.one('SELECT is_anomaly FROM measurements WHERE id = $1', [res.body.id]);
    expect(m.is_anomaly).toBe(true);
  });

  test('SUDDEN_JUMP: temperature change above 5 °C between consecutive readings', async () => {
    await device().post('/measurements', reading('TMP-01', 20, 5));
    const res = await device().post('/measurements', reading('TMP-01', 27, 4));
    expect(res.body.anomalies.map((a) => a.method)).toContain('SUDDEN_JUMP');
    expect(res.body.alert).toBeNull(); // an impossible jump never raises a threshold alert
  });

  test('ZSCORE: statistical outlier over 24 h is recorded but the value stays usable', async () => {
    await insertHistory('TMP-01', Array.from({ length: 40 }, (_, i) => 20 + (i % 2 ? 0.2 : -0.2)), { endMinutesAgo: 10 });
    const res = await device().post('/measurements', reading('TMP-01', 24));
    expect(res.body.anomalies.map((a) => a.method)).toEqual(['ZSCORE']);
    const m = await db.one('SELECT is_anomaly FROM measurements WHERE id = $1', [res.body.id]);
    expect(m.is_anomaly).toBe(false);
    const a = await db.one("SELECT score, explanation FROM anomalies WHERE method = 'ZSCORE'");
    expect(Number(a.score)).toBeGreaterThan(3);
    expect(a.explanation).toMatch(/standard deviations/);
  });

  test('ZSCORE outlier outside the threshold still raises the threshold alert', async () => {
    await insertHistory('TMP-01', Array.from({ length: 40 }, (_, i) => 23 + (i % 2 ? 0.2 : -0.2)), { endMinutesAgo: 10 });
    const res = await device().post('/measurements', reading('TMP-01', 26));
    expect(res.body.anomalies.map((a) => a.method)).toContain('ZSCORE');
    expect(res.body.alert).toMatchObject({ type: 'HIGH' });
  });

  test('MISSING_DATA: no reading for more than 5 minutes', async () => {
    await insertHistory('HUM-01', [60], { endMinutesAgo: 12 });
    await anomalies.runPeriodicChecks();
    expect(await methodsFor('HUM-01')).toContain('MISSING_DATA');
  });

  test('FLATLINE: the same value for 30 minutes', async () => {
    await insertHistory('WL-01', [80, 80, 80, 80, 80, 80], { stepMinutes: 7 });
    await anomalies.runPeriodicChecks();
    expect(await methodsFor('WL-01')).toContain('FLATLINE');
  });

  test('no duplicates: repeated periodic checks record the condition once', async () => {
    await insertHistory('HUM-01', [60], { endMinutesAgo: 12 });
    await anomalies.runPeriodicChecks();
    await anomalies.runPeriodicChecks();
    const n = (await methodsFor('HUM-01')).filter((m) => m === 'MISSING_DATA').length;
    expect(n).toBe(1);
  });

  test('GET /anomalies filters by sensor and method', async () => {
    await device().post('/measurements', reading('SM-02', 150));
    const res = await api('producer').get('/anomalies?sensor_id=SM-02&method=OUT_OF_RANGE');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ sensor_id: 'SM-02', method: 'OUT_OF_RANGE' });
  });
});

describe('US-18 historical analysis', () => {
  beforeAll(async () => {
    await db.query('DELETE FROM measurements');
    await db.query('DELETE FROM anomalies');
    // Two full days of soil moisture: 70 then 50 (half the second day out of range)
    const dayAgo = (d, h) => new Date(Date.now() - (d * 24 + h) * 3600000);
    for (let h = 0; h < 24; h += 1) {
      await db.query("INSERT INTO measurements (sensor_id, value, unit, recorded_at) VALUES ('SM-01', 70, '%', $1)", [dayAgo(2, h)]);
      await db.query("INSERT INTO measurements (sensor_id, value, unit, recorded_at) VALUES ('SM-01', $1, '%', $2)", [h < 12 ? 50 : 70, dayAgo(1, h)]);
    }
    // an anomaly that must be excluded from the statistics
    await db.query("INSERT INTO measurements (sensor_id, value, unit, recorded_at, is_anomaly) VALUES ('SM-01', 5, '%', $1, TRUE)", [dayAgo(1, 3)]);
    await db.query("INSERT INTO actuator_events (actuator_id, action, source, duration_min, created_at) VALUES ('ACT-PUMP-01', 'ON', 'AUTOMATIC', 6, NOW() - INTERVAL '1 day')");
  });

  test('daily min / avg / max per variable, excluding anomalies', async () => {
    const res = await api('producer').get('/analysis/summary?area_id=AREA-1');
    expect(res.status).toBe(200);
    const days = res.body.daily.filter((d) => d.sensor_id === 'SM-01');
    expect(days.length).toBeGreaterThanOrEqual(2);
    for (const d of days) {
      expect(d.min_value).toBeGreaterThanOrEqual(50); // the 5 % anomaly is excluded
      expect(d.min_value).toBeLessThanOrEqual(d.avg_value);
      expect(d.avg_value).toBeLessThanOrEqual(d.max_value);
    }
    expect(res.body.anomalies_excluded).toBeGreaterThanOrEqual(1);
  });

  test('percentage of time inside the optimal range', async () => {
    const res = await api('producer').get('/analysis/summary?area_id=AREA-1');
    const soil = res.body.optimal_range.find((r) => r.sensor_type === 'soil_moisture');
    // 36 of 48 readings in 60-80 %
    expect(Number(soil.pct_time_in_optimal_range)).toBeCloseTo(75, 0);
  });

  test('irrigation minutes per day', async () => {
    const res = await api('producer').get('/analysis/summary?area_id=AREA-1');
    const total = res.body.irrigation_minutes_per_day.reduce((s, d) => s + Number(d.minutes), 0);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  test('trends 24h / 7d with direction and projection; invalid window -> 400', async () => {
    const res = await api('producer').get('/analysis/trends?area_id=AREA-1&window=7d');
    expect(res.status).toBe(200);
    expect(res.body.window).toBe('7d');
    const soil = res.body.trends.find((t) => t.sensor_type === 'soil_moisture');
    expect(['RISING', 'FALLING', 'STABLE', 'UNKNOWN']).toContain(soil.direction);
    const bad = await api('producer').get('/analysis/trends?area_id=AREA-1&window=1y');
    expect(bad.status).toBe(400);
  });

  test('area_id is required', async () => {
    const res = await api('producer').get('/analysis/summary');
    expect(res.status).toBe(400);
  });
});
