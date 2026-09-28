'use strict';

/**
 * AI configuration (US20-T4, US-306).
 * Editable by the Administrator and the Super Administrator; a change takes
 * effect on the next recommendation run.
 */

const express = require('express');
const { z } = require('zod');

const service = require('../recommendations/service');
const audit = require('../../middleware/audit');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();
router.use(requireAuth);

const configSchema = z.object({
  weight_moisture_deficit: z.number().min(0).max(100).optional(),
  weight_temperature: z.number().min(0).max(100).optional(),
  weight_humidity: z.number().min(0).max(100).optional(),
  weight_trend: z.number().min(0).max(100).optional(),
  weight_time_since_irrigation: z.number().min(0).max(100).optional(),
  penalty_recent_irrigation: z.number().min(0).max(100).optional(),
  irrigate_score_threshold: z.number().min(0).max(100).optional(),
  sensor_disagreement_pct: z.number().min(0).max(100).optional(),
  schedule_minutes: z.number().int().min(1).max(1440).optional(),
  duration_factor: z.number().min(0).max(10).optional(),
  llm_enabled: z.boolean().optional(),
  llm_model: z.string().min(1).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one parameter to update.' });

router.get('/config', requirePermission('ai.read'), asyncHandler(async (_req, res) => {
  res.json(await service.getAiConfig());
}));

router.put('/config', requirePermission('ai.write'), validateBody(configSchema), asyncHandler(async (req, res) => {
  const before = await service.getAiConfig();
  const after = await service.updateAiConfig(req.user, req.body);
  audit.record(req, 'UPDATE', 'ai_config', 'ai-default', before, after);
  res.json(after);
}));

module.exports = router;
