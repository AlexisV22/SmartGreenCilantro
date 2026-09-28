'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');
const { SENSOR_TYPES } = require('../sensors/service');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  area_id: z.string().min(1).optional(),
  sensor_type: z.enum(SENSOR_TYPES).optional(),
});

const createSchema = z.object({
  area_id: z.string().min(1).optional(),
  greenhouse_id: z.string().min(1).optional(),
  sensor_type: z.enum(SENSOR_TYPES),
  min_value: z.number(),
  max_value: z.number(),
  unit: z.string().min(1),
  crop_stage: z.string().min(1).optional(),
});

const updateSchema = z.object({
  min_value: z.number().optional(),
  max_value: z.number().optional(),
  unit: z.string().min(1).optional(),
  crop_stage: z.string().min(1).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

// Producers may read the thresholds but never modify them (US10-T5).
router.get('/', requirePermission('thresholds.read'), validateQuery(listQuery), controller.list);
router.get('/:id', requirePermission('thresholds.read'), validateParams(idParam), controller.getById);
router.post('/', requirePermission('thresholds.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('thresholds.write'), validateParams(idParam), validateBody(updateSchema), controller.update);

module.exports = router;
