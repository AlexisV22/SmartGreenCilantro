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
  name: z.string().min(3, 'The role name must have at least 3 characters.'),
  description: z.string().optional(),
  permissions: z.array(z.string().min(1)).optional(),
});

const updateSchema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
});

const permissionsSchema = z.object({
  permissions: z.array(z.string().min(1)),
});

// Reading the matrix is allowed to anyone who can see roles (the admin UI
// renders it read-only); editing is restricted to roles.write.
router.get('/', requirePermission('roles.read'), controller.list);
router.get('/permissions', requirePermission('roles.read'), controller.listPermissions);
router.get('/:id', requirePermission('roles.read'), validateParams(idParam), controller.getById);
router.post('/', requirePermission('roles.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('roles.write'), validateParams(idParam), validateBody(updateSchema), controller.update);
router.put('/:id/permissions', requirePermission('roles.write'), validateParams(idParam), validateBody(permissionsSchema), controller.setPermissions);

module.exports = router;
