'use strict';

const express = require('express');
const { z } = require('zod');

const service = require('./service');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateQuery } = require('../../middleware/validate');
const { asyncHandler, q } = require('../../utils/http');

const router = express.Router();
router.use(requireAuth);

const summaryQuery = z.object({
  area_id: z.string().min(1),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const trendsQuery = z.object({
  area_id: z.string().min(1),
  window: z.enum(['24h', '7d']).optional(),
});

router.get('/summary', requirePermission('analysis.read'), validateQuery(summaryQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await service.summary({
    areaId: query.area_id,
    from: query.from || null,
    to: query.to || null,
  }));
}));

router.get('/trends', requirePermission('analysis.read'), validateQuery(trendsQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await service.trendReport({ areaId: query.area_id, window: query.window || '24h' }));
}));

module.exports = router;
