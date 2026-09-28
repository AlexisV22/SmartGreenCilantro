'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p } = require('../../utils/http');

const list = asyncHandler(async (_req, res) => res.json(await service.list()));

const listPermissions = asyncHandler(async (_req, res) => res.json(await service.listPermissions()));

const getById = asyncHandler(async (req, res) => res.json(await service.getById(p(req).id)));

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.body);
  audit.record(req, 'CREATE', 'roles', created.id, null, created);
  res.status(201).json(created);
});

const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(id);
  const after = await service.update(id, req.body);
  audit.record(req, 'UPDATE', 'roles', id, before, after);
  res.json(after);
});

/** PUT /api/roles/:id/permissions — the matrix editor of US-24. */
const setPermissions = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(id);
  const after = await service.setPermissions(id, req.body.permissions);
  audit.record(req, 'UPDATE_PERMISSIONS', 'roles', id, before, after);
  res.json(after);
});

module.exports = { list, getById, create, update, setPermissions, listPermissions };
