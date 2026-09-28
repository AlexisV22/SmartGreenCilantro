'use strict';

/**
 * Role-based access control (US01C-T2, FR-02, FR-03, NFR-04).
 *
 * Authorization is expressed as permission codes, not as hard-coded role
 * names, so the Super Administrator can reshape the matrix from
 * `PUT /api/roles/:id/permissions` without touching the code (US-24).
 */

const { unauthorized, forbidden } = require('./errors');

const SUPER_ADMIN = 'SuperAdministrator';
const ADMIN = 'Administrator';
const PRODUCER = 'Producer';

/** Require one or more permission codes (all of them must be granted). */
function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());

    const missing = codes.filter((code) => !req.user.permissions.has(code));
    if (missing.length) {
      return next(forbidden(
        `Your role (${req.user.role_name}) does not allow this operation.`,
        missing.map((code) => ({ field: 'permission', issue: `Missing permission: ${code}` })),
      ));
    }
    return next();
  };
}

/** Require the user to hold one of the listed roles. */
function requireRole(...roleNames) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roleNames.includes(req.user.role_name)) {
      return next(forbidden(
        `This operation is restricted to: ${roleNames.join(', ')}.`,
      ));
    }
    return next();
  };
}

const isSuperAdmin = (user) => !!user && user.role_name === SUPER_ADMIN;
const isAdmin = (user) => !!user && user.role_name === ADMIN;
const isProducer = (user) => !!user && user.role_name === PRODUCER;

/**
 * Tenant scoping: a Super Administrator sees every organization, anyone else
 * only their own. Returns the organization id to filter by, or null for
 * "no filter".
 */
function organizationScope(user) {
  return isSuperAdmin(user) ? null : user.organization_id;
}

module.exports = {
  SUPER_ADMIN,
  ADMIN,
  PRODUCER,
  requirePermission,
  requireRole,
  isSuperAdmin,
  isAdmin,
  isProducer,
  organizationScope,
};
