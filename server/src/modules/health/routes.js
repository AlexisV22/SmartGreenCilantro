'use strict';

/**
 * GET /api/health — public availability probe.
 *
 * Used by the Super Administrator availability page and by the deployment
 * platform health check (US-27, "Monitor overall system availability").
 */

const express = require('express');
const db = require('../../db');
const config = require('../../config');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();
const startedAt = Date.now();

router.get('/', asyncHandler(async (_req, res) => {
  const dbConnected = await db.isHealthy();

  let activeDevices = null;
  let onlineDevices = null;
  if (dbConnected) {
    const row = await db.one(
      `SELECT COUNT(*) FILTER (WHERE is_active)                                              AS active,
              COUNT(*) FILTER (WHERE is_active AND last_seen > NOW() - INTERVAL '5 minutes') AS online
         FROM devices`,
    );
    activeDevices = Number(row.active);
    onlineDevices = Number(row.online);
  }

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    version: config.version,
    environment: config.env,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    database: { connected: dbConnected },
    devices: { active: activeDevices, online: onlineDevices },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
