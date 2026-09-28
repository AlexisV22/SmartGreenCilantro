'use strict';

const express = require('express');
const { z } = require('zod');

const service = require('./service');
const audit = require('../../middleware/audit');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');
const { asyncHandler, p, q } = require('../../utils/http');
const { SENSOR_TYPES } = require('../sensors/service');
const { ACTUATOR_TYPES } = require('../actuators/service');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });
const listQuery = z.object({ area_id: z.string().min(1).optional() });

const createSchema = z.object({
  area_id: z.string().min(1),
  name: z.string().min(3),
  sensor_type: z.enum(SENSOR_TYPES),
  condition: z.enum(['ABOVE_MAX', 'BELOW_MIN']),
  actuator_type: z.enum(ACTUATOR_TYPES),
  action: z.enum(['ON', 'OFF']),
  hysteresis: z.number().nonnegative().optional(),
  active_from_hour: z.number().int().min(0).max(23).nullable().optional(),
  active_to_hour: z.number().int().min(1).max(24).nullable().optional(),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(3).optional(),
  condition: z.enum(['ABOVE_MAX', 'BELOW_MIN']).optional(),
  action: z.enum(['ON', 'OFF']).optional(),
  hysteresis: z.number().nonnegative().optional(),
  active_from_hour: z.number().int().min(0).max(23).nullable().optional(),
  active_to_hour: z.number().int().min(1).max(24).nullable().optional(),
  enabled: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

router.get('/', requirePermission('automation.read'), validateQuery(listQuery), asyncHandler(async (req, res) => {
  res.json(await service.list({ areaId: q(req).area_id || null }));
}));

router.post('/', requirePermission('automation.write'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'automation_rules', created.id, null, created);
  res.status(201).json(created);
}));

router.put('/:id', requirePermission('automation.write'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'automation_rules', id, before, after);
  res.json(after);
}));

module.exports = router;
