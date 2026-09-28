'use strict';

// US-18 — trend analysis: linear regression slope, RISING/FALLING/STABLE and
// projected time to reach a threshold.

const trends = require('../../src/ai/trends');
const { resample, completeness, latestValue } = require('../../src/ai/preprocessing');

const HOUR = 3600000;
const series = (values, stepMin = 60) => values.map((v, i) => ({ t: new Date(Date.UTC(2026, 9, 1) + i * stepMin * 60000), value: v }));

describe('US18-T2 trends', () => {
  test('a falling series has a negative slope per hour and is FALLING', () => {
    const r = trends.analyse(series([70, 68, 66, 64, 62]), { min_value: 60, max_value: 80, unit: '%' }, 0.05);
    expect(r.slope_per_hour).toBeCloseTo(-2, 5);
    expect(r.direction).toBe('FALLING');
    // 62 % falling 2 %/h reaches the 60 % minimum in about 1 h
    expect(r.hours_to_threshold).toBeCloseTo(1, 1);
  });

  test('a rising series is RISING and projects to the maximum', () => {
    const r = trends.analyse(series([20, 21, 22, 23]), { min_value: 15, max_value: 25, unit: 'C' }, 0.05);
    expect(r.direction).toBe('RISING');
    expect(r.hours_to_threshold).toBeCloseTo(2, 1);
  });

  test('changes below the tolerance are STABLE', () => {
    const r = trends.analyse(series([65, 65.01, 65.02, 65.01]), { min_value: 60, max_value: 80, unit: '%' }, 0.05);
    expect(r.direction).toBe('STABLE');
  });

  test('not enough points gives no direction instead of a false trend', () => {
    const r = trends.analyse(series([65]), { min_value: 60, max_value: 80 }, 0.05);
    expect(r.direction === null || r.direction === 'STABLE' || r.direction === 'UNKNOWN').toBe(true);
  });
});

describe('US-20 preprocessing', () => {
  test('resamples to 5-minute buckets and interpolates gaps up to 15 minutes', () => {
    const t0 = Date.UTC(2026, 9, 1, 12, 0);
    const rows = [
      { recorded_at: new Date(t0), value: 60 },
      { recorded_at: new Date(t0 + 1 * 60000), value: 62 },
      // gap of two buckets (10 minutes) -> interpolated
      { recorded_at: new Date(t0 + 15 * 60000), value: 70 },
    ];
    const s = resample(rows, { from: new Date(t0), to: new Date(t0 + 15 * 60000) });
    expect(s).toHaveLength(4);
    expect(s[0].value).toBe(61); // mean of the first bucket
    expect(s[1].interpolated).toBe(true);
    expect(s[1].value).toBeCloseTo(64);
    expect(s[3].value).toBe(70);
    expect(latestValue(s)).toBe(70);
    expect(completeness(s)).toBeCloseTo(0.5);
  });

  test('gaps longer than 15 minutes stay empty (no invented data)', () => {
    const t0 = Date.UTC(2026, 9, 1, 12, 0);
    const s = resample([{ recorded_at: new Date(t0), value: 60 }, { recorded_at: new Date(t0 + HOUR), value: 70 }],
      { from: new Date(t0), to: new Date(t0 + HOUR) });
    expect(s.filter((b) => b.value === null).length).toBeGreaterThan(0);
  });
});
