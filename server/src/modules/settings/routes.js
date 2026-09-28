'use strict';

/**
 * Platform settings.
 *   /settings/global        system_parameters (severity, anomaly, offline...)
 *   /settings/security      session length, password policy, login attempts
 *   /settings/notifications notification mechanisms
 */

const express = require('express');
const { z } = require('zod');

const db = require('../../db');
const settingsCache = require('../../utils/settings');
const audit = require('../../middleware/audit');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateBody } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const { badRequest } = require('../../middleware/errors');

const router = express.Router();
router.use(requireAuth);

// --- Global key/value parameters ------------------------------------------

const globalSchema = z.object({
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

router.get('/global', requirePermission('settings.read'), asyncHandler(async (_req, res) => {
  res.json(await db.rows('SELECT key, value, description, updated_at FROM system_parameters ORDER BY key'));
}));

router.put('/global', requirePermission('settings.write'), validateBody(globalSchema), asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body.parameters);
  if (!entries.length) throw badRequest('Provide at least one parameter.');

  const known = await db.rows('SELECT key FROM system_parameters');
  const knownKeys = new Set(known.map((k) => k.key));
  const unknown = entries.filter(([key]) => !knownKeys.has(key));
  if (unknown.length) {
    throw badRequest('One or more parameters are unknown.',
      unknown.map(([key]) => ({ field: 'parameters', issue: `Unknown parameter "${key}".` })));
  }

  const before = await db.rows('SELECT key, value FROM system_parameters');

  await db.withTransaction(async (client) => {
    for (const [key, value] of entries) {
      await client.query(
        'UPDATE system_parameters SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = $3',
        [String(value), req.user.id, key],
      );
    }
  });

  settingsCache.invalidate();
  const after = await db.rows('SELECT key, value FROM system_parameters ORDER BY key');
  audit.record(req, 'UPDATE', 'system_parameters', null, before, after);
  res.json(after);
}));

// --- Security settings -----------------------------------------------------

const securitySchema = z.object({
  session_hours: z.number().int().min(1).max(72).optional(),
  password_min_length: z.number().int().min(6).max(128).optional(),
  password_require_upper: z.boolean().optional(),
  password_require_digit: z.boolean().optional(),
  password_require_symbol: z.boolean().optional(),
  max_login_attempts: z.number().int().min(1).max(100).optional(),
  login_window_minutes: z.number().int().min(1).max(1440).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one setting to update.' });

router.get('/security', requirePermission('settings.read'), asyncHandler(async (_req, res) => {
  res.json(await db.one('SELECT * FROM security_settings WHERE id = $1', ['security-default']));
}));

router.put('/security', requirePermission('settings.write'), validateBody(securitySchema), asyncHandler(async (req, res) => {
  const before = await db.one('SELECT * FROM security_settings WHERE id = $1', ['security-default']);

  const assignments = [];
  const params = [];
  for (const [column, value] of Object.entries(req.body)) {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }
  params.push(req.user.id);
  assignments.push(`updated_by = $${params.length}`);

  await db.query(
    `UPDATE security_settings SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = 'security-default'`,
    params,
  );

  settingsCache.invalidate();
  const after = await db.one('SELECT * FROM security_settings WHERE id = $1', ['security-default']);
  audit.record(req, 'UPDATE', 'security_settings', 'security-default', before, after);
  res.json(after);
}));

// --- Notification settings -------------------------------------------------

const notificationSchema = z.object({
  dashboard_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  email_recipients: z.string().nullable().optional(),
  min_severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  notify_on_recommendation: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one setting to update.' });

router.get('/notifications', requirePermission('settings.read'), asyncHandler(async (_req, res) => {
  res.json(await db.one('SELECT * FROM notification_settings WHERE id = $1', ['notif-default']));
}));

router.put('/notifications', requirePermission('settings.write'), validateBody(notificationSchema), asyncHandler(async (req, res) => {
  const before = await db.one('SELECT * FROM notification_settings WHERE id = $1', ['notif-default']);

  const assignments = [];
  const params = [];
  for (const [column, value] of Object.entries(req.body)) {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }
  params.push(req.user.id);
  assignments.push(`updated_by = $${params.length}`);

  await db.query(
    `UPDATE notification_settings SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = 'notif-default'`,
    params,
  );

  const after = await db.one('SELECT * FROM notification_settings WHERE id = $1', ['notif-default']);
  audit.record(req, 'UPDATE', 'notification_settings', 'notif-default', before, after);
  res.json(after);
}));

module.exports = router;
