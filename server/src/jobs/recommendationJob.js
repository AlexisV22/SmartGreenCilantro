'use strict';

/**
 * Scheduled AI recommendation run (US20-T3).
 *
 * Runs every minute but only acts when `ai_config.schedule_minutes` has
 * elapsed since the last run, or when a new alert appeared since then — the
 * user story asks for both a cadence and an event trigger.
 */

const db = require('../db');
const recommendations = require('../modules/recommendations/service');
const { logSystem } = require('../utils/logger');

const NAME = 'recommendationJob';
const SCHEDULE = '* * * * *';

let lastRunAt = 0;

/** A new alert since the previous run is an immediate trigger. */
async function hasNewAlertSince(since) {
  if (!since) return false;
  const row = await db.one(
    `SELECT 1 FROM alerts WHERE created_at > $1 LIMIT 1`,
    [new Date(since).toISOString()],
  );
  return !!row;
}

async function run({ force = false } = {}) {
  const config = await recommendations.getAiConfig();
  const intervalMs = Number(config.schedule_minutes) * 60 * 1000;

  const dueBySchedule = Date.now() - lastRunAt >= intervalMs;
  const dueByAlert = await hasNewAlertSince(lastRunAt);

  if (!force && !dueBySchedule && !dueByAlert) return null;

  lastRunAt = Date.now();
  const outcomes = await recommendations.generateAll({ force: false });
  const created = outcomes.filter((o) => o.created).length;

  if (created) {
    logSystem('INFO', NAME,
      `Generated ${created} recommendation(s)${dueByAlert && !dueBySchedule ? ' (triggered by a new alert)' : ''}.`);
  }

  return outcomes;
}

/** Test hook: forget the cadence so the next run always executes. */
function reset() {
  lastRunAt = 0;
}

module.exports = { NAME, SCHEDULE, run, reset };
