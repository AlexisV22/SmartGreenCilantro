'use strict';

/**
 * Automation engine (US16-T3, FR-18).
 *
 * Runs every 30 seconds over the areas in AUTOMATIC mode:
 *   1. the irrigation decision, with its safety conditions (US-16)
 *   2. the generic rules for fans, shade and lighting (FR-18)
 *
 * The decision itself lives in the services, so the same logic is exercised
 * by the unit tests without a scheduler.
 */

const db = require('../db');
const irrigation = require('../modules/irrigation/service');
const automation = require('../modules/automation/service');
const { logSystem } = require('../utils/logger');

const NAME = 'automationEngine';
// node-cron supports seconds as an optional sixth field.
const SCHEDULE = '*/30 * * * * *';

async function run() {
  const areas = await db.rows(
    `SELECT a.id, a.name, a.mode
       FROM areas a
      WHERE a.is_active AND a.mode = 'AUTOMATIC'`,
  );

  const results = [];

  for (const area of areas) {
    try {
      const decision = await irrigation.decide(area);
      const applied = await irrigation.apply(area, decision);
      const ruleActions = await automation.evaluateArea(area);

      results.push({ area_id: area.id, irrigation: applied, rules: ruleActions });
    } catch (err) {
      logSystem('ERROR', NAME, `Automation failed for area ${area.id}: ${err.message}`);
    }
  }

  return results;
}

module.exports = { NAME, SCHEDULE, run };
