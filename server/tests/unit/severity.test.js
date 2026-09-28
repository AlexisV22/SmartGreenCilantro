'use strict';

// US-12 — severity classification: deviation outside the threshold as a
// percentage of the optimal range. LOW <= 10 %, MEDIUM <= 25 %, HIGH > 25 %.

const { classifySeverity, deviationPercent } = require('../../src/modules/alerts/service');

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
