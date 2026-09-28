'use strict';

const service = require('./service');
const commandsService = require('../commands/service');
const eventsService = require('../events/service');
const audit = require('../../middleware/audit');
const { asyncHandler, p, q } = require('../../utils/http');

/** GET /api/actuators/status */
const status = asyncHandler(async (req, res) => {
  res.json(await service.status(req.user, { areaId: q(req).area_id || null }));
});

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.user, { areaId: q(req).area_id || null }));
});

const getById = asyncHandler(async (req, res) => res.json(await service.getById(req.user, p(req).id)));

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'actuators', created.id, null, created);
  res.status(201).json(created);
});

const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'actuators', id, before, after);
  res.json(after);
});

/**
 * POST /api/actuators/:id/command — manual control (US15-T2).
 * Allowed only while the area is in MANUAL mode.
 */
const sendCommand = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const command = await commandsService.createCommand({
    actuatorId: id,
    action: req.body.action,
    durationMin: req.body.duration_min ?? null,
    source: 'MANUAL',
    user: req.user,
    reason: req.body.reason || 'Manual control from the dashboard.',
    enforceManualMode: true,
  });

  audit.record(req, 'COMMAND', 'actuators', id, null,
    { action: command.action, duration_min: command.duration_min, source: 'MANUAL' });

  res.status(201).json(command);
});

/**
 * POST /api/actuators/:id/state — the device confirms execution (US15-T3).
 * Authenticated with the device API key.
 */
const reportState = asyncHandler(async (req, res) => {
  const result = await commandsService.reportState({
    actuatorId: p(req).id,
    state: req.body.state,
    deviceId: req.device.id,
    durationMin: req.body.duration_min ?? null,
  });

  res.json({
    actuator_id: result.actuator.id,
    state: result.actuator.state,
    last_update: result.actuator.last_update,
    command_id: result.command ? result.command.id : null,
  });
});

/** GET /api/actuators/events — actuation and irrigation history (US17-T2). */
const listEvents = asyncHandler(async (req, res) => {
  const { actuator_id: actuatorId, area_id: areaId, source, from, to, limit, offset } = q(req);
  res.json(await eventsService.list({
    actuatorId: actuatorId || null,
    areaId: areaId || null,
    source: source || null,
    from: from || null,
    to: to || null,
    limit: limit || 200,
    offset: offset || 0,
  }));
});

/** GET /api/actuators/:id/commands — recent command history. */
const listCommands = asyncHandler(async (req, res) => {
  await service.getById(req.user, p(req).id);
  res.json(await commandsService.listForActuator(p(req).id, q(req).limit || 50));
});

module.exports = { status, list, getById, create, update, sendCommand, reportState, listEvents, listCommands };
