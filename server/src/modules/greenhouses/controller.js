'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p } = require('../../utils/http');

const list = asyncHandler(async (req, res) => res.json(await service.list(req.user)));

const getById = asyncHandler(async (req, res) => res.json(await service.getById(req.user, p(req).id)));

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'greenhouses', created.id, null, created);
  res.status(201).json(created);
});

const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'greenhouses', id, before, after);
  res.json(after);
});

module.exports = { list, getById, create, update };
