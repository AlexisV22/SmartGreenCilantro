'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p } = require('../../utils/http');

const list = asyncHandler(async (_req, res) => res.json(await service.list()));

const getById = asyncHandler(async (req, res) => res.json(await service.getById(p(req).id)));

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.body);
  audit.record(req, 'CREATE', 'crop_types', created.id, null, created);
  res.status(201).json(created);
});

const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(id);
  const after = await service.update(id, req.body);
  audit.record(req, 'UPDATE', 'crop_types', id, before, after);
  res.json(after);
});

/** POST /api/crops/:id/apply — auto-configure the thresholds of an area. */
const applyToArea = asyncHandler(async (req, res) => {
  const result = await service.applyToArea(req.user, p(req).id, req.body.area_id);
  audit.record(req, 'APPLY_CROP', 'areas', req.body.area_id, null, result);
  res.json(result);
});

module.exports = { list, getById, create, update, applyToArea };
