'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const measurementsController = require('../measurements/controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');
const { SENSOR_TYPES } = require('./service');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  area_id: z.string().min(1).optional(),
  device_id: z.string().min(1).optional(),
  type: z.enum(SENSOR_TYPES).optional(),
});

const historyQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
  include_anomalies: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  id: z.string().min(1, 'A sensor identifier is required (for example SM-03).'),
  device_id: z.string().min(1),
  area_id: z.string().min(1),
  name: z.string().min(2),
  type: z.enum(SENSOR_TYPES),
  unit: z.string().min(1),
  physical_min: z.number(),
  physical_max: z.number(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  unit: z.string().min(1).optional(),
  area_id: z.string().min(1).optional(),
  physical_min: z.number().optional(),
  physical_max: z.number().optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

router.get('/', requirePermission('sensors.read'), validateQuery(listQuery), controller.list);
router.get('/:id', requirePermission('sensors.read'), validateParams(idParam), controller.getById);
// History of one sensor — the path fixed by the API specification (US-06, US-10).
router.get('/:id/measurements', requirePermission('measurements.read'),
  validateParams(idParam), validateQuery(historyQuery), measurementsController.historyBySensor);
router.post('/', requirePermission('sensors.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('sensors.write'), validateParams(idParam), validateBody(updateSchema), controller.update);

module.exports = router;
