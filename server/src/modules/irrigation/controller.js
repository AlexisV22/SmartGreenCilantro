'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p, q } = require('../../utils/http');

/** GET /api/irrigation/config/:areaId */
const getConfig = asyncHandler(async (req, res) => {
  res.json(await service.getConfig(p(req).areaId));
});

/** PUT /api/irrigation/config/:areaId — Administrator only (US16-T2). */
const updateConfig = asyncHandler(async (req, res) => {
  const areaId = p(req).areaId;
  const before = await service.getConfig(areaId);
  const after = await service.updateConfig(req.user, areaId, req.body);
  audit.record(req, 'UPDATE', 'irrigation_config', areaId, before, after);
  res.json(after);
});

/** GET /api/irrigation/daily-minutes?area_id&days */
const dailyMinutes = asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await service.dailyMinutes({
    areaId: query.area_id || null,
    days: query.days || 30,
  }));
});

/**
 * GET /api/irrigation/status/:areaId — what the engine would do right now.
 * Used by the dashboard to explain why irrigation is or is not running.
 */
const status = asyncHandler(async (req, res) => {
  const areaId = p(req).areaId;
  const db = require('../../db');
  const area = await db.one('SELECT id, name, mode FROM areas WHERE id = $1', [areaId]);
  if (!area) {
    const { notFound } = require('../../middleware/errors');
    throw notFound(`No area with id "${areaId}".`);
  }

  const decision = await service.decide(area);
  const config = await service.getConfig(areaId);
  const tank = await service.tankLevel(areaId);
  const lastAt = await service.lastIrrigationAt(areaId);

  res.json({
    area_id: areaId,
    mode: area.mode,
    config,
    tank_level: tank ? Number(tank.value) : null,
    last_irrigation_at: lastAt,
    decision,
  });
});

module.exports = { getConfig, updateConfig, dailyMinutes, status };
