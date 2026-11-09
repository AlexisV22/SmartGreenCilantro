'use strict';

// US11-T6 — unit tests of the alert evaluation logic (evaluateMeasurement):
// LOW and HIGH creation, de-duplication, automatic resolution and boundary
// values equal to the minimum and maximum. The database is replaced by an
// in-memory fake, so no PostgreSQL and no device are needed.

jest.mock('../../src/db', () => require('./fakes/alertsDb').createAlertsDb());
jest.mock('../../src/utils/settings', () => ({
  getNumber: jest.fn(async (_key, fallback) => fallback),
  getString: jest.fn(async (_key, fallback) => fallback),
}));
jest.mock('../../src/utils/daylight', () => ({ isDaylight: jest.fn(async () => true) }));
jest.mock('../../src/utils/logger', () => ({ logSystem: jest.fn() }));

const db = require('../../src/db');
const daylight = require('../../src/utils/daylight');
const { logSystem } = require('../../src/utils/logger');
const { evaluateMeasurement } = require('../../src/modules/alerts/service');

const SOIL = { id: 'SM-01', area_id: 'AREA-1', type: 'soil_moisture' }; // 60-80 %
const TEMP = { id: 'TMP-01', area_id: 'AREA-1', type: 'temperature' }; // 15-25 C
const LIGHT = { id: 'LUX-01', area_id: 'AREA-1', type: 'light' }; // 10 000-40 000 lux

const reading = (value) => ({ id: `m-${Math.random()}`, value, recorded_at: new Date().toISOString() });
const evaluate = (sensor, value) => evaluateMeasurement(sensor, reading(value));
const openAlerts = (sensorId) => db.state.alerts.filter((a) => a.sensor_id === sensorId && a.status !== 'RESOLVED');

beforeEach(() => {
  db.reset();
  daylight.isDaylight.mockResolvedValue(true);
  logSystem.mockClear();
});

describe('US11-T6 alert creation', () => {
  test('a value below the minimum creates an OPEN LOW alert', async () => {
    const r = await evaluate(SOIL, 57);
    expect(r.created).toBe(true);
    expect(r.alert).toMatchObject({ sensor_id: 'SM-01', type: 'LOW', status: 'OPEN', threshold_id: 'thr-sm', value: 57 });
    expect(r.alert.message).toMatch(/below the configured minimum of 60/);
  });

  test('a value above the maximum creates an OPEN HIGH alert', async () => {
    const r = await evaluate(TEMP, 26.2);
    expect(r.created).toBe(true);
    expect(r.alert).toMatchObject({ sensor_id: 'TMP-01', type: 'HIGH', status: 'OPEN' });
    expect(r.alert.message).toMatch(/above the configured maximum of 25/);
  });

  test('a value inside the range creates no alert', async () => {
    const r = await evaluate(SOIL, 70);
    expect(r).toMatchObject({ created: false, alert: null });
    expect(db.state.alerts).toHaveLength(0);
  });

  test('every new alert is written to the system log', async () => {
    await evaluate(SOIL, 55);
    expect(logSystem).toHaveBeenCalledWith('WARN', 'alerts', expect.stringContaining('LOW alert on SM-01'), expect.any(Object));
  });

  test('a sensor without a configured threshold is never evaluated', async () => {
    delete db.state.thresholds.soil_moisture;
    const r = await evaluate(SOIL, 10);
    expect(r).toEqual({ created: false, resolved: false, alert: null });
  });
});

describe('US11-T6 boundary values (equal to min and max)', () => {
  test.each([
    ['exactly the minimum (60 %)', SOIL, 60],
    ['exactly the maximum (80 %)', SOIL, 80],
    ['exactly the minimum (15 C)', TEMP, 15],
    ['exactly the maximum (25 C)', TEMP, 25],
  ])('%s is inside the range: no alert', async (_name, sensor, value) => {
    const r = await evaluate(sensor, value);
    expect(r.created).toBe(false);
    expect(db.state.alerts).toHaveLength(0);
  });

  test.each([
    ['just below the minimum', SOIL, 59.99, 'LOW'],
    ['just above the maximum', SOIL, 80.01, 'HIGH'],
    ['just below the minimum', TEMP, 14.99, 'LOW'],
    ['just above the maximum', TEMP, 25.01, 'HIGH'],
  ])('%s of %s raises a %s alert', async (_name, sensor, value, type) => {
    const r = await evaluate(sensor, value);
    expect(r.created).toBe(true);
    expect(r.alert.type).toBe(type);
  });
});

describe('US11-T6 de-duplication', () => {
  test('repeated out-of-range readings keep one alert and refresh its value', async () => {
    const first = await evaluate(SOIL, 58);
    const second = await evaluate(SOIL, 57.5);
    const third = await evaluate(SOIL, 57.1);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(third.alert.id).toBe(first.alert.id);
    expect(third.alert.value).toBe(57.1);
    expect(openAlerts('SM-01')).toHaveLength(1);
  });

  test('an ACKNOWLEDGED alert also blocks a duplicate', async () => {
    const first = await evaluate(SOIL, 58);
    db.state.alerts[0].status = 'ACKNOWLEDGED';
    const again = await evaluate(SOIL, 57);
    expect(again.created).toBe(false);
    expect(again.alert.id).toBe(first.alert.id);
    expect(db.state.alerts).toHaveLength(1);
  });

  test('different sensors get their own alert', async () => {
    await evaluate(SOIL, 58);
    await evaluate({ ...SOIL, id: 'SM-02' }, 58);
    expect(db.state.alerts.map((a) => a.sensor_id).sort()).toEqual(['SM-01', 'SM-02']);
  });
});

describe('US11-T6 automatic resolution', () => {
  test('returning inside the range resolves the open alert with resolved_at', async () => {
    const first = await evaluate(SOIL, 57);
    const back = await evaluate(SOIL, 66);
    expect(back.resolved).toBe(true);
    const stored = db.state.alerts.find((a) => a.id === first.alert.id);
    expect(stored.status).toBe('RESOLVED');
    expect(stored.resolved_at).toBeInstanceOf(Date);
  });

  test('returning exactly to the minimum also resolves it', async () => {
    await evaluate(SOIL, 57);
    const back = await evaluate(SOIL, 60);
    expect(back.resolved).toBe(true);
    expect(openAlerts('SM-01')).toHaveLength(0);
  });

  test('an in-range reading with nothing open resolves nothing', async () => {
    const r = await evaluate(SOIL, 66);
    expect(r.resolved).toBe(false);
  });

  test('after resolution a new excursion creates a new alert', async () => {
    const first = await evaluate(SOIL, 57);
    await evaluate(SOIL, 66);
    const second = await evaluate(SOIL, 56);
    expect(second.created).toBe(true);
    expect(second.alert.id).not.toBe(first.alert.id);
  });

  test('crossing from below the minimum to above the maximum closes LOW and opens HIGH', async () => {
    await evaluate(TEMP, 13);
    const high = await evaluate(TEMP, 27);
    expect(high.alert.type).toBe('HIGH');
    expect(db.state.alerts.find((a) => a.type === 'LOW').status).toBe('RESOLVED');
    expect(openAlerts('TMP-01').map((a) => a.type)).toEqual(['HIGH']);
  });
});

describe('US11-T6 light at night', () => {
  test('low light at night is normal: no alert', async () => {
    daylight.isDaylight.mockResolvedValue(false);
    const r = await evaluate(LIGHT, 0);
    expect(r.created).toBe(false);
  });

  test('low light during daylight raises a LOW alert', async () => {
    const r = await evaluate(LIGHT, 4000);
    expect(r.alert.type).toBe('LOW');
  });
});
