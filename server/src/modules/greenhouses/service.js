'use strict';

/**
 * Greenhouse registry (Administrator functionality, FR-07).
 * Scoped to the caller's organization unless the caller is a Super Administrator.
 */

const db = require('../../db');
const rbac = require('../../middleware/rbac');
const { notFound, conflict } = require('../../middleware/errors');

async function list(actor) {
  const scope = rbac.organizationScope(actor);
  return db.rows(
    `SELECT g.*,
            (SELECT COUNT(*) FROM areas a WHERE a.greenhouse_id = g.id) AS area_count
       FROM greenhouses g
      WHERE $1::text IS NULL OR g.organization_id = $1
      ORDER BY g.name`,
    [scope],
  );
}

async function getById(actor, id) {
  const scope = rbac.organizationScope(actor);
  const row = await db.one(
    'SELECT * FROM greenhouses WHERE id = $1 AND ($2::text IS NULL OR organization_id = $2)',
    [id, scope],
  );
  if (!row) throw notFound(`No greenhouse with id "${id}".`);
  return row;
}

async function create(actor, payload) {
  const existing = await db.one('SELECT id FROM greenhouses WHERE id = $1', [payload.id]);
  if (existing) throw conflict(`A greenhouse with id "${payload.id}" already exists.`);

  const organizationId = rbac.isSuperAdmin(actor)
    ? (payload.organization_id || actor.organization_id)
    : actor.organization_id;

  await db.query(
    'INSERT INTO greenhouses (id, organization_id, name, location, is_active) VALUES ($1, $2, $3, $4, COALESCE($5, TRUE))',
    [payload.id, organizationId, payload.name, payload.location || null, payload.is_active],
  );
  return getById(actor, payload.id);
}

async function update(actor, id, payload) {
  await getById(actor, id);
  await db.query(
    `UPDATE greenhouses
        SET name       = COALESCE($1, name),
            location   = COALESCE($2, location),
            is_active  = COALESCE($3, is_active),
            updated_at = NOW()
      WHERE id = $4`,
    [payload.name ?? null, payload.location ?? null, payload.is_active ?? null, id],
  );
  return getById(actor, id);
}

module.exports = { list, getById, create, update };
