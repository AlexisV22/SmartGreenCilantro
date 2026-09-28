'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams } = require('../../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });

const rangeFields = {
  temperature_min: z.number().optional(),   temperature_max: z.number().optional(),
  air_humidity_min: z.number().optional(),  air_humidity_max: z.number().optional(),
  soil_moisture_min: z.number().optional(), soil_moisture_max: z.number().optional(),
  light_min: z.number().optional(),         light_max: z.number().optional(),
  co2_min: z.number().optional(),           co2_max: z.number().optional(),
  ph_min: z.number().optional(),            ph_max: z.number().optional(),
  water_level_min: z.number().optional(),   water_level_max: z.number().optional(),
};

const createSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(2, 'The crop name is required.'),
  description: z.string().optional(),
  default_crop_stage: z.string().min(1).optional(),
  ...rangeFields,
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  default_crop_stage: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  ...rangeFields,
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

const applySchema = z.object({ area_id: z.string().min(1) });

router.get('/', requirePermission('crops.read'), controller.list);
router.get('/:id', requirePermission('crops.read'), validateParams(idParam), controller.getById);
router.post('/', requirePermission('crops.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('crops.write'), validateParams(idParam), validateBody(updateSchema), controller.update);
router.post('/:id/apply', requirePermission('crops.write'), validateParams(idParam), validateBody(applySchema), controller.applyToArea);

module.exports = router;
