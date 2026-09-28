'use strict';

/**
 * Actuator registry and status (US-14, US-25, FR-16).
 *
 * An actuator that has not reported its state inside the configured window is
 * presented as OFFLINE, which is the case US14-T4 verifies.
 */

const db = require('../../db');
const rbac = require('../../middleware/rbac');
const settings = require('../../utils/settings');
const { notFound, conflict, badRequest } = require('../../middleware/errors');

const ACTUATOR_TYPES = ['irrigation_pump', 'ventilation_fan', 'shade', 'lighting'];

const baseQuery = `
  SELECT a.*, ar.name AS area_name, ar.mode AS area_mode,
         d.name AS device_name, d.last_seen AS device_last_seen, d.is_active AS device_active,
         g.organization_id
    FROM actuators a
    JOIN areas ar      ON ar.id = a.area_id
    JOIN devices d     ON d.id  = a.device_id
    JOIN greenhouses g ON g.id  = ar.greenhouse_id`;

/** Replace the stored state with OFFLINE when the report is stale. */
function applyOfflineRule(rows, offlineMinutes) {
  const cutoff = Date.now() - offlineMinutes * 60 * 1000;

  return rows.map((row) => {
    const lastUpdate = row.last_update ? new Date(row.last_update).getTime() : null;
    const stale = lastUpdate === null || lastUpdate < cutoff;
    return {
      ...row,
      // `state` is what the UI shows; `reported_state` keeps the raw value.
      reported_state: row.state,
      state: stale ? 'OFFLINE' : row.state,
      is_offline: stale,
      last_change: row.last_update,
    };
  });
}

/** GET /api/actuators/status — the payload shape of the API specification. */
async function status(actor, { areaId = null } = {}) {
  const offlineMinutes = await settings.getNumber('actuator.offline_minutes', 5);

  const rows = await db.rows(
    `${baseQuery}
      WHERE ($1::text IS NULL OR g.organization_id = $1)
        AND ($2::text IS NULL OR a.area_id = $2)
      ORDER BY a.area_id, a.type`,
    [rbac.organizationScope(actor), areaId],
  );

  const actuators = applyOfflineRule(rows, offlineMinutes).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    area_id: a.area_id,
    area_name: a.area_name,
    state: a.state,
    reported_state: a.reported_state,
    mode: a.area_mode,
    is_active: a.is_active,
    is_offline: a.is_offline,
    last_change: a.last_change,
    device_id: a.device_id,
  }));

  return { timestamp: new Date().toISOString(), actuators };
}

async function list(actor, options = {}) {
  return (await status(actor, options)).actuators;
}

async function getById(actor, id) {
  const offlineMinutes = await settings.getNumber('actuator.offline_minutes', 5);
  const row = await db.one(
    `${baseQuery} WHERE a.id = $1 AND ($2::text IS NULL OR g.organization_id = $2)`,
    [id, rbac.organizationScope(actor)],
  );
  if (!row) throw notFound(`No actuator with id "${id}".`);
  return applyOfflineRule([row], offlineMinutes)[0];
}

async function create(actor, payload) {
  const existing = await db.one('SELECT id FROM actuators WHERE id = $1', [payload.id]);
  if (existing) throw conflict(`An actuator with id "${payload.id}" is already registered.`);

  const device = await db.one(
    'SELECT id FROM devices WHERE id = $1 AND ($2::text IS NULL OR organization_id = $2)',
    [payload.device_id, rbac.organizationScope(actor)],
  );
  if (!device) {
    throw badRequest('The device does not exist or is not visible to you.', [
      { field: 'device_id', issue: `Unknown device "${payload.device_id}".` },
    ]);
  }

  await db.query(
    `INSERT INTO actuators (id, device_id, area_id, name, type, state, is_active)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'OFF'), COALESCE($7, TRUE))`,
    [payload.id, payload.device_id, payload.area_id, payload.name, payload.type,
      payload.state, payload.is_active],
  );

  return getById(actor, payload.id);
}

async function update(actor, id, payload) {
  await getById(actor, id);
  await db.query(
    `UPDATE actuators
        SET name       = COALESCE($1, name),
            area_id    = COALESCE($2, area_id),
            is_active  = COALESCE($3, is_active),
            updated_at = NOW()
      WHERE id = $4`,
    [payload.name ?? null, payload.area_id ?? null, payload.is_active ?? null, id],
  );
  return getById(actor, id);
}

/** Actuators of a type inside an area — used by the automation engines. */
async function findByType(areaId, type) {
  return db.rows(
    'SELECT * FROM actuators WHERE area_id = $1 AND type = $2 AND is_active ORDER BY id',
    [areaId, type],
  );
}

module.exports = { status, list, getById, create, update, findByType, ACTUATOR_TYPES, applyOfflineRule };
