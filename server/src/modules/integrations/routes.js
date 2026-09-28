'use strict';

/**
 * External system integrations (Super Administrator: "manage system
 * integrations"). Credentials inside `config` are write-only: the API never
 * returns a stored secret.
 */

const express = require('express');
const { z } = require('zod');

const db = require('../../db');
const audit = require('../../middleware/audit');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateParams } = require('../../middleware/validate');
const { asyncHandler, p } = require('../../utils/http');
const { notFound, conflict } = require('../../middleware/errors');

const router = express.Router();
router.use(requireAuth);

const SECRET_KEYS = /(key|token|secret|password|credential)/i;

/** Replace secret-looking values with a placeholder before responding. */
function redact(integration) {
  if (!integration) return integration;
  const config = { ...(integration.config || {}) };
  for (const key of Object.keys(config)) {
    if (SECRET_KEYS.test(key) && config[key]) config[key] = '[stored]';
  }
  return { ...integration, config };
}

const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  name: z.string().min(2),
  type: z.string().min(2),
  config: z.record(z.string(), z.any()).optional(),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  type: z.string().min(2).optional(),
  config: z.record(z.string(), z.any()).optional(),
  enabled: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update.' });

router.get('/', requirePermission('integrations.read'), asyncHandler(async (_req, res) => {
  const rows = await db.rows('SELECT * FROM integrations ORDER BY name');
  res.json(rows.map(redact));
}));

router.post('/', requirePermission('integrations.write'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const existing = await db.one('SELECT id FROM integrations WHERE name = $1', [req.body.name]);
  if (existing) throw conflict('An integration with that name already exists.');

  const created = await db.one(
    `INSERT INTO integrations (name, type, config, enabled, updated_by)
     VALUES ($1, $2, $3, COALESCE($4, FALSE), $5) RETURNING *`,
    [req.body.name, req.body.type, JSON.stringify(req.body.config || {}), req.body.enabled ?? null, req.user.id],
  );

  audit.record(req, 'CREATE', 'integrations', created.id, null, redact(created));
  res.status(201).json(redact(created));
}));

router.put('/:id', requirePermission('integrations.write'), validateParams(idParam), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const id = p(req).id;
  const before = await db.one('SELECT * FROM integrations WHERE id = $1', [id]);
  if (!before) throw notFound(`No integration with id "${id}".`);

  await db.query(
    `UPDATE integrations
        SET type       = COALESCE($1, type),
            config     = COALESCE($2, config),
            enabled    = COALESCE($3, enabled),
            updated_by = $4,
            updated_at = NOW()
      WHERE id = $5`,
    [req.body.type ?? null,
      req.body.config ? JSON.stringify(req.body.config) : null,
      req.body.enabled ?? null, req.user.id, id],
  );

  const after = await db.one('SELECT * FROM integrations WHERE id = $1', [id]);
  audit.record(req, 'UPDATE', 'integrations', id, redact(before), redact(after));
  res.json(redact(after));
}));

module.exports = router;
