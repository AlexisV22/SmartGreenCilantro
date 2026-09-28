'use strict';

/**
 * Housekeeping of alerts and commands.
 *
 *   * expires commands the device never collected (US15-T5)
 *   * resolves ANOMALY alerts once the sensor reports normally again
 *   * expires stale PENDING recommendations so the producer is not shown a
 *     decision based on readings that are hours old (US-20)
 */

const db = require('../db');
const settings = require('../utils/settings');
const commands = require('../modules/commands/service');
const { logSystem } = require('../utils/logger');

const NAME = 'alertResolver';
const SCHEDULE = '* * * * *';

async function run() {
  const expiredCommands = await commands.expireStale();

  // An ANOMALY alert closes when the sensor produced clean readings for a
  // full missing-data window.
  const missingMinutes = await settings.getNumber('anomaly.missing_data_minutes', 5);
  const resolvedAnomalies = await db.query(
    `UPDATE alerts a
        SET status = 'RESOLVED', resolved_at = NOW()
      WHERE a.type = 'ANOMALY'
        AND a.status IN ('OPEN', 'ACKNOWLEDGED')
        AND NOT EXISTS (
              SELECT 1 FROM anomalies an
               WHERE an.sensor_id = a.sensor_id
                 AND an.detected_at > NOW() - ($1 || ' minutes')::interval)
      RETURNING a.id`,
    [String(missingMinutes * 2)],
  );

  // A recommendation older than four scheduled runs no longer reflects the
  // greenhouse: mark it EXPIRED so a fresh one can be produced.
  const aiConfig = await db.one('SELECT schedule_minutes FROM ai_config WHERE id = $1', ['ai-default']);
  const staleMinutes = (aiConfig ? Number(aiConfig.schedule_minutes) : 15) * 4;
  const expiredRecommendations = await db.query(
    `UPDATE recommendations
        SET status = 'EXPIRED'
      WHERE status = 'PENDING' AND created_at < NOW() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(staleMinutes)],
  );

  if (expiredCommands || resolvedAnomalies.rowCount || expiredRecommendations.rowCount) {
    logSystem('INFO', NAME,
      `Housekeeping: ${expiredCommands} command(s) expired, ${resolvedAnomalies.rowCount} anomaly alert(s) resolved, ${expiredRecommendations.rowCount} recommendation(s) expired.`);
  }

  return {
    expiredCommands,
    resolvedAnomalyAlerts: resolvedAnomalies.rowCount,
    expiredRecommendations: expiredRecommendations.rowCount,
  };
}

module.exports = { NAME, SCHEDULE, run };
