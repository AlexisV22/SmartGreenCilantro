'use strict';

/**
 * Threshold configuration (US-10, FR-12).
 *
 * Validation rules of US10-T3:
 *   * min must be strictly lower than max
 *   * both values must sit inside the physical range of the sensors of that
 *     type in the area (a threshold the hardware can never reach is useless)
 *   * only an Administrator may save, and the change records updated_by/at
 */

const db = require('../../db');
const rbac = require('../../middleware/rbac');
const { notFound, badRequest, conflict } = require('../../middleware/errors');

const baseQuery = `
  SELECT t.id, t.area_id, t.greenhouse_id, t.crop_stage, t.updated_at, t.updated_by,
         t.sensor_type AS parameter, t.sensor_type,
         t.min_value, t.max_value, t.unit,
         u.email AS updated_by_email,
         ar.name AS area_name
    FROM thresholds t
    LEFT JOIN users u  ON u.id = t.updated_by
    LEFT JOIN areas ar ON ar.id = t.area_id`;

async function list(actor, { areaId = null, sensorType = null } = {}) {
  const scope = rbac.organizationScope(actor);
  return db.rows(
    `${baseQuery}
      LEFT JOIN greenhouses g ON g.id = COALESCE(ar.greenhouse_id, t.greenhouse_id)
      WHERE ($1::text IS NULL OR g.organization_id = $1)
        AND ($2::text IS NULL OR t.area_id     = $2)
        AND ($3::text IS NULL OR t.sensor_type = $3)
      ORDER BY t.area_id, t.sensor_type`,
    [scope, areaId, sensorType],
  );
}

async function getById(actor, id) {
  const row = await db.one(`${baseQuery} WHERE t.id = $1`, [id]);
  if (!row) throw notFound(`No threshold with id "${id}".`);

  const scope = rbac.organizationScope(actor);
  if (scope && row.area_id) {
    const visible = await db.one(
      `SELECT 1 FROM areas a JOIN greenhouses g ON g.id = a.greenhouse_id
        WHERE a.id = $1 AND g.organization_id = $2`,
      [row.area_id, scope],
    );
    if (!visible) throw notFound(`No threshold with id "${id}".`);
  }
  return row;
}

/**
 * Check min < max and that the values are reachable by the hardware.
 * The physical bounds come from the sensors of that type in the area.
 */
async function validateRange({ areaId, sensorType, minValue, maxValue }) {
  const details = [];

  if (!(Number(minValue) < Number(maxValue))) {
    details.push({ field: 'min_value', issue: 'The minimum must be strictly lower than the maximum.' });
  }

  if (areaId) {
    const bounds = await db.one(
      `SELECT MIN(physical_min)::float AS pmin, MAX(physical_max)::float AS pmax
         FROM sensors WHERE area_id = $1 AND type = $2 AND is_active`,
      [areaId, sensorType],
    );

    if (bounds && bounds.pmin !== null) {
      if (Number(minValue) < bounds.pmin) {
        details.push({ field: 'min_value', issue: `Below the physical range of the sensors (${bounds.pmin}).` });
      }
      if (Number(maxValue) > bounds.pmax) {
        details.push({ field: 'max_value', issue: `Above the physical range of the sensors (${bounds.pmax}).` });
      }
    }
  }

  if (details.length) {
    throw badRequest('The threshold values are invalid.', details);
  }
}

async function create(actor, payload) {
  if (!payload.area_id && !payload.greenhouse_id) {
    throw badRequest('A threshold must belong to an area or to a greenhouse.', [
      { field: 'area_id', issue: 'Provide area_id or greenhouse_id.' },
    ]);
  }

  await validateRange({
    areaId: payload.area_id || null,
    sensorType: payload.sensor_type,
    minValue: payload.min_value,
    maxValue: payload.max_value,
  });

  const duplicate = await db.one(
    `SELECT id FROM thresholds
      WHERE sensor_type = $1 AND crop_stage = COALESCE($2, 'vegetative')
        AND ((area_id IS NOT NULL AND area_id = $3) OR (area_id IS NULL AND greenhouse_id = $4))`,
    [payload.sensor_type, payload.crop_stage || null, payload.area_id || null, payload.greenhouse_id || null],
  );
  if (duplicate) {
    throw conflict('A threshold already exists for that scope, variable and crop stage.', [
      { field: 'sensor_type', issue: `Existing threshold: ${duplicate.id}.` },
    ]);
  }

  const created = await db.one(
    `INSERT INTO thresholds (area_id, greenhouse_id, sensor_type, min_value, max_value, unit, crop_stage, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'vegetative'), $8)
     RETURNING id`,
    [payload.area_id || null, payload.greenhouse_id || null, payload.sensor_type,
      payload.min_value, payload.max_value, payload.unit, payload.crop_stage || null, actor.id],
  );

  return getById(actor, created.id);
}

/** PUT /api/thresholds/:id — the save action of the configuration screen. */
async function update(actor, id, payload) {
  const current = await getById(actor, id);

  const minValue = payload.min_value ?? current.min_value;
  const maxValue = payload.max_value ?? current.max_value;

  await validateRange({
    areaId: current.area_id,
    sensorType: current.sensor_type,
    minValue,
    maxValue,
  });

  await db.query(
    `UPDATE thresholds
        SET min_value  = $1,
            max_value  = $2,
            unit       = COALESCE($3, unit),
            crop_stage = COALESCE($4, crop_stage),
            updated_by = $5,
            updated_at = NOW()
      WHERE id = $6`,
    [minValue, maxValue, payload.unit ?? null, payload.crop_stage ?? null, actor.id, id],
  );

  return getById(actor, id);
}

module.exports = { list, getById, create, update, validateRange };
