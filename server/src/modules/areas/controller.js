'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p, q } = require('../../utils/http');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.user, { greenhouseId: q(req).greenhouse_id || null }));
});

const getById = asyncHandler(async (req, res) => res.json(await service.getById(req.user, p(req).id)));

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'areas', created.id, null, created);
  res.status(201).json(created);
});

const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'areas', id, before, after);
  res.json(after);
});

/** PATCH /api/areas/:id/mode — switch MANUAL / AUTOMATIC (US15-T4). */
const setMode = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.setMode(req.user, id, req.body.mode);
  audit.record(req, 'UPDATE_MODE', 'areas', id, { mode: before.mode }, { mode: after.mode });
  res.json(after);
});

module.exports = { list, getById, create, update, setMode };
