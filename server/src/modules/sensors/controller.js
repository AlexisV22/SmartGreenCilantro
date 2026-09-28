'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p, q } = require('../../utils/http');

const list = asyncHandler(async (req, res) => {
  const { area_id: areaId, device_id: deviceId, type } = q(req);
  res.json(await service.list(req.user, { areaId: areaId || null, deviceId: deviceId || null, type: type || null }));
});

const getById = asyncHandler(async (req, res) => res.json(await service.getById(req.user, p(req).id)));

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'sensors', created.id, null, created);
  res.status(201).json(created);
});

const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'sensors', id, before, after);
  res.json(after);
});

module.exports = { list, getById, create, update };
