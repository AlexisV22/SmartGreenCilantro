'use strict';

/**
 * Crop observations (Producer functionality: "register observations about
 * the crop"). Free-text notes attached to an area and to their author.
 */

const express = require('express');
const { z } = require('zod');

const db = require('../../db');
const audit = require('../../middleware/audit');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody, validateQuery } = require('../../middleware/validate');
const { asyncHandler, q } = require('../../utils/http');
const { badRequest } = require('../../middleware/errors');

const router = express.Router();
router.use(requireAuth);

const listQuery = z.object({
  area_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createSchema = z.object({
  area_id: z.string().min(1),
  note: z.string().min(3, 'The observation must have at least 3 characters.').max(4000),
});

router.get('/', requirePermission('observations.read'), validateQuery(listQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await db.rows(
    `SELECT o.*, a.name AS area_name, u.email AS user_email, u.full_name AS user_name
       FROM observations o
       JOIN areas a ON a.id = o.area_id
       LEFT JOIN users u ON u.id = o.user_id
      WHERE $1::text IS NULL OR o.area_id = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3`,
    [query.area_id || null, query.limit || 100, query.offset || 0],
  ));
}));

router.post('/', requirePermission('observations.write'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const area = await db.one('SELECT id FROM areas WHERE id = $1', [req.body.area_id]);
  if (!area) {
    throw badRequest('The area does not exist.', [
      { field: 'area_id', issue: `Unknown area "${req.body.area_id}".` },
    ]);
  }

  const created = await db.one(
    'INSERT INTO observations (area_id, user_id, note) VALUES ($1, $2, $3) RETURNING *',
    [req.body.area_id, req.user.id, req.body.note],
  );

  audit.record(req, 'CREATE', 'observations', created.id, null, created);
  res.status(201).json(created);
}));

module.exports = router;
