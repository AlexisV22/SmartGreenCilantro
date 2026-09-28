'use strict';

/**
 * Authentication service (US-01-C, FR-01, NFR-03).
 */

const bcrypt = require('bcryptjs');
const db = require('../../db');
const { issueToken } = require('../../middleware/auth');
const { unauthorized } = require('../../middleware/errors');

/**
 * Verify credentials and return the session token.
 *
 * The same generic message is returned for an unknown email, a wrong password
 * and a deactivated account, so the endpoint never reveals whether a user
 * exists (US01C-T4).
 */
async function login(email, password) {
  const GENERIC = 'Invalid credentials.';

  const user = await db.one(
    `SELECT u.id, u.email, u.username, u.full_name, u.password_hash,
            u.is_active, u.organization_id, u.role_id, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower($1) OR lower(u.username) = lower($1)`,
    [email],
  );

  // Compare against a dummy hash when the user does not exist so the response
  // time does not betray which emails are registered.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!user || !passwordMatches || !user.is_active) {
    throw unauthorized(GENERIC);
  }

  await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  const { token, expiresInSeconds } = await issueToken(user);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresInSeconds,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      full_name: user.full_name,
      role: user.role_name,
      organization_id: user.organization_id,
    },
  };
}

/** Profile of the caller, including the permission codes the UI uses. */
async function me(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    full_name: user.full_name,
    role: user.role_name,
    organization_id: user.organization_id,
    permissions: [...user.permissions].sort(),
  };
}

module.exports = { login, me };
