'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, q, p } = require('../../utils/http');

/** GET /api/users — Administrator (own producers) / Super Administrator (all). */
const list = asyncHandler(async (req, res) => {
  const { role } = q(req);
  res.json(await service.list(req.user, { roleFilter: role || null }));
});

/** GET /api/users/:id */
const getById = asyncHandler(async (req, res) => {
  res.json(await service.getById(req.user, p(req).id));
});

/** POST /api/users */
const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.user, req.body);
  audit.record(req, 'CREATE', 'users', created.id, null, audit.scrub(created));
  res.status(201).json(created);
});

/** PUT /api/users/:id */
const update = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.update(req.user, id, req.body);
  audit.record(req, 'UPDATE', 'users', id, audit.scrub(before), audit.scrub(after));
  res.json(after);
});

/** PATCH /api/users/:id/status — activate / deactivate (FR-04). */
const setStatus = asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await service.getById(req.user, id);
  const after = await service.setStatus(req.user, id, req.body.is_active);
  audit.record(req, 'UPDATE_STATUS', 'users', id, audit.scrub(before), audit.scrub(after));
  res.json(after);
});

/** GET /api/admins — Super Administrator only (US-23). */
const listAdmins = asyncHandler(async (req, res) => {
  res.json(await service.list(req.user, { roleFilter: 'Administrator' }));
});

/** POST /api/admins — Super Administrator only (US-23). */
const createAdmin = asyncHandler(async (req, res) => {
  const created = await service.create(req.user, { ...req.body, role: req.body.role || 'Administrator' });
  audit.record(req, 'CREATE', 'users', created.id, null, audit.scrub(created));
  res.status(201).json(created);
});

module.exports = { list, getById, create, update, setStatus, listAdmins, createAdmin };
