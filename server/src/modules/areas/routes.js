'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });
const listQuery = z.object({ greenhouse_id: z.string().min(1).optional() });

const createSchema = z.object({
  id: z.string().min(1, 'An area identifier is required (for example AREA-3).'),
  greenhouse_id: z.string().min(1),
  name: z.string().min(2),
  crop_type_id: z.string().min(1).optional(),
  crop_stage: z.string().min(1).optional(),
  mode: z.enum(['MANUAL', 'AUTOMATIC']).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  crop_type_id: z.string().min(1).optional(),
  crop_stage: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

const modeSchema = z.object({ mode: z.enum(['MANUAL', 'AUTOMATIC']) });

router.get('/', requirePermission('areas.read'), validateQuery(listQuery), controller.list);
router.get('/:id', requirePermission('areas.read'), validateParams(idParam), controller.getById);
router.post('/', requirePermission('areas.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('areas.write'), validateParams(idParam), validateBody(updateSchema), controller.update);
// The producer is allowed to switch the operating mode of an area (US15-T4).
router.patch('/:id/mode', requirePermission('areas.mode'), validateParams(idParam), validateBody(modeSchema), controller.setMode);

module.exports = router;
