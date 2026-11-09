'use strict';

// US-12 — severity classification: deviation outside the threshold as a
// percentage of the optimal range. LOW <= 10 %, MEDIUM <= 25 %, HIGH > 25 %.

// The upgrade tests run evaluateMeasurement against an in-memory database.
jest.mock('../../src/db', () => require('./fakes/alertsDb').createAlertsDb());
jest.mock('../../src/utils/settings', () => ({
  getNumber: jest.fn(async (_key, fallback) => fallback),
  getString: jest.fn(async (_key, fallback) => fallback),
}));
jest.mock('../../src/utils/logger', () => ({ logSystem: jest.fn() }));

const db = require('../../src/db');
const settings = require('../../src/utils/settings');
const { classifySeverity, deviationPercent, evaluateMeasurement } = require('../../src/modules/alerts/service');

describe('US-12 deviationPercent', () => {
  test('below the minimum is measured from the minimum', () => {
    // soil moisture 60-80 % (range 20): 58 % is 2 points = 10 %
    expect(deviationPercent(58, 60, 80)).toBeCloseTo(10);
  });
  test('above the maximum is measured from the maximum', () => {
    // temperature 15-25 °C (range 10): 27.5 °C is 2.5 = 25 %
    expect(deviationPercent(27.5, 15, 25)).toBeCloseTo(25);
  });
  test('a degenerate range never divides by zero', () => {
    expect(deviationPercent(10, 5, 5)).toBe(0);
  });
});

describe('US12-T3 severity boundaries 9/10/11/24/25/26 %', () => {
  test.each([
    [9, 'LOW'], [10, 'LOW'], [11, 'MEDIUM'],
    [24, 'MEDIUM'], [25, 'MEDIUM'], [26, 'HIGH'],
    [0.1, 'LOW'], [150, 'HIGH'],
  ])('%p %% -> %s', (pct, expected) => {
    expect(classifySeverity(pct, 10, 25)).toBe(expected);
  });

  test('limits are configurable (system_parameters)', () => {
    expect(classifySeverity(12, 15, 30)).toBe('LOW');
    expect(classifySeverity(31, 15, 30)).toBe('HIGH');
  });

  test('end to end with the cilantro soil range 60-80 %', () => {
    const sev = (v) => classifySeverity(deviationPercent(v, 60, 80), 10, 25);
    expect(sev(58.2)).toBe('LOW'); //  9 %
    expect(sev(57.8)).toBe('MEDIUM'); // 11 %
    expect(sev(55.2)).toBe('MEDIUM'); // 24 %
    expect(sev(54.8)).toBe('HIGH'); // 26 %
  });
});

describe('US12-T3 severity stored on the alert and upgraded while it is open', () => {
  const SOIL = { id: 'SM-01', area_id: 'AREA-1', type: 'soil_moisture' }; // 60-80 %
  const evaluate = (value) => evaluateMeasurement(SOIL, { id: `m-${value}`, value, recorded_at: new Date().toISOString() });

  beforeEach(() => db.reset());

  test.each([
    [58.2, 'LOW'], [58.0, 'LOW'], [57.8, 'MEDIUM'],
    [55.2, 'MEDIUM'], [55.0, 'MEDIUM'], [54.8, 'HIGH'],
  ])('a new alert at %p %% is created with severity %s', async (value, expected) => {
    const r = await evaluate(value);
    expect(r.created).toBe(true);
    expect(r.alert.severity).toBe(expected);
  });

  test('LOW -> MEDIUM -> HIGH as the deviation grows, on the same alert', async () => {
    const first = await evaluate(58.5); // 7.5 %
    expect(first.alert.severity).toBe('LOW');
    const medium = await evaluate(57); // 15 %
    expect(medium).toMatchObject({ created: false, upgraded: true });
    expect(medium.alert.severity).toBe('MEDIUM');
    const high = await evaluate(54); // 30 %
    expect(high.upgraded).toBe(true);
    expect(high.alert).toMatchObject({ id: first.alert.id, severity: 'HIGH' });
  });

  test('the severity is never downgraded while the alert stays open', async () => {
    await evaluate(54); // HIGH
    const better = await evaluate(59); // 5 %, still below the minimum
    expect(better.upgraded).toBe(false);
    expect(better.alert.severity).toBe('HIGH');
    expect(Number(better.alert.deviation_pct)).toBeCloseTo(5);
  });

  test('the limits come from system_parameters', async () => {
    settings.getNumber.mockImplementation(async (key, fallback) => ({
      'severity.low_max_pct': 5, 'severity.medium_max_pct': 12,
    }[key] ?? fallback));
    const r = await evaluate(57.8); // 11 %
    expect(r.alert.severity).toBe('MEDIUM');
    expect(settings.getNumber).toHaveBeenCalledWith('severity.low_max_pct', 10);
    expect(settings.getNumber).toHaveBeenCalledWith('severity.medium_max_pct', 25);
    settings.getNumber.mockImplementation(async (_key, fallback) => fallback);
  });
});
