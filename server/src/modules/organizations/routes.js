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
  id: z.string().min(1).optional(),
  name: z.string().min(2, 'The organization name is required.'),
  contact_email: z.string().email().optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  contact_email: z.string().email().optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

router.get('/', requirePermission('organizations.read'), controller.list);
router.get('/:id', requirePermission('organizations.read'), validateParams(idParam), controller.getById);
router.post('/', requirePermission('organizations.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('organizations.write'), validateParams(idParam), validateBody(updateSchema), controller.update);

module.exports = router;
