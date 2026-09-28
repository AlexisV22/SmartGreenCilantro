'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requireDeviceKey } = require('../../middleware/apiKey');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams } = require('../../middleware/validate');

const router = express.Router();

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(2, 'A device name is required.'),
  mac_address: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, 'Expected a MAC address such as A4:CF:12:89:56:B2.').optional(),
  location: z.string().optional(),
  greenhouse_id: z.string().min(1).optional(),
  area_id: z.string().min(1).optional(),
  organization_id: z.string().min(1).optional(),
  firmware: z.string().optional(),
  is_active: z.boolean().optional(),
  // Accepted for compatibility with the API specification example; sensors
  // are registered through /api/sensors.
  sensors_attached: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  location: z.string().optional(),
  greenhouse_id: z.string().min(1).optional(),
  area_id: z.string().min(1).optional(),
  firmware: z.string().optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

const heartbeatSchema = z.object({ firmware: z.string().optional() }).passthrough();

// --- Device-authenticated endpoints (apikey header) ------------------------
// Declared before the "/:id" routes so "me" is never read as a device id.
router.get('/me/commands', requireDeviceKey, controller.myCommands);
router.post('/heartbeat', requireDeviceKey, validateBody(heartbeatSchema), controller.heartbeat);

// --- User-authenticated endpoints (Bearer token) ---------------------------
router.get('/', requireAuth, requirePermission('devices.read'), controller.list);
router.get('/:id', requireAuth, requirePermission('devices.read'), validateParams(idParam), controller.getById);
router.post('/', requireAuth, requirePermission('devices.write'), validateBody(createSchema), controller.create);
router.put('/:id', requireAuth, requirePermission('devices.write'), validateParams(idParam), validateBody(updateSchema), controller.update);
router.post('/:id/rotate-key', requireAuth, requirePermission('devices.write'), validateParams(idParam), controller.rotateKey);

module.exports = router;
