'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requireDeviceKey } = require('../../middleware/apiKey');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams, validateQuery } = require('../../middleware/validate');
const { ACTUATOR_TYPES } = require('./service');

const router = express.Router();

const idParam = z.object({ id: z.string().min(1) });
const areaQuery = z.object({ area_id: z.string().min(1).optional() });

const eventsQuery = z.object({
  actuator_id: z.string().min(1).optional(),
  area_id: z.string().min(1).optional(),
  source: z.enum(['MANUAL', 'AUTOMATIC', 'AI', 'SYSTEM']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const commandSchema = z.object({
  action: z.enum(['ON', 'OFF']),
  duration_min: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

const stateSchema = z.object({
  state: z.enum(['ON', 'OFF']),
  duration_min: z.number().nonnegative().optional(),
});

const createSchema = z.object({
  id: z.string().min(1, 'An actuator identifier is required (for example ACT-FAN-02).'),
  device_id: z.string().min(1),
  area_id: z.string().min(1),
  name: z.string().min(2),
  type: z.enum(ACTUATOR_TYPES),
  state: z.enum(['ON', 'OFF', 'OFFLINE']).optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  area_id: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

// --- Device-authenticated endpoint ----------------------------------------
// Declared first so "/:id/state" is not shadowed by the user-authenticated
// "/:id" handlers.
router.post('/:id/state', requireDeviceKey, validateParams(idParam), validateBody(stateSchema), controller.reportState);

// --- User-authenticated endpoints -----------------------------------------
router.use(requireAuth);

router.get('/status', requirePermission('actuators.read'), validateQuery(areaQuery), controller.status);
router.get('/events', requirePermission('irrigation.read'), validateQuery(eventsQuery), controller.listEvents);
router.get('/', requirePermission('actuators.read'), validateQuery(areaQuery), controller.list);
router.get('/:id', requirePermission('actuators.read'), validateParams(idParam), controller.getById);
router.get('/:id/commands', requirePermission('actuators.read'), validateParams(idParam), controller.listCommands);
router.post('/', requirePermission('actuators.write'), validateBody(createSchema), controller.create);
router.put('/:id', requirePermission('actuators.write'), validateParams(idParam), validateBody(updateSchema), controller.update);
router.post('/:id/command', requirePermission('actuators.command'), validateParams(idParam), validateBody(commandSchema), controller.sendCommand);

module.exports = router;
