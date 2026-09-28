'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler } = require('../../utils/http');

/** POST /api/auth/login — public. */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await service.login(email, password);

  // Successful sign-ins are audited; failures are rejected before this point.
  audit.record(
    Object.assign(Object.create(req), {
      user: { id: result.user.id, organization_id: result.user.organization_id },
    }),
    'LOGIN', 'users', result.user.id, null, { email: result.user.email, role: result.user.role },
  );

  res.status(200).json(result);
});

/** GET /api/auth/me — any authenticated user. */
const me = asyncHandler(async (req, res) => {
  res.status(200).json(await service.me(req.user));
});

/**
 * POST /api/auth/logout — any authenticated user.
 *
 * Tokens are stateless, so logout is a client-side discard; the server records
 * the event for the audit trail and answers 200 so the UI can react.
 */
const logout = asyncHandler(async (req, res) => {
  audit.record(req, 'LOGOUT', 'users', req.user.id);
  res.status(200).json({ status: 'logged_out' });
});

module.exports = { login, me, logout };
