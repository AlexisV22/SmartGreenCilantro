'use strict';

/**
 * Sensor registry (US-25, FR-06, FR-07).
 * Every sensor has a unique id and belongs to exactly one device and area.
 */

const db = require('../../db');
const rbac = require('../../middleware/rbac');
const { notFound, conflict, badRequest } = require('../../middleware/errors');

const SENSOR_TYPES = ['temperature', 'air_humidity', 'soil_moisture', 'light', 'co2', 'water_level', 'ph'];

const baseQuery = `
  SELECT s.*, d.name AS device_name, d.is_active AS device_active,
         ar.name AS area_name, g.organization_id
    FROM sensors s
    JOIN devices d     ON d.id  = s.device_id
    JOIN areas ar      ON ar.id = s.area_id
    JOIN greenhouses g ON g.id  = ar.greenhouse_id`;

async function list(actor, { areaId = null, deviceId = null, type = null } = {}) {
  return db.rows(
    `${baseQuery}
      WHERE ($1::text IS NULL OR g.organization_id = $1)
        AND ($2::text IS NULL OR s.area_id   = $2)
        AND ($3::text IS NULL OR s.device_id = $3)
        AND ($4::text IS NULL OR s.type      = $4)
      ORDER BY s.area_id, s.type, s.id`,
    [rbac.organizationScope(actor), areaId, deviceId, type],
  );
}

async function getById(actor, id) {
  const row = await db.one(
    `${baseQuery} WHERE s.id = $1 AND ($2::text IS NULL OR g.organization_id = $2)`,
    [id, rbac.organizationScope(actor)],
  );
  if (!row) throw notFound(`No sensor with id "${id}".`);
  return row;
}

/** Fast lookup used by the ingestion path; no tenant scoping. */
async function findForIngestion(sensorId) {
  return db.one(
    `SELECT s.*, d.is_active AS device_active, ar.mode AS area_mode
       FROM sensors s
       JOIN devices d ON d.id = s.device_id
       JOIN areas ar  ON ar.id = s.area_id
      WHERE s.id = $1`,
    [sensorId],
  );
}

async function create(actor, payload) {
  const existing = await db.one('SELECT id FROM sensors WHERE id = $1', [payload.id]);
  if (existing) throw conflict(`A sensor with id "${payload.id}" is already registered.`);

  const device = await db.one(
    `SELECT d.id FROM devices d
      WHERE d.id = $1 AND ($2::text IS NULL OR d.organization_id = $2)`,
    [payload.device_id, rbac.organizationScope(actor)],
  );
  if (!device) {
    throw badRequest('The device does not exist or is not visible to you.', [
      { field: 'device_id', issue: `Unknown device "${payload.device_id}".` },
    ]);
  }

  if (Number(payload.physical_min) >= Number(payload.physical_max)) {
    throw badRequest('The physical range is inconsistent.', [
      { field: 'physical_min', issue: 'The minimum must be lower than the maximum.' },
    ]);
  }

  await db.query(
    `INSERT INTO sensors (id, device_id, area_id, name, type, unit, physical_min, physical_max, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE))`,
    [payload.id, payload.device_id, payload.area_id, payload.name, payload.type,
      payload.unit, payload.physical_min, payload.physical_max, payload.is_active],
  );

  return getById(actor, payload.id);
}

/** Edit or deactivate a sensor; historical measurements are preserved. */
async function update(actor, id, payload) {
  const current = await getById(actor, id);

  const min = payload.physical_min ?? current.physical_min;
  const max = payload.physical_max ?? current.physical_max;
  if (Number(min) >= Number(max)) {
    throw badRequest('The physical range is inconsistent.', [
      { field: 'physical_min', issue: 'The minimum must be lower than the maximum.' },
    ]);
  }

  await db.query(
    `UPDATE sensors
        SET name         = COALESCE($1, name),
            unit         = COALESCE($2, unit),
            area_id      = COALESCE($3, area_id),
            physical_min = COALESCE($4, physical_min),
            physical_max = COALESCE($5, physical_max),
            is_active    = COALESCE($6, is_active),
            updated_at   = NOW()
      WHERE id = $7`,
    [payload.name ?? null, payload.unit ?? null, payload.area_id ?? null,
      payload.physical_min ?? null, payload.physical_max ?? null, payload.is_active ?? null, id],
  );

  return getById(actor, id);
}

module.exports = { list, getById, create, update, findForIngestion, SENSOR_TYPES };
