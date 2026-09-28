'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission, requireRole, SUPER_ADMIN } = require('../../middleware/rbac');
const { validateBody, validateQuery, validateParams } = require('../../middleware/validate');

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  email: z.string().email('A valid email address is required.'),
  username: z.string().min(3, 'The username must have at least 3 characters.'),
  full_name: z.string().min(1).optional(),
  password: z.string().min(1, 'A password is required.'),
  role: z.enum(['SuperAdministrator', 'Administrator', 'Producer']),
  organization_id: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).optional(),
  full_name: z.string().min(1).nullable().optional(),
  password: z.string().min(1).optional(),
  role: z.enum(['SuperAdministrator', 'Administrator', 'Producer']).optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' });

const statusSchema = z.object({ is_active: z.boolean() });

const listQuery = z.object({
  role: z.enum(['SuperAdministrator', 'Administrator', 'Producer']).optional(),
});

// --- /api/users (Administrator manages producers, Super Administrator all) --
const usersRouter = express.Router();
usersRouter.use(requireAuth);

usersRouter.get('/', requirePermission('users.read'), validateQuery(listQuery), controller.list);
usersRouter.get('/:id', requirePermission('users.read'), validateParams(idParam), controller.getById);
usersRouter.post('/', requirePermission('users.write'), validateBody(createSchema), controller.create);
usersRouter.put('/:id', requirePermission('users.write'), validateParams(idParam), validateBody(updateSchema), controller.update);
usersRouter.patch('/:id/status', requirePermission('users.write'), validateParams(idParam), validateBody(statusSchema), controller.setStatus);

// --- /api/admins (US-23, Super Administrator only) -------------------------
const adminsRouter = express.Router();
adminsRouter.use(requireAuth, requireRole(SUPER_ADMIN));

adminsRouter.get('/', requirePermission('admins.read'), controller.listAdmins);
adminsRouter.post('/', requirePermission('admins.write'),
  validateBody(createSchema.partial({ role: true })), controller.createAdmin);
adminsRouter.put('/:id', requirePermission('admins.write'),
  validateParams(idParam), validateBody(updateSchema), controller.update);

module.exports = { usersRouter, adminsRouter };
