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

const createSchema = z.object({
  id: z.string().min(1, 'A greenhouse identifier is required (for example GH-02).'),
  name: z.string().min(2),
  location: z.string().optional(),
  organization_id: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  location: z.string().optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

router.get('/', requirePermission('greenhouses.read'), controller.list);
router.get('/:id', requirePermission('greenhouses.read'), validateParams(idParam), controller.getById);
router.post('/', requirePermission('greenhouses.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('greenhouses.write'), validateParams(idParam), validateBody(updateSchema), controller.update);

module.exports = router;
