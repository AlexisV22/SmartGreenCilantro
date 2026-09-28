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

const listQuery = z.object({
  sensor_id: z.string().min(1).optional(),
  area_id: z.string().min(1).optional(),
  method: z.enum(['OUT_OF_RANGE', 'SUDDEN_JUMP', 'ZSCORE', 'MISSING_DATA', 'FLATLINE']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** GET /api/anomalies — recent anomalies with their plain-language reason. */
router.get('/', requirePermission('anomalies.read'), validateQuery(listQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await service.list({
    sensorId: query.sensor_id || null,
    areaId: query.area_id || null,
    method: query.method || null,
    from: query.from || null,
    to: query.to || null,
    limit: query.limit || 100,
    offset: query.offset || 0,
  }));
}));

module.exports = router;
