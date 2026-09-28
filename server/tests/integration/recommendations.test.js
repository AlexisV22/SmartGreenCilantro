'use strict';

// US-20 generation, US-21 explanation, US-26 decisions (accept -> AI command,
// reject, second decision 409), AI configuration.

const { db, api, device, insertHistory, reseed } = require('../helpers');
const recommendationJob = require('../../src/jobs/recommendationJob');

beforeAll(reseed);
afterAll(() => db.close());

async function dryAndHot() {
  await db.query('DELETE FROM measurements');
  await db.query('DELETE FROM recommendations');
  await db.query('DELETE FROM actuator_commands');
  await db.query('DELETE FROM actuator_events');
  await db.query("UPDATE actuators SET state = 'OFF', last_update = NOW()");
  await db.query("UPDATE areas SET mode = 'MANUAL' WHERE id = 'AREA-1'");
  await insertHistory('SM-01', [64, 61, 58, 55, 53], { stepMinutes: 5 });
  await insertHistory('SM-02', [63, 60, 57, 54, 52], { stepMinutes: 5 });
  await insertHistory('TMP-01', [27, 28, 28.5, 29, 29], { stepMinutes: 5 });
  await insertHistory('HUM-01', [52, 50, 49, 48, 48], { stepMinutes: 5 });
  await insertHistory('WL-01', [80, 80, 79, 79, 79], { stepMinutes: 5 });
}

describe('US-20 generation', () => {
  beforeAll(dryAndHot);
  let rec;

  test('POST /recommendations/generate (admin) creates an IRRIGATE recommendation', async () => {
    const res = await api('admin').post('/recommendations/generate', { area_id: 'AREA-1' });
    expect(res.status).toBe(201);
    const out = res.body.find((o) => o.area_id === 'AREA-1');
    expect(out.created).toBe(true);
    rec = out.recommendation;
    expect(rec.type).toBe('IRRIGATE');
    expect(rec.recommended_duration_min).toBeGreaterThan(0);
    expect(rec.recommended_duration_min).toBeLessThanOrEqual(10);
    expect(rec.status).toBe('PENDING');
  });

  test('US-21: the five explanation elements, factors and inputs are stored', async () => {
    const row = await db.one('SELECT * FROM recommendations WHERE id = $1', [rec.id]);
    expect(row.recommendation).toMatch(/Irrigation is recommended for Area 1/);
    expect(row.reason).toMatch(/soil moisture/);
    expect(row.relevant_measurements.length).toBeGreaterThanOrEqual(3);
    expect(['High', 'Medium', 'Low']).toContain(row.confidence_text);
    expect(row.created_at).not.toBeNull();
    expect(row.factors[0]).toHaveProperty('contribution');
    expect(row.inputs.soil_moisture).toBeCloseTo(52.5, 1);
  });

  test('no duplicate while one is PENDING', async () => {
    const res = await api('admin').post('/recommendations/generate', { area_id: 'AREA-1' });
    const out = res.body.find((o) => o.area_id === 'AREA-1');
    expect(out.created).toBe(false);
    expect(out.recommendation.id).toBe(rec.id);
  });

  test('a forced run replaces the pending recommendation (never two pending)', async () => {
    const res = await api('admin').post('/recommendations/generate', { area_id: 'AREA-1', force: true });
    const fresh = res.body[0].recommendation;
    expect(fresh.id).not.toBe(rec.id);
    const pending = await db.rows("SELECT id FROM recommendations WHERE area_id = 'AREA-1' AND status = 'PENDING'");
    expect(pending.map((r) => r.id)).toEqual([fresh.id]);
    expect((await db.one('SELECT status FROM recommendations WHERE id = $1', [rec.id])).status).toBe('EXPIRED');
    rec = fresh;
  });

  test('the producer sees it in its list and can filter by status', async () => {
    const res = await api('producer').get('/recommendations?status=PENDING&area_id=AREA-1');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toContain(rec.id);
  });

  test('the scheduled job runs and also respects the pending one', async () => {
    recommendationJob.reset();
    const outcomes = await recommendationJob.run({ force: true });
    expect(outcomes.find((o) => o.area_id === 'AREA-1').created).toBe(false);
  });
});

describe('US-26 decisions', () => {
  beforeEach(dryAndHot);

  const generate = async () => (await api('admin').post('/recommendations/generate', { area_id: 'AREA-1' }))
    .body.find((o) => o.area_id === 'AREA-1').recommendation;

  test('ACCEPTED IRRIGATE -> irrigation command with source AI, delivered to the device', async () => {
    const rec = await generate();
    const res = await api('producer').post(`/recommendations/${rec.id}/decision`, { decision: 'ACCEPTED', comment: 'Go ahead' });
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toMatchObject({ status: 'ACCEPTED', decided_by: 'usr-producer', decision_comment: 'Go ahead' });
    expect(res.body.command).toMatchObject({ actuator_id: 'ACT-PUMP-01', action: 'ON', source: 'AI' });
    expect(Number(res.body.command.duration_min)).toBe(Number(rec.recommended_duration_min));
    const poll = await device().get('/devices/me/commands');
    expect(poll.body.commands[0]).toMatchObject({ id: res.body.command.id, source: 'AI' });
  });

  test('REJECTED -> no command, reason stored', async () => {
    const rec = await generate();
    const res = await api('producer').post(`/recommendations/${rec.id}/decision`, { decision: 'REJECTED', comment: 'It will rain' });
    expect(res.status).toBe(200);
    expect(res.body.command).toBeNull();
    expect(res.body.recommendation.decision_comment).toBe('It will rain');
    const n = await db.one('SELECT COUNT(*)::int AS n FROM actuator_commands');
    expect(n.n).toBe(0);
  });

  test('a second decision -> 409 ERR_CONFLICT', async () => {
    const rec = await generate();
    await api('producer').post(`/recommendations/${rec.id}/decision`, { decision: 'REJECTED' });
    const res = await api('producer').post(`/recommendations/${rec.id}/decision`, { decision: 'ACCEPTED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ERR_CONFLICT');
  });

  test('invalid decision -> 400; unknown recommendation -> 404', async () => {
    const rec = await generate();
    expect((await api('producer').post(`/recommendations/${rec.id}/decision`, { decision: 'MAYBE' })).status).toBe(400);
    expect((await api('producer').post('/recommendations/rec-nope/decision', { decision: 'ACCEPTED' })).status).toBe(404);
  });

  test('decisions are audited', async () => {
    const rec = await generate();
    await api('producer').post(`/recommendations/${rec.id}/decision`, { decision: 'REJECTED' });
    await new Promise((r) => setTimeout(r, 300));
    const a = await db.one("SELECT * FROM audit_logs WHERE entity = 'recommendations' ORDER BY created_at DESC LIMIT 1");
    expect(a.entity_id).toBe(rec.id);
  });
});

describe('AI configuration', () => {
  test('GET/PUT /ai/config validates weights and is used by the recommender', async () => {
    const bad = await api('admin').put('/ai/config', { weight_trend: 500 });
    expect(bad.status).toBe(400);
    const ok = await api('superadmin').put('/ai/config', { irrigate_score_threshold: 70, llm_enabled: false });
    expect(ok.status).toBe(200);
    const cfg = await api('admin').get('/ai/config');
    expect(cfg.body.irrigate_score_threshold).toBe(70);
    expect(cfg.body.llm_model).toBe('claude-opus-5');
  });
});
