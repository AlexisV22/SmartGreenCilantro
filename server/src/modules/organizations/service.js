'use strict';

/**
 * Greenhouse organizations / tenants (Super Administrator functionality).
 */

const db = require('../../db');
const { notFound, conflict } = require('../../middleware/errors');

async function list() {
  return db.rows(
    `SELECT o.*,
            (SELECT COUNT(*) FROM greenhouses g WHERE g.organization_id = o.id) AS greenhouse_count,
            (SELECT COUNT(*) FROM users u      WHERE u.organization_id = o.id) AS user_count
       FROM organizations o
      ORDER BY o.name`,
  );
}

async function getById(id) {
  const row = await db.one('SELECT * FROM organizations WHERE id = $1', [id]);
  if (!row) throw notFound(`No organization with id "${id}".`);
  return row;
}

async function create(payload) {
  const id = payload.id || `org-${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const existing = await db.one('SELECT id FROM organizations WHERE id = $1 OR name = $2', [id, payload.name]);
  if (existing) throw conflict('An organization with that id or name already exists.');

  await db.query(
    'INSERT INTO organizations (id, name, contact_email, is_active) VALUES ($1, $2, $3, COALESCE($4, TRUE))',
    [id, payload.name, payload.contact_email || null, payload.is_active],
  );
  return getById(id);
}

async function update(id, payload) {
  await getById(id);
  await db.query(
    `UPDATE organizations
        SET name          = COALESCE($1, name),
            contact_email = COALESCE($2, contact_email),
            is_active     = COALESCE($3, is_active),
            updated_at    = NOW()
      WHERE id = $4`,
    [payload.name ?? null, payload.contact_email ?? null, payload.is_active ?? null, id],
  );
  return getById(id);
}

module.exports = { list, getById, create, update };
