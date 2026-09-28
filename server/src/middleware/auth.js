'use strict';

/**
 * User authentication for the web application (US-01-C, FR-01).
 *
 * Mechanism: JWT signed with HS256, sent as `Authorization: Bearer <token>`,
 * exactly as fixed by the API specification. The session length comes from
 * `security_settings`, so the Super Administrator can shorten it without a
 * deploy.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const settings = require('../utils/settings');
const { unauthorized, forbidden } = require('./errors');

/** Sign a session token for a freshly authenticated user. */
async function issueToken(user) {
  const policy = await settings.getSecuritySettings();
  const expiresInSeconds = (policy.session_hours || config.auth.jwtExpiresHours) * 3600;

  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role_name,
      role_id: user.role_id,
      org: user.organization_id,
    },
    config.auth.jwtSecret,
    { algorithm: 'HS256', expiresIn: expiresInSeconds },
  );

  return { token, expiresInSeconds };
}

function extractBearer(req) {
  const header = req.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

/**
 * Require a valid, non-expired session belonging to an active user.
 * Populates `req.user` with the live database row plus its permission set.
 */
async function requireAuth(req, _res, next) {
  try {
    const token = extractBearer(req);
    if (!token) {
      throw unauthorized('A Bearer token is required. Sign in to obtain one.');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.auth.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      // Expired and malformed tokens are both 401 (US01C-T4).
      const message = err.name === 'TokenExpiredError'
        ? 'The session has expired. Please sign in again.'
        : 'The authentication token is invalid.';
      throw unauthorized(message);
    }

    // The account is re-read on every request so a deactivation takes effect
    // immediately instead of waiting for the token to expire (FR-04).
    const user = await db.one(
      `SELECT u.id, u.email, u.username, u.full_name, u.is_active,
              u.organization_id, u.role_id, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [payload.sub],
    );

    if (!user) throw unauthorized('The authentication token is invalid.');
    if (!user.is_active) throw forbidden('This account is deactivated.');

    const permissionRows = await db.rows(
      `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1`,
      [user.role_id],
    );

    user.permissions = new Set(permissionRows.map((r) => r.code));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attach `req.user` when a valid token is present, but never reject.
 * Used by endpoints that accept either a device API key or a user session.
 */
async function optionalAuth(req, _res, next) {
  if (!extractBearer(req)) return next();
  return requireAuth(req, _res, (err) => next(err && err.status === 401 ? null : err));
}

module.exports = { issueToken, requireAuth, optionalAuth, extractBearer };
