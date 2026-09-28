'use strict';

/**
 * Roles and permissions matrix (US-24).
 *
 * The Super Administrator can create roles and re-assign permissions; the
 * three system roles cannot be renamed or removed so the platform always has
 * a working RBAC baseline.
 */

const db = require('../../db');
const { notFound, badRequest, conflict } = require('../../middleware/errors');

async function listPermissions() {
  return db.rows('SELECT id, code, description, category FROM permissions ORDER BY category, code');
}

async function list() {
  const roles = await db.rows(
    `SELECT r.id, r.name, r.description, r.is_system, r.created_at,
            COUNT(u.id) AS user_count
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id
      GROUP BY r.id
      ORDER BY r.name`,
  );

  const grants = await db.rows(
    `SELECT rp.role_id, p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id`,
  );

  return roles.map((role) => ({
    ...role,
    user_count: Number(role.user_count),
    permissions: grants.filter((g) => g.role_id === role.id).map((g) => g.code).sort(),
  }));
}

async function getById(id) {
  const all = await list();
  const role = all.find((r) => r.id === id);
  if (!role) throw notFound(`No role with id "${id}".`);
  return role;
}

async function create(payload) {
  const existing = await db.one('SELECT id FROM roles WHERE name = $1', [payload.name]);
  if (existing) throw conflict('A role with that name already exists.');

  const id = `role-${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  await db.one(
    `INSERT INTO roles (id, name, description, is_system) VALUES ($1, $2, $3, FALSE) RETURNING id`,
    [id, payload.name, payload.description || null],
  );

  if (payload.permissions && payload.permissions.length) {
    await setPermissions(id, payload.permissions);
  }
  return getById(id);
}

async function update(id, payload) {
  const role = await db.one('SELECT * FROM roles WHERE id = $1', [id]);
  if (!role) throw notFound(`No role with id "${id}".`);

  if (role.is_system && payload.name && payload.name !== role.name) {
    throw badRequest('System roles cannot be renamed.', [
      { field: 'name', issue: `"${role.name}" is a system role.` },
    ]);
  }

  await db.query(
    `UPDATE roles SET name = COALESCE($1, name), description = COALESCE($2, description),
            updated_at = NOW()
      WHERE id = $3`,
    [payload.name || null, payload.description === undefined ? null : payload.description, id],
  );

  return getById(id);
}

/**
 * Replace the permission set of a role (PUT /roles/:id/permissions).
 * Unknown codes are rejected instead of silently ignored.
 */
async function setPermissions(id, codes) {
  const role = await db.one('SELECT id, name FROM roles WHERE id = $1', [id]);
  if (!role) throw notFound(`No role with id "${id}".`);

  const known = await db.rows('SELECT id, code FROM permissions WHERE code = ANY($1)', [codes]);
  if (known.length !== codes.length) {
    const knownCodes = new Set(known.map((k) => k.code));
    throw badRequest('One or more permission codes are unknown.',
      codes.filter((c) => !knownCodes.has(c)).map((c) => ({ field: 'permissions', issue: `Unknown permission "${c}".` })));
  }

  // The Super Administrator must never be able to lock itself out.
  if (role.name === 'SuperAdministrator') {
    const total = await db.one('SELECT COUNT(*)::int AS n FROM permissions');
    if (known.length !== total.n) {
      throw badRequest('The SuperAdministrator role must keep every permission.');
    }
  }

  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    for (const permission of known) {
      await client.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, permission.id],
      );
    }
  });

  return getById(id);
}

module.exports = { list, getById, create, update, setPermissions, listPermissions };
