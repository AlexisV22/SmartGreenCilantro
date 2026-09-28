'use strict';

const service = require('./service');
const commandsService = require('../commands/service');
const audit = require('../../middleware/audit');
const { asyncHandler, p } = require('../../utils/http');

const list = asyncHandler(async (req, res) => res.json(await service.list(req.user)));

const getById = asyncHandler(async (req, res) => res.json(await service.getById(req.user, p(req).id)));

/** POST /api/devices — returns the plain API key once (US25-T4). */
const create = asyncHandler(async (req, res) => {
  await service.assertAreaVisible(req.user, req.body.area_id);
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'devices', created.id, null, audit.scrub({ ...created, api_key: '[redacted]' }));
  res.status(201).json(created);
});

/** PUT /api/devices/:id — edit metadata or deactivate; never delete. */
const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  await service.assertAreaVisible(req.user, req.body.area_id);
  const before = await service.getById(req.user, id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'devices', id, audit.scrub(before), audit.scrub(after));
  res.json(after);
});

/** POST /api/devices/:id/rotate-key — revoke and reissue the device key. */
const rotateKey = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const result = await service.rotateKey(req.user, id);
  audit.record(req, 'ROTATE_KEY', 'devices', id, null, { rotated: true });
  res.json(result);
});

/** POST /api/devices/heartbeat — device authenticated with its API key. */
const heartbeat = asyncHandler(async (req, res) => {
  res.json(await service.heartbeat(req.device, req.body || {}));
});

/** GET /api/devices/me/commands — polling endpoint of the firmware (US15-T3). */
const myCommands = asyncHandler(async (req, res) => {
  const commands = await commandsService.collectForDevice(req.device.id);
  res.json({
    device_id: req.device.id,
    server_time: new Date().toISOString(),
    count: commands.length,
    commands,
  });
});

module.exports = { list, getById, create, update, rotateKey, heartbeat, myCommands };
