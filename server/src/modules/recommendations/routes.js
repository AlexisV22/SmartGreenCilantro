'use strict';

const express = require('express');
const { z } = require('zod');

const service = require('./service');
const audit = require('../../middleware/audit');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');
const { asyncHandler, p, q } = require('../../utils/http');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']).optional(),
  area_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const generateSchema = z.object({
  area_id: z.string().min(1).optional(),
  force: z.boolean().optional(),
});

const decisionSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  comment: z.string().max(1000).optional(),
});

/** GET /api/recommendations?status&area_id */
router.get('/', requirePermission('recommendations.read'), validateQuery(listQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await service.list({
    status: query.status || null,
    areaId: query.area_id || null,
    limit: query.limit || 50,
    offset: query.offset || 0,
  }));
}));

router.get('/:id', requirePermission('recommendations.read'), validateParams(idParam), asyncHandler(async (req, res) => {
  res.json(await service.getById(p(req).id));
}));

/** POST /api/recommendations/generate — Administrator forces a run (US20-T4). */
router.post('/generate', requirePermission('recommendations.generate'), validateBody(generateSchema.partial()), asyncHandler(async (req, res) => {
  const { area_id: areaId, force } = req.body || {};
  const result = areaId
    ? [{ area_id: areaId, ...(await service.generateForArea(areaId, { force: force === true })) }]
    : await service.generateAll({ force: force === true });

  audit.record(req, 'GENERATE', 'recommendations', areaId || 'all', null, { count: result.length });
  res.status(201).json(result);
}));

/** POST /api/recommendations/:id/decision — accept or reject (US26-T1). */
router.post('/:id/decision', requirePermission('recommendations.decide'), validateParams(idParam), validateBody(decisionSchema), asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(id);
  const result = await service.decide(id, req.user, req.body);

  audit.record(req, 'DECISION', 'recommendations', id,
    { status: before.status },
    { status: result.recommendation.status, command_id: result.command ? result.command.id : null });

  res.json(result);
}));

module.exports = router;
