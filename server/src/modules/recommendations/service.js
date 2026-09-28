'use strict';

/**
 * AI recommendations: generation, delivery and decisions (US-20, US-21, US-26).
 *
 * Generation runs on a schedule and whenever a new alert appears. Only one
 * PENDING recommendation may exist per area, so the producer is never shown a
 * queue of stale advice (US20-T3). Accepting an IRRIGATE recommendation
 * creates a real irrigation command with source AI, which the event log then
 * records (US-26 -> US-15 -> US-17).
 */

const db = require('../../db');
const preprocessing = require('../../ai/preprocessing');
const recommender = require('../../ai/recommender');
const explainer = require('../../ai/explainer');
const commands = require('../commands/service');
const { notFound, conflict, badRequest } = require('../../middleware/errors');
const { logSystem } = require('../../utils/logger');

async function getAiConfig() {
  const row = await db.one('SELECT * FROM ai_config WHERE id = $1', ['ai-default']);
  if (!row) throw notFound('The AI configuration row is missing. Reload database/seed.sql.');
  return row;
}

async function updateAiConfig(actor, payload) {
  const current = await getAiConfig();

  const assignments = [];
  const params = [];
  const push = (column, value) => { params.push(value); assignments.push(`${column} = $${params.length}`); };

  const numeric = [
    'weight_moisture_deficit', 'weight_temperature', 'weight_humidity', 'weight_trend',
    'weight_time_since_irrigation', 'penalty_recent_irrigation', 'irrigate_score_threshold',
    'sensor_disagreement_pct', 'schedule_minutes', 'duration_factor',
  ];
  for (const column of numeric) {
    if (payload[column] !== undefined) push(column, payload[column]);
  }
  if (payload.llm_enabled !== undefined) push('llm_enabled', payload.llm_enabled);
  if (payload.llm_model !== undefined) push('llm_model', payload.llm_model);

  if (!assignments.length) return current;

  params.push(actor.id);
  assignments.push(`updated_by = $${params.length}`);

  await db.query(`UPDATE ai_config SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = 'ai-default'`, params);
  return getAiConfig();
}

/** Thresholds of an area keyed by sensor type, for the recommender. */
async function thresholdsFor(areaId) {
  const rows = await db.rows(
    `SELECT sensor_type, min_value, max_value, unit FROM thresholds WHERE area_id = $1`,
    [areaId],
  );
  return Object.fromEntries(rows.map((r) => [r.sensor_type, r]));
}

/**
 * Produce (and store) a recommendation for one area.
 *
 * @param {string}  areaId
 * @param {boolean} force  run now and replace the pending recommendation of the area
 */
async function generateForArea(areaId, { force = false } = {}) {
  const area = await db.one('SELECT id, name, mode FROM areas WHERE id = $1 AND is_active', [areaId]);
  if (!area) throw notFound(`No active area with id "${areaId}".`);

  const pending = await db.one(
    `SELECT * FROM recommendations WHERE area_id = $1 AND status = 'PENDING'`,
    [areaId],
  );

  if (pending && !force) {
    return { created: false, reason: 'A recommendation is already pending for this area.', recommendation: pending };
  }
  // A forced run replaces the stale pending recommendation instead of adding
  // a second one: the producer must never be able to accept two irrigations
  // for the same situation.
  if (pending && force) {
    await db.query("UPDATE recommendations SET status = 'EXPIRED' WHERE id = $1 AND status = 'PENDING'", [pending.id]);
  }

  const [aiConfig, thresholds, irrigationConfig] = await Promise.all([
    getAiConfig(),
    thresholdsFor(areaId),
    db.one('SELECT * FROM irrigation_config WHERE area_id = $1', [areaId]),
  ]);

  if (!irrigationConfig) {
    return { created: false, reason: 'The area has no irrigation configuration.', recommendation: null };
  }

  const features = await preprocessing.buildFeatures(areaId, 24);

  // Without any soil-moisture history there is nothing to reason about.
  if (features.soil_moisture === null) {
    return { created: false, reason: 'No soil-moisture data is available for this area.', recommendation: null };
  }

  const result = recommender.recommend(features, {
    thresholds,
    irrigation: irrigationConfig,
    aiConfig,
  });

  const explanation = await explainer.explain(result, areaId, aiConfig);

  const stored = await db.withTransaction(async (client) => {
    if (pending && force) {
      await client.query(`UPDATE recommendations SET status = 'EXPIRED' WHERE id = $1`, [pending.id]);
    }

    const inserted = await client.query(
      `INSERT INTO recommendations
          (area_id, type, score, confidence, recommended_duration_min,
           inputs, factors,
           recommendation, reason, relevant_measurements, confidence_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [areaId, result.type, result.score, result.confidence, result.recommended_duration_min,
        JSON.stringify(result.inputs), JSON.stringify(result.factors),
        explanation.recommendation, explanation.reason,
        JSON.stringify(explanation.relevant_measurements), explanation.confidence_text],
    );
    return inserted.rows[0];
  });

  logSystem('INFO', 'recommender',
    `${result.type} recommendation for ${areaId} (score ${result.score}, confidence ${explanation.confidence_text}).`,
    { recommendation_id: stored.id });

  return { created: true, recommendation: stored, result, explanation };
}

/** Run the generation over every active area. */
async function generateAll({ force = false } = {}) {
  const areas = await db.rows('SELECT id FROM areas WHERE is_active');
  const outcomes = [];

  for (const area of areas) {
    try {
      outcomes.push({ area_id: area.id, ...(await generateForArea(area.id, { force })) });
    } catch (err) {
      logSystem('ERROR', 'recommender', `Generation failed for ${area.id}: ${err.message}`);
      outcomes.push({ area_id: area.id, created: false, reason: err.message });
    }
  }
  return outcomes;
}

/** GET /api/recommendations */
async function list({ status = null, areaId = null, limit = 50, offset = 0 } = {}) {
  return db.rows(
    `SELECT r.*, a.name AS area_name, u.email AS decided_by_email
       FROM recommendations r
       JOIN areas a ON a.id = r.area_id
       LEFT JOIN users u ON u.id = r.decided_by
      WHERE ($1::text IS NULL OR r.status  = $1)
        AND ($2::text IS NULL OR r.area_id = $2)
      ORDER BY r.created_at DESC
      LIMIT $3 OFFSET $4`,
    [status, areaId, limit, offset],
  );
}

async function getById(id) {
  const row = await db.one(
    `SELECT r.*, a.name AS area_name, u.email AS decided_by_email
       FROM recommendations r
       JOIN areas a ON a.id = r.area_id
       LEFT JOIN users u ON u.id = r.decided_by
      WHERE r.id = $1`,
    [id],
  );
  if (!row) throw notFound(`No recommendation with id "${id}".`);
  return row;
}

/**
 * POST /api/recommendations/:id/decision (US26-T1).
 *
 * A recommendation can be decided exactly once: a second attempt returns 409.
 * Accepting an IRRIGATE recommendation queues the irrigation command with
 * source AI, which US26-T3 verifies end to end.
 */
async function decide(id, user, { decision, comment = null }) {
  const current = await getById(id);

  if (current.status !== 'PENDING') {
    throw conflict(
      `This recommendation was already ${current.status.toLowerCase()} and cannot be decided again.`,
      [{ field: 'status', issue: `Current status: ${current.status}.` }],
    );
  }

  const updated = await db.one(
    `UPDATE recommendations
        SET status = $1, decided_by = $2, decided_at = NOW(), decision_comment = $3
      WHERE id = $4
      RETURNING *`,
    [decision, user.id, comment, id],
  );

  let command = null;

  if (decision === 'ACCEPTED' && current.type === 'IRRIGATE') {
    const pumps = await db.rows(
      `SELECT id FROM actuators WHERE area_id = $1 AND type = 'irrigation_pump' AND is_active LIMIT 1`,
      [current.area_id],
    );

    if (!pumps.length) {
      throw badRequest('The area has no active irrigation pump to execute this recommendation.', [
        { field: 'area_id', issue: `No irrigation pump registered in "${current.area_id}".` },
      ]);
    }

    command = await commands.createCommand({
      actuatorId: pumps[0].id,
      action: 'ON',
      durationMin: current.recommended_duration_min,
      source: 'AI',
      user,
      reason: `Accepted AI recommendation ${current.id}: ${current.recommendation}`,
      // An accepted recommendation may run in AUTOMATIC mode too: the
      // producer explicitly authorised this action.
      enforceManualMode: false,
    });
  }

  logSystem('INFO', 'recommender',
    `Recommendation ${id} ${decision.toLowerCase()} by ${user.email}.`,
    { command_id: command ? command.id : null });

  return { recommendation: updated, command };
}

module.exports = {
  generateForArea,
  generateAll,
  list,
  getById,
  decide,
  getAiConfig,
  updateAiConfig,
  thresholdsFor,
};
