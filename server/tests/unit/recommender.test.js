'use strict';

// US-20 / US-21 — explainable recommender and explanation builder.

const { recommend } = require('../../src/ai/recommender');
const explainer = require('../../src/ai/explainer');

const AI_CONFIG = {
  weight_moisture_deficit: 40, weight_temperature: 20, weight_humidity: 10, weight_trend: 15,
  weight_time_since_irrigation: 15, penalty_recent_irrigation: 25, irrigate_score_threshold: 60,
  sensor_disagreement_pct: 15, schedule_minutes: 15, duration_factor: 0.5, llm_enabled: false, llm_model: 'claude-opus-5',
};
const CONTEXT = {
  thresholds: {
    soil_moisture: { min_value: 60, max_value: 80 },
    temperature: { min_value: 15, max_value: 25 },
    air_humidity: { min_value: 50, max_value: 70 },
  },
  irrigation: { target_moisture: 65, max_duration_min: 10, cooldown_min: 30, min_tank_level: 20 },
  aiConfig: AI_CONFIG,
};

/** Moisture series (5-min buckets) ending at `end`, falling `slope` points per hour. */
function moistureSeries(end, slope, hours = 6) {
  const t0 = Date.now() - hours * 3600000;
  return Array.from({ length: hours * 12 + 1 }, (_, i) => ({
    t: new Date(t0 + i * 300000), value: end + slope * (hours - i / 12),
  }));
}

function features(overrides = {}) {
  const moisture = overrides.soil_moisture ?? 68;
  return {
    soil_moisture: moisture,
    temperature: 22,
    air_humidity: 60,
    tank_level: 80,
    hours_since_irrigation: 3,
    sensor_values: { 'SM-01': moisture + 0.5, 'SM-02': moisture - 0.5 },
    sensor_spread_pct: 1,
    soil_sensor_count: 2,
    soil_sensor_anomalies: 0,
    anomaly_count_last_hour: 0,
    completeness: { overall: 1 },
    series: { moisture: moistureSeries(moisture, overrides.slope ?? 0) },
    ...overrides,
  };
}

describe('US20-T2 decision rules', () => {
  test('dry and hot -> IRRIGATE with a duration proportional to the deficit', () => {
    const r = recommend(features({ soil_moisture: 52, temperature: 30, air_humidity: 45, slope: 1.5, hours_since_irrigation: 10 }), CONTEXT);
    expect(r.type).toBe('IRRIGATE');
    expect(r.score).toBeGreaterThanOrEqual(60);
    // (65 - 52) * 0.5 = 6.5 min, capped by the 10-minute maximum
    expect(r.recommended_duration_min).toBeCloseTo(6.5);
    expect(r.factors[0].key).toBe('moisture_deficit');
  });

  test('below the agronomic minimum -> IRRIGATE even with a moderate score', () => {
    const r = recommend(features({ soil_moisture: 57 }), CONTEXT);
    expect(r.score).toBeLessThan(60);
    expect(r.below_minimum).toBe(true);
    expect(r.type).toBe('IRRIGATE');
  });

  test('duration is capped by the configured maximum', () => {
    const r = recommend(features({ soil_moisture: 30, temperature: 30 }), CONTEXT);
    expect(r.recommended_duration_min).toBe(10);
  });

  test('wet soil -> WAIT', () => {
    const r = recommend(features({ soil_moisture: 86 }), CONTEXT);
    expect(r.type).toBe('WAIT');
    expect(r.recommended_duration_min).toBeNull();
  });

  test('recent irrigation (cooldown) -> WAIT with a negative factor', () => {
    const r = recommend(features({ soil_moisture: 58, hours_since_irrigation: 0.2 }), CONTEXT);
    expect(r.type).toBe('WAIT');
    expect(r.factors.some((f) => f.key === 'recent_irrigation' && f.contribution < 0)).toBe(true);
  });

  test('low water tank -> CHECK_WATER', () => {
    const r = recommend(features({ soil_moisture: 50, tank_level: 10 }), CONTEXT);
    expect(r.type).toBe('CHECK_WATER');
  });

  test('anomalous soil readings -> CHECK_SENSOR (never irrigate on untrusted data)', () => {
    const r = recommend(features({ soil_moisture: 50, soil_sensor_anomalies: 2, anomaly_count_last_hour: 2 }), CONTEXT);
    expect(r.type).toBe('CHECK_SENSOR');
  });

  test('soil sensors disagreeing more than 15 points -> CHECK_SENSOR', () => {
    const r = recommend(features({ soil_moisture: 55, sensor_values: { 'SM-01': 70, 'SM-02': 40 }, sensor_spread_pct: 30 }), CONTEXT);
    expect(r.type).toBe('CHECK_SENSOR');
  });

  test('hot and humid with enough soil water -> VENTILATE', () => {
    const r = recommend(features({ soil_moisture: 70, temperature: 29, air_humidity: 78 }), CONTEXT);
    expect(r.type).toBe('VENTILATE');
  });

  test('weights come from ai_config', () => {
    const heavy = { ...CONTEXT, aiConfig: { ...AI_CONFIG, weight_moisture_deficit: 100 } };
    const a = recommend(features({ soil_moisture: 62 }), CONTEXT);
    const b = recommend(features({ soil_moisture: 62 }), heavy);
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe('US20-T4 confidence', () => {
  test('complete, agreeing, anomaly-free data -> High', () => {
    const r = recommend(features(), CONTEXT);
    expect(r.confidence).toBeGreaterThan(0.75);
    expect(explainer.confidenceText(r.confidence)).toBe('High');
  });
  test('missing data and anomalies reduce the confidence', () => {
    const r = recommend(features({ completeness: { overall: 0.5 }, anomaly_count_last_hour: 4 }), CONTEXT);
    expect(r.confidence).toBeLessThan(0.45);
    expect(explainer.confidenceText(r.confidence)).toBe('Low');
  });
  test.each([[0.8, 'High'], [0.75, 'High'], [0.6, 'Medium'], [0.45, 'Medium'], [0.3, 'Low']])('%p -> %s', (c, t) => {
    expect(explainer.confidenceText(c)).toBe(t);
  });
});

describe('US-21 explanation — the 5 elements of section 11 are always present', () => {
  const cases = {
    IRRIGATE: features({ soil_moisture: 52, temperature: 29, hours_since_irrigation: 8 }),
    WAIT: features({ soil_moisture: 70 }),
    CHECK_WATER: features({ soil_moisture: 50, tank_level: 5 }),
    CHECK_SENSOR: features({ soil_moisture: 50, soil_sensor_anomalies: 1 }),
    VENTILATE: features({ soil_moisture: 70, temperature: 29, air_humidity: 80 }),
  };

  test.each(Object.entries(cases))('%s', async (type, f) => {
    const result = recommend(f, CONTEXT);
    expect(result.type).toBe(type);
    const e = await explainer.explain(result, 'AREA-1', AI_CONFIG);
    expect(e.recommendation).toMatch(/Area 1/);
    expect(e.reason.length).toBeGreaterThan(30);
    expect(Array.isArray(e.relevant_measurements)).toBe(true);
    expect(e.relevant_measurements.length).toBeGreaterThan(0);
    expect(['High', 'Medium', 'Low']).toContain(e.confidence_text);
    expect(new Date(e.timestamp).toString()).not.toBe('Invalid Date');
    expect(e.reason_source).toBe('template');
  });

  test('IRRIGATE reason cites the measured values in plain English', async () => {
    const result = recommend(features({ soil_moisture: 54, temperature: 29, hours_since_irrigation: 8 }), CONTEXT);
    const e = await explainer.explain(result, 'AREA-1', AI_CONFIG);
    expect(e.reason).toMatch(/Irrigation should be considered for Area 1 because soil moisture \(54 %\) is below/);
    expect(e.reason).toMatch(/29 °C/);
    expect(e.reason).toMatch(/Verify water availability/);
  });

  test('wet soil is never described as "inside the expected range"', async () => {
    const result = recommend(features({ soil_moisture: 86 }), CONTEXT);
    const e = await explainer.explain(result, 'AREA-1', AI_CONFIG);
    expect(e.reason).toMatch(/above the optimal maximum/);
  });

  test('without an API key the LLM is never called and the template is used', async () => {
    const result = recommend(features({ soil_moisture: 52 }), CONTEXT);
    const e = await explainer.explain(result, 'AREA-1', { ...AI_CONFIG, llm_enabled: true });
    expect(e.reason_source).toBe('template');
  });
});
