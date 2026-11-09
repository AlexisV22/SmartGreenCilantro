'use strict';

// US19-T7 — unit tests of the five detection methods with small fixed data
// sets: out of range, sudden jump, z-score outlier, missing data and
// flatline. Each method has a positive and a negative case. The database is
// replaced by an in-memory fake that serves the fixed readings, so the tests
// run without PostgreSQL.

jest.mock('../../src/db', () => {
  const state = { readings: [], sensors: [], anomalies: [], flagged: [] };
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = (xs) => Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
  const minutesOld = (r) => (Date.now() - new Date(r.recorded_at).getTime()) / 60000;

  return {
    state,
    async one(sql, params) {
      if (sql.includes('INSERT INTO anomalies')) {
        const [sensorId, measurementId, method, value, score, explanation] = params;
        if (measurementId && state.anomalies.some((a) => a.measurement_id === measurementId && a.method === method)) return null;
        const row = { id: `anm-${state.anomalies.length + 1}`, sensor_id: sensorId, measurement_id: measurementId, method, value, score, explanation, detected_at: new Date() };
        state.anomalies.push(row);
        return row;
      }
      if (sql.includes('ORDER BY recorded_at DESC LIMIT 1')) {
        const [sensorId, id] = params;
        const prev = state.readings.filter((r) => r.sensor_id === sensorId && r.id !== id)
          .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];
        return prev || null;
      }
      if (sql.includes('STDDEV_SAMP')) {
        const [sensorId, id] = params;
        const xs = state.readings.filter((r) => r.sensor_id === sensorId && r.id !== id && !r.is_anomaly && minutesOld(r) < 24 * 60).map((r) => r.value);
        return { mean: xs.length ? mean(xs) : null, sd: xs.length > 1 ? sd(xs) : null, n: xs.length };
      }
      if (sql.includes('FROM anomalies') && sql.includes('detected_at > NOW()')) {
        const [sensorId, method, minutes] = params;
        return state.anomalies.find((a) => a.sensor_id === sensorId && a.method === method
          && (Date.now() - a.detected_at.getTime()) / 60000 < Number(minutes)) ? { '?column?': 1 } : null;
      }
      throw new Error(`fake db: unexpected one(): ${sql.slice(0, 60)}`);
    },
    async rows(sql, params) {
      if (sql.includes('SELECT DISTINCT type FROM sensors')) {
        return [...new Set(state.sensors.map((s) => s.type))].map((type) => ({ type }));
      }
      if (sql.includes('AS last_at')) {
        return state.sensors.map((s) => {
          const own = state.readings.filter((r) => r.sensor_id === s.id);
          if (!own.length) return null;
          return { ...s, last_at: own.map((r) => new Date(r.recorded_at)).sort((a, b) => b - a)[0] };
        }).filter(Boolean);
      }
      if (sql.includes('distinct_values')) {
        const windowMin = Number(params[0]);
        return state.sensors.filter((s) => params[1].includes(s.type)).map((s) => {
          const recent = state.readings.filter((r) => r.sensor_id === s.id && minutesOld(r) < windowMin);
          const distinct = new Set(recent.map((r) => r.value));
          return { ...s, distinct_values: distinct.size, n: recent.length, value: recent.length ? Math.max(...recent.map((r) => r.value)) : null };
        }).filter((s) => s.n >= 3 && s.distinct_values === 1);
      }
      throw new Error(`fake db: unexpected rows(): ${sql.slice(0, 60)}`);
    },
    async query(sql, params) {
      if (sql.includes('UPDATE measurements SET is_anomaly')) state.flagged.push(params[0]);
      return { rows: [], rowCount: 1 };
    },
  };
});
jest.mock('../../src/utils/settings', () => ({ getNumber: jest.fn(async (_key, fallback) => fallback) }));
jest.mock('../../src/utils/logger', () => ({ logSystem: jest.fn() }));
jest.mock('../../src/utils/daylight', () => ({ isDaylight: jest.fn(async () => true) }));

const db = require('../../src/db');
const settings = require('../../src/utils/settings');
const daylight = require('../../src/utils/daylight');
const { checkMeasurement, runPeriodicChecks } = require('../../src/modules/anomalies/service');

const SOIL = { id: 'SM-01', name: 'Soil moisture 1', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 };
const TEMP = { id: 'TMP-01', name: 'Air temperature', type: 'temperature', unit: 'C', physical_min: -40, physical_max: 85 };
const WL = { id: 'WL-01', name: 'Water tank', type: 'water_level', unit: '%', physical_min: 0, physical_max: 100 };
const LUX = { id: 'LUX-01', name: 'Light', type: 'light', unit: 'lux', physical_min: 0, physical_max: 120000 };

let seq = 0;
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
/** Load a fixed series [[value, minutesAgo], …] for one sensor. */
function load(sensor, series) {
  for (const [value, minutesAgo] of series) {
    seq += 1;
    db.state.readings.push({ id: `m-${seq}`, sensor_id: sensor.id, value, recorded_at: at(minutesAgo), is_anomaly: false });
  }
}
/** A new reading arriving now, checked at ingestion time. */
async function ingest(sensor, value) {
  seq += 1;
  const m = { id: `m-${seq}`, sensor_id: sensor.id, value, recorded_at: at(0) };
  db.state.readings.push({ ...m, is_anomaly: false });
  return (await checkMeasurement(sensor, m)).map((a) => a.method);
}

// 24 h of a stable temperature around 21-22 C, one reading per hour.
const STABLE_TEMP = Array.from({ length: 24 }, (_, i) => [21 + (i % 3) * 0.5, 60 * (i + 1)]);

beforeEach(() => {
  Object.assign(db.state, { readings: [], sensors: [], anomalies: [], flagged: [] });
  settings.getNumber.mockImplementation(async (_key, fallback) => fallback);
  daylight.isDaylight.mockResolvedValue(true);
});

describe('US19-T7 OUT_OF_RANGE (physical range of the sensor)', () => {
  test('positive: 140 % soil moisture is impossible and flags the reading', async () => {
    load(SOIL, [[66, 5]]);
    // 66 -> 140 is also an impossible jump: both faults are recorded on the same reading.
    expect(await ingest(SOIL, 140)).toEqual(['OUT_OF_RANGE', 'SUDDEN_JUMP']);
    expect(new Set(db.state.flagged).size).toBe(1);
  });

  test('positive: below the physical minimum (-3 %)', async () => {
    expect(await ingest(SOIL, -3)).toEqual(['OUT_OF_RANGE']);
  });

  test('negative: values at the physical limits 0 % and 100 % are valid', async () => {
    expect(await ingest(SOIL, 0)).not.toContain('OUT_OF_RANGE');
    expect(await ingest(SOIL, 100)).not.toContain('OUT_OF_RANGE');
  });
});

describe('US19-T7 SUDDEN_JUMP (change between consecutive readings)', () => {
  test('positive: temperature 22 -> 30 C (+8, limit 5)', async () => {
    load(TEMP, [[22, 5]]);
    expect(await ingest(TEMP, 30)).toContain('SUDDEN_JUMP');
  });

  test('negative: temperature 22 -> 26 C (+4) and exactly +5 are not jumps', async () => {
    load(TEMP, [[22, 10]]);
    expect(await ingest(TEMP, 26)).not.toContain('SUDDEN_JUMP');
    expect(await ingest(TEMP, 31)).not.toContain('SUDDEN_JUMP'); // 26 -> 31 is exactly 5
  });

  test('negative: the first reading of a sensor has nothing to compare with', async () => {
    expect(await ingest(TEMP, 30)).toEqual([]);
  });

  test('the limit per type comes from system_parameters (anomaly.jump.<type>)', async () => {
    settings.getNumber.mockImplementation(async (key, fallback) => (key === 'anomaly.jump.temperature' ? 3 : fallback));
    load(TEMP, [[22, 5]]);
    expect(await ingest(TEMP, 25.5)).toContain('SUDDEN_JUMP');
  });
});

describe('US19-T7 ZSCORE (outlier against the last 24 h)', () => {
  test('positive: 27 C after a stable day around 21.5 C (|z| > 3)', async () => {
    load(TEMP, STABLE_TEMP);
    const found = await ingest(TEMP, 25.4); // jump from 21-22 is < 5, so only the z-score fires
    expect(found).toEqual(['ZSCORE']);
    const z = db.state.anomalies[0];
    expect(z.score).toBeGreaterThan(3);
    expect(db.state.flagged).toHaveLength(0); // an outlier stays usable
  });

  test('negative: 22 C on the same stable day is normal', async () => {
    load(TEMP, STABLE_TEMP);
    expect(await ingest(TEMP, 22)).toEqual([]);
  });

  test('negative: fewer than 20 samples never produce a z-score', async () => {
    load(TEMP, STABLE_TEMP.slice(0, 10));
    expect(await ingest(TEMP, 25.4)).toEqual([]);
  });
});

describe('US19-T7 MISSING_DATA (no reading for 5 minutes)', () => {
  test('positive: last soil reading 7 minutes ago', async () => {
    db.state.sensors = [SOIL];
    load(SOIL, [[66, 12], [66.2, 7]]);
    const found = await runPeriodicChecks();
    expect(found.map((a) => a.method)).toEqual(['MISSING_DATA']);
    expect(found[0].explanation).toMatch(/for 7 minutes \(the limit is 5\)/);
  });

  test('negative: last reading 2 minutes ago', async () => {
    db.state.sensors = [SOIL];
    load(SOIL, [[66, 7], [66.3, 2]]);
    expect(await runPeriodicChecks()).toEqual([]);
  });

  test('the same silence is recorded once, not on every job tick', async () => {
    db.state.sensors = [SOIL];
    load(SOIL, [[66, 9]]);
    expect(await runPeriodicChecks()).toHaveLength(1);
    expect(await runPeriodicChecks()).toHaveLength(0);
  });
});

describe('US19-T7 FLATLINE (identical value for 30 minutes)', () => {
  test('positive: the tank reports exactly 80 % for 30 minutes', async () => {
    db.state.sensors = [WL];
    load(WL, [[80, 25], [80, 15], [80, 5], [80, 1]]);
    const found = await runPeriodicChecks();
    expect(found.map((a) => a.method)).toEqual(['FLATLINE']);
    expect(found[0]).toMatchObject({ value: 80, score: 4 });
  });

  test('negative: small natural variation (80.0, 79.8, 79.9, 80.1)', async () => {
    db.state.sensors = [WL];
    load(WL, [[80, 25], [79.8, 15], [79.9, 5], [80.1, 1]]);
    expect(await runPeriodicChecks()).toEqual([]);
  });

  test('negative: only two identical readings are not enough evidence', async () => {
    db.state.sensors = [WL];
    load(WL, [[80, 10], [80, 1]]);
    expect(await runPeriodicChecks()).toEqual([]);
  });
});

describe('US19-T9 tuned flatline rules', () => {
  test('light at night: 0 lux for 30 minutes is darkness, not a frozen sensor', async () => {
    daylight.isDaylight.mockResolvedValue(false);
    db.state.sensors = [LUX];
    load(LUX, [[0, 25], [0, 15], [0, 5], [0, 1]]);
    expect(await runPeriodicChecks()).toEqual([]);
  });

  test('light in daylight: a frozen value is still a FLATLINE', async () => {
    db.state.sensors = [LUX];
    load(LUX, [[0, 25], [0, 15], [0, 5], [0, 1]]);
    expect((await runPeriodicChecks()).map((a) => a.method)).toEqual(['FLATLINE']);
  });

  test('a per-type window (anomaly.flatline_minutes.water_level) replaces the global one', async () => {
    settings.getNumber.mockImplementation(async (key, fallback) => (key === 'anomaly.flatline_minutes.water_level' ? 720 : fallback));
    db.state.sensors = [WL, SOIL];
    load(WL, [[80.4, 700], [80.4, 400], [80.4, 25], [80.4, 1]]); // 80.4 % for 12 h
    load(SOIL, [[66, 25], [66, 15], [66, 5], [66, 1]]); // soil frozen for 30 min
    const found = await runPeriodicChecks();
    expect(found.map((a) => `${a.sensor_id} ${a.method}`).sort()).toEqual(['SM-01 FLATLINE', 'WL-01 FLATLINE']);
    expect(found.find((a) => a.sensor_id === 'WL-01').explanation).toMatch(/over 720 minutes/);
  });

  test('a quiet tank that keeps its level for 30 minutes is not flagged with the 12 h window', async () => {
    settings.getNumber.mockImplementation(async (key, fallback) => (key === 'anomaly.flatline_minutes.water_level' ? 720 : fallback));
    db.state.sensors = [WL];
    load(WL, [[80.5, 700], [80.4, 400], [80.4, 25], [80.4, 1]]);
    expect(await runPeriodicChecks()).toEqual([]);
  });
});
