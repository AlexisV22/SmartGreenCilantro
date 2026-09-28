'use strict';

/**
 * User management (US-22 producers, US-23 administrators, FR-04).
 *
 * Scoping rules enforced here:
 *   * An Administrator manages Producers of its own organization only.
 *   * A Super Administrator manages every account of every organization.
 * Accounts are deactivated, never deleted.
 */

const bcrypt = require('bcryptjs');
const db = require('../../db');
const config = require('../../config');
const settings = require('../../utils/settings');
const rbac = require('../../middleware/rbac');
const { badRequest, notFound, forbidden, conflict } = require('../../middleware/errors');

const PUBLIC_COLUMNS = `u.id, u.email, u.username, u.full_name, u.is_active,
                        u.organization_id, u.role_id, r.name AS role_name,
                        u.last_login, u.created_at, u.updated_at`;

/** Roles an actor is allowed to create or manage. */
function manageableRoles(actor) {
  if (rbac.isSuperAdmin(actor)) return ['SuperAdministrator', 'Administrator', 'Producer'];
  if (rbac.isAdmin(actor)) return ['Producer'];
  return [];
}

async function assertCanManage(actor, targetRoleName) {
  const allowed = manageableRoles(actor);
  if (!allowed.includes(targetRoleName)) {
    throw forbidden(
      `Your role (${actor.role_name}) can only manage: ${allowed.join(', ') || 'no accounts'}.`,
    );
  }
}

/**
 * List accounts visible to the actor.
 * `roleFilter` restricts to a role name (used by the /admins endpoints).
 */
async function list(actor, { roleFilter = null, includeInactive = true } = {}) {
  const params = [];
  const where = [];

  const orgScope = rbac.organizationScope(actor);
  if (orgScope) {
    params.push(orgScope);
    where.push(`u.organization_id = $${params.length}`);
  }

  if (roleFilter) {
    params.push(roleFilter);
    where.push(`r.name = $${params.length}`);
  } else if (rbac.isAdmin(actor)) {
    // An Administrator sees the producers it manages plus its own account.
    params.push(actor.id);
    where.push(`(r.name = 'Producer' OR u.id = $${params.length})`);
  }

  if (!includeInactive) where.push('u.is_active');

  return db.rows(
    `SELECT ${PUBLIC_COLUMNS}
       FROM users u
       JOIN roles r ON r.id = u.role_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.name, u.email`,
    params,
  );
}

async function getById(actor, id) {
  const user = await db.one(
    `SELECT ${PUBLIC_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [id],
  );
  if (!user) throw notFound(`No user with id "${id}".`);

  const orgScope = rbac.organizationScope(actor);
  if (orgScope && user.organization_id !== orgScope) {
    throw notFound(`No user with id "${id}".`);
  }
  return user;
}

/** Resolve a role by name and fail with a validation error if unknown. */
async function resolveRole(roleName) {
  const role = await db.one('SELECT id, name FROM roles WHERE name = $1', [roleName]);
  if (!role) {
    throw badRequest('The requested role does not exist.', [
      { field: 'role', issue: `Unknown role "${roleName}".` },
    ]);
  }
  return role;
}

async function create(actor, payload) {
  const role = await resolveRole(payload.role);
  await assertCanManage(actor, role.name);

  const policyErrors = await settings.validatePassword(payload.password);
  if (policyErrors.length) {
    throw badRequest('The password does not satisfy the security policy.', policyErrors);
  }

  // An Administrator can only create accounts inside its own organization.
  const organizationId = rbac.isSuperAdmin(actor)
    ? (payload.organization_id || actor.organization_id)
    : actor.organization_id;

  const existing = await db.one(
    'SELECT id FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($2)',
    [payload.email, payload.username],
  );
  if (existing) {
    throw conflict('A user with that email or username already exists.', [
      { field: 'email', issue: 'Email or username already registered.' },
    ]);
  }

  const passwordHash = await bcrypt.hash(payload.password, config.auth.bcryptRounds);

  const created = await db.one(
    `INSERT INTO users (organization_id, email, username, full_name, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE))
     RETURNING id`,
    [organizationId, payload.email, payload.username, payload.full_name || null,
      passwordHash, role.id, payload.is_active],
  );

  return getById(actor, created.id);
}

async function update(actor, id, payload) {
  const current = await getById(actor, id);
  await assertCanManage(actor, current.role_name);

  const fields = [];
  const params = [];
  const push = (column, value) => { params.push(value); fields.push(`${column} = $${params.length}`); };

  if (payload.email !== undefined) push('email', payload.email);
  if (payload.username !== undefined) push('username', payload.username);
  if (payload.full_name !== undefined) push('full_name', payload.full_name);
  if (payload.is_active !== undefined) push('is_active', payload.is_active);

  if (payload.password !== undefined) {
    const policyErrors = await settings.validatePassword(payload.password);
    if (policyErrors.length) {
      throw badRequest('The password does not satisfy the security policy.', policyErrors);
    }
    push('password_hash', await bcrypt.hash(payload.password, config.auth.bcryptRounds));
  }

  if (payload.role !== undefined) {
    const role = await resolveRole(payload.role);
    await assertCanManage(actor, role.name);
    push('role_id', role.id);
  }

  if (!fields.length) return current;

  params.push(id);
  await db.query(
    `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params,
  );

  return getById(actor, id);
}

/** PATCH /users/:id/status — activate or deactivate an account (FR-04). */
async function setStatus(actor, id, isActive) {
  const current = await getById(actor, id);
  await assertCanManage(actor, current.role_name);

  if (current.id === actor.id && isActive === false) {
    throw badRequest('You cannot deactivate your own account.');
  }

  await db.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [isActive, id]);
  return getById(actor, id);
}

module.exports = { list, getById, create, update, setStatus, manageableRoles };
