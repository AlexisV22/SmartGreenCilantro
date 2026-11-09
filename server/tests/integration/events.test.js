'use strict';

// US17-T3 — automated tests of the actuator event log: recordEvent (required
// fields, valid sources MANUAL/AUTOMATIC/AI), the event query (newest first,
// filters) and the daily irrigation minutes.

const { db, api, reseed } = require('../helpers');
const events = require('../../src/modules/events/service');

beforeAll(reseed);
afterAll(() => db.close());
beforeEach(() => db.query('DELETE FROM actuator_events'));

const insertAt = (actuatorId, action, source, minutesAgo, durationMin = null) => db.query(
  `INSERT INTO actuator_events (actuator_id, action, source, duration_min, created_at)
   VALUES ($1, $2, $3, $4, NOW() - ($5 || ' minutes')::interval)`,
  [actuatorId, action, source, durationMin, String(minutesAgo)],
);

describe('US17-T3 recordEvent', () => {
  test('stores actuator, action, source, user, reason and duration', async () => {
    const ev = await events.recordEvent({
      actuatorId: 'ACT-PUMP-01', action: 'ON', source: 'MANUAL', userId: 'usr-producer',
      reason: 'Manual control from the dashboard.', durationMin: 3,
    });
    expect(ev).toMatchObject({ actuator_id: 'ACT-PUMP-01', action: 'ON', source: 'MANUAL', user_id: 'usr-producer' });
    expect(Number(ev.duration_min)).toBe(3);
    expect(ev.id).toMatch(/^evt-/);
    expect(ev.created_at).toBeInstanceOf(Date);
  });

  test.each(['MANUAL', 'AUTOMATIC', 'AI'])('source %s is accepted', async (source) => {
    const ev = await events.recordEvent({ actuatorId: 'ACT-PUMP-01', action: 'OFF', source });
    expect(ev.source).toBe(source);
  });

  test.each([
    ['actuator', { action: 'ON', source: 'MANUAL' }],
    ['action', { actuatorId: 'ACT-PUMP-01', source: 'MANUAL' }],
    ['source', { actuatorId: 'ACT-PUMP-01', action: 'ON' }],
  ])('an event without %s is rejected', async (_field, event) => {
    await expect(events.recordEvent(event)).rejects.toThrow(/null value/);
    expect((await db.one('SELECT COUNT(*)::int AS n FROM actuator_events')).n).toBe(0);
  });

  test.each([
    ['an unknown source', { actuatorId: 'ACT-PUMP-01', action: 'ON', source: 'ROBOT' }],
    ['an unknown action', { actuatorId: 'ACT-PUMP-01', action: 'TOGGLE', source: 'MANUAL' }],
    ['an unknown actuator', { actuatorId: 'ACT-NOPE', action: 'ON', source: 'MANUAL' }],
  ])('%s is rejected', async (_name, event) => {
    await expect(events.recordEvent(event)).rejects.toThrow();
  });
});

describe('US17-T3 event query', () => {
  test('GET /actuators/events returns the newest first with actuator and user', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'AUTOMATIC', 30);
    await insertAt('ACT-PUMP-01', 'OFF', 'AUTOMATIC', 20);
    await events.recordEvent({ actuatorId: 'ACT-PUMP-01', action: 'ON', source: 'MANUAL', userId: 'usr-producer' });
    const res = await api('producer').get('/actuators/events?actuator_id=ACT-PUMP-01');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => `${e.action}/${e.source}`)).toEqual(['ON/MANUAL', 'OFF/AUTOMATIC', 'ON/AUTOMATIC']);
    const times = res.body.map((e) => new Date(e.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.body[0]).toMatchObject({ actuator_type: 'irrigation_pump', user_email: 'producer@smartgreen.ai' });
  });

  test('filter by source distinguishes MANUAL, AUTOMATIC and AI', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'MANUAL', 15);
    await insertAt('ACT-PUMP-01', 'ON', 'AUTOMATIC', 10);
    await insertAt('ACT-PUMP-01', 'ON', 'AI', 5);
    for (const source of ['MANUAL', 'AUTOMATIC', 'AI']) {
      const res = await api('producer').get(`/actuators/events?source=${source}`);
      expect(res.body.map((e) => e.source)).toEqual([source]);
    }
  });

  test('filter by date range', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'MANUAL', 120);
    await insertAt('ACT-PUMP-01', 'ON', 'MANUAL', 5);
    const from = new Date(Date.now() - 60 * 60000).toISOString();
    const res = await api('producer').get(`/actuators/events?from=${encodeURIComponent(from)}`);
    expect(res.body).toHaveLength(1);
  });
});

describe('US17-T3 daily irrigation minutes', () => {
  test('an ON closed by the next OFF counts the real minutes', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'MANUAL', 30, 10);
    await insertAt('ACT-PUMP-01', 'OFF', 'MANUAL', 26);
    const [day] = await events.dailyIrrigationMinutes({ areaId: 'AREA-1', days: 1 });
    expect(Number(day.minutes)).toBeCloseTo(4, 1);
  });

  test('an ON without OFF counts its commanded duration', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'AUTOMATIC', 3, 5);
    const [day] = await events.dailyIrrigationMinutes({ areaId: 'AREA-1', days: 1 });
    expect(Number(day.minutes)).toBeCloseTo(5, 1);
  });

  test('a late OFF never counts more than the commanded duration', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'MANUAL', 40, 3);
    await insertAt('ACT-PUMP-01', 'OFF', 'MANUAL', 20);
    const [day] = await events.dailyIrrigationMinutes({ areaId: 'AREA-1', days: 1 });
    expect(Number(day.minutes)).toBeCloseTo(3, 1);
  });

  test('several irrigations of the same day are added; other actuators are ignored', async () => {
    await insertAt('ACT-PUMP-01', 'ON', 'MANUAL', 60, 10);
    await insertAt('ACT-PUMP-01', 'OFF', 'MANUAL', 58);
    await insertAt('ACT-PUMP-01', 'ON', 'AUTOMATIC', 10, 10);
    await insertAt('ACT-PUMP-01', 'OFF', 'AUTOMATIC', 7);
    await insertAt('ACT-FAN-01', 'ON', 'AUTOMATIC', 50, 30);
    const res = await api('producer').get('/irrigation/daily-minutes?area_id=AREA-1&days=1');
    expect(res.status).toBe(200);
    const total = res.body.reduce((s, d) => s + Number(d.minutes), 0);
    expect(total).toBeCloseTo(5, 1);
  });
});
