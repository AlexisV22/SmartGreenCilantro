'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const areaParam = z.object({ areaId: z.string().min(1) });

const configSchema = z.object({
  enabled: z.boolean().optional(),
  target_moisture: z.number().optional(),
  max_duration_min: z.number().optional(),
  cooldown_min: z.number().optional(),
  consecutive_readings: z.number().int().optional(),
  min_tank_level: z.number().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one parameter to update.' });

const dailyQuery = z.object({
  area_id: z.string().min(1).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

router.get('/config/:areaId', requirePermission('irrigation.read'), validateParams(areaParam), controller.getConfig);
router.put('/config/:areaId', requirePermission('irrigation.write'), validateParams(areaParam), validateBody(configSchema), controller.updateConfig);
router.get('/daily-minutes', requirePermission('irrigation.read'), validateQuery(dailyQuery), controller.dailyMinutes);
router.get('/status/:areaId', requirePermission('irrigation.read'), validateParams(areaParam), controller.status);

module.exports = router;
