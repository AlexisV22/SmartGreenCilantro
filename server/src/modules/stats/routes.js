'use strict';

/**
 * Platform statistics (Administrator "view system statistics", and the
 * Super Administrator availability page).
 */

const express = require('express');
const db = require('../../db');
const config = require('../../config');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();
router.use(requireAuth);

const startedAt = Date.now();

router.get('/', requirePermission('stats.read'), asyncHandler(async (_req, res) => {
  const [counts, perDay, alertsBySeverity, recommendations] = await Promise.all([
    db.one(`
      SELECT (SELECT COUNT(*) FROM organizations)                                     AS organizations,
             (SELECT COUNT(*) FROM greenhouses)                                       AS greenhouses,
             (SELECT COUNT(*) FROM areas)                                             AS areas,
             (SELECT COUNT(*) FROM users WHERE is_active)                             AS active_users,
             (SELECT COUNT(*) FROM devices WHERE is_active)                           AS active_devices,
             (SELECT COUNT(*) FROM devices
               WHERE is_active AND last_seen > NOW() - INTERVAL '5 minutes')          AS online_devices,
             (SELECT COUNT(*) FROM sensors WHERE is_active)                           AS active_sensors,
             (SELECT COUNT(*) FROM actuators WHERE is_active)                         AS active_actuators,
             (SELECT COUNT(*) FROM measurements)                                      AS measurements,
             (SELECT COUNT(*) FROM alerts WHERE status IN ('OPEN','ACKNOWLEDGED'))    AS open_alerts,
             (SELECT COUNT(*) FROM anomalies
               WHERE detected_at > NOW() - INTERVAL '24 hours')                       AS anomalies_24h,
             (SELECT COUNT(*) FROM recommendations WHERE status = 'PENDING')          AS pending_recommendations
    `),
    db.rows(`
      SELECT date_trunc('day', recorded_at) AS day, COUNT(*)::int AS measurements
        FROM measurements
       WHERE recorded_at > NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1 ASC`),
    db.rows(`
      SELECT severity, status, COUNT(*)::int AS n
        FROM alerts
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY severity, status`),
    db.rows(`
      SELECT type, status, COUNT(*)::int AS n
        FROM recommendations
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY type, status`),
  ]);

  res.json({
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])),
    measurements_per_day: perDay,
    alerts_by_severity: alertsBySeverity,
    recommendations_by_type: recommendations,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    version: config.version,
    generated_at: new Date().toISOString(),
  });
}));

module.exports = router;
