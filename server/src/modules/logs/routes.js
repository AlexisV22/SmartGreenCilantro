'use strict';

/**
 * Log consultation (FR-21).
 *   GET /api/logs/system — technical log of requests, jobs and engines
 *   GET /api/logs/audit  — who changed what, with before/after snapshots
 *
 * An Administrator sees the audit trail of its own organization; the Super
 * Administrator sees the whole platform.
 */

const express = require('express');
const { z } = require('zod');

const db = require('../../db');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission, organizationScope } = require('../../middleware/rbac');
const { validateQuery } = require('../../middleware/validate');
const { asyncHandler, q } = require('../../utils/http');

const router = express.Router();
router.use(requireAuth);

const systemQuery = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  source: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const auditQuery = z.object({
  user_id: z.string().min(1).optional(),
  entity: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get('/system', requirePermission('logs.read'), validateQuery(systemQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await db.rows(
    `SELECT * FROM system_logs
      WHERE ($1::text IS NULL OR level  = $1)
        AND ($2::text IS NULL OR source = $2)
        AND ($3::timestamptz IS NULL OR created_at >= $3)
        AND ($4::timestamptz IS NULL OR created_at <= $4)
      ORDER BY created_at DESC
      LIMIT $5 OFFSET $6`,
    [query.level || null, query.source || null, query.from || null, query.to || null,
      query.limit || 200, query.offset || 0],
  ));
}));

router.get('/audit', requirePermission('logs.read'), validateQuery(auditQuery), asyncHandler(async (req, res) => {
  const query = q(req);
  res.json(await db.rows(
    `SELECT al.*, u.email AS user_email, u.full_name AS user_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
      WHERE ($1::text IS NULL OR al.organization_id = $1)
        AND ($2::text IS NULL OR al.user_id = $2)
        AND ($3::text IS NULL OR al.entity  = $3)
        AND ($4::text IS NULL OR al.action  = $4)
        AND ($5::timestamptz IS NULL OR al.created_at >= $5)
        AND ($6::timestamptz IS NULL OR al.created_at <= $6)
      ORDER BY al.created_at DESC
      LIMIT $7 OFFSET $8`,
    [organizationScope(req.user), query.user_id || null, query.entity || null, query.action || null,
      query.from || null, query.to || null, query.limit || 200, query.offset || 0],
  ));
}));

module.exports = router;
