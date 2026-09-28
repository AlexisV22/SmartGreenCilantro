'use strict';

/**
 * Cultivation areas (FR-07) and their operating mode (US15-T4).
 *
 * Assigning a crop type to an area auto-configures its thresholds from the
 * crop defaults, which is the "Register kind of crop → automatic
 * configuration parameters" functionality of the Administrator role.
 */

const db = require('../../db');
const rbac = require('../../middleware/rbac');
const { notFound, conflict, badRequest } = require('../../middleware/errors');

/** Crop columns mapped to the sensor type and unit of the threshold rows. */
const CROP_RANGE_MAP = [
  { type: 'temperature',   min: 'temperature_min',   max: 'temperature_max',   unit: 'C' },
  { type: 'air_humidity',  min: 'air_humidity_min',  max: 'air_humidity_max',  unit: '%' },
  { type: 'soil_moisture', min: 'soil_moisture_min', max: 'soil_moisture_max', unit: '%' },
  { type: 'light',         min: 'light_min',         max: 'light_max',         unit: 'lux' },
  { type: 'co2',           min: 'co2_min',           max: 'co2_max',           unit: 'ppm' },
  { type: 'ph',            min: 'ph_min',            max: 'ph_max',            unit: 'pH' },
  { type: 'water_level',   min: 'water_level_min',   max: 'water_level_max',   unit: '%' },
];

const baseQuery = `
  SELECT a.*, g.organization_id, g.name AS greenhouse_name, c.name AS crop_name,
         ic.enabled AS irrigation_enabled, ic.target_moisture
    FROM areas a
    JOIN greenhouses g ON g.id = a.greenhouse_id
    LEFT JOIN crop_types c        ON c.id = a.crop_type_id
    LEFT JOIN irrigation_config ic ON ic.area_id = a.id`;

async function list(actor, { greenhouseId = null } = {}) {
  const scope = rbac.organizationScope(actor);
  return db.rows(
    `${baseQuery}
      WHERE ($1::text IS NULL OR g.organization_id = $1)
        AND ($2::text IS NULL OR a.greenhouse_id = $2)
      ORDER BY a.greenhouse_id, a.name`,
    [scope, greenhouseId],
  );
}

async function getById(actor, id) {
  const scope = rbac.organizationScope(actor);
  const row = await db.one(
    `${baseQuery} WHERE a.id = $1 AND ($2::text IS NULL OR g.organization_id = $2)`,
    [id, scope],
  );
  if (!row) throw notFound(`No area with id "${id}".`);
  return row;
}

/**
 * Write the crop default ranges into the thresholds of an area.
 * Existing rows are updated so the screen immediately reflects the crop.
 */
async function applyCropThresholds(areaId, cropTypeId, userId) {
  const crop = await db.one('SELECT * FROM crop_types WHERE id = $1', [cropTypeId]);
  if (!crop) {
    throw badRequest('The requested crop type does not exist.', [
      { field: 'crop_type_id', issue: `Unknown crop type "${cropTypeId}".` },
    ]);
  }

  const area = await db.one('SELECT crop_stage FROM areas WHERE id = $1', [areaId]);
  const stage = (area && area.crop_stage) || crop.default_crop_stage || 'vegetative';
  const applied = [];

  await db.withTransaction(async (client) => {
    for (const range of CROP_RANGE_MAP) {
      const min = crop[range.min];
      const max = crop[range.max];
      // A crop may leave an optional variable (CO2, pH) undefined.
      if (min === null || max === null || min === undefined || max === undefined) continue;

      await client.query(
        `INSERT INTO thresholds (id, area_id, sensor_type, min_value, max_value, unit, crop_stage, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (area_id, sensor_type, crop_stage) WHERE area_id IS NOT NULL
         DO UPDATE SET min_value = EXCLUDED.min_value,
                       max_value = EXCLUDED.max_value,
                       unit      = EXCLUDED.unit,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()`,
        [
          `th-${areaId.toLowerCase()}-${range.type.replace(/_/g, '-')}`,
          areaId, range.type, min, max, range.unit, stage, userId || null,
        ],
      );
      applied.push({ sensor_type: range.type, min_value: min, max_value: max, unit: range.unit });
    }
  });

  return applied;
}

async function create(actor, payload) {
  const existing = await db.one('SELECT id FROM areas WHERE id = $1', [payload.id]);
  if (existing) throw conflict(`An area with id "${payload.id}" already exists.`);

  // The greenhouse must be visible to the actor.
  const greenhouse = await db.one(
    'SELECT g.id FROM greenhouses g WHERE g.id = $1 AND ($2::text IS NULL OR g.organization_id = $2)',
    [payload.greenhouse_id, rbac.organizationScope(actor)],
  );
  if (!greenhouse) {
    throw badRequest('The greenhouse does not exist or is not visible to you.', [
      { field: 'greenhouse_id', issue: `Unknown greenhouse "${payload.greenhouse_id}".` },
    ]);
  }

  await db.query(
    `INSERT INTO areas (id, greenhouse_id, name, crop_type_id, crop_stage, mode)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'vegetative'), COALESCE($6, 'MANUAL'))`,
    [payload.id, payload.greenhouse_id, payload.name, payload.crop_type_id || null,
      payload.crop_stage, payload.mode],
  );

  // Every area gets an irrigation configuration so the engine can run on it.
  await db.query(
    'INSERT INTO irrigation_config (area_id) VALUES ($1) ON CONFLICT (area_id) DO NOTHING',
    [payload.id],
  );

  if (payload.crop_type_id) {
    await applyCropThresholds(payload.id, payload.crop_type_id, actor.id);
  }

  return getById(actor, payload.id);
}

async function update(actor, id, payload) {
  await getById(actor, id);

  await db.query(
    `UPDATE areas
        SET name         = COALESCE($1, name),
            crop_type_id = COALESCE($2, crop_type_id),
            crop_stage   = COALESCE($3, crop_stage),
            is_active    = COALESCE($4, is_active),
            updated_at   = NOW()
      WHERE id = $5`,
    [payload.name ?? null, payload.crop_type_id ?? null, payload.crop_stage ?? null,
      payload.is_active ?? null, id],
  );

  // Changing the crop re-applies its default ranges (Administrator feature).
  if (payload.crop_type_id) {
    await applyCropThresholds(id, payload.crop_type_id, actor.id);
  }

  return getById(actor, id);
}

/**
 * PATCH /areas/:id/mode — MANUAL disables the automation engines entirely,
 * AUTOMATIC re-enables them (US15-T4, US16-T3).
 */
async function setMode(actor, id, mode) {
  await getById(actor, id);
  await db.query('UPDATE areas SET mode = $1, updated_at = NOW() WHERE id = $2', [mode, id]);
  return getById(actor, id);
}

module.exports = { list, getById, create, update, setMode, applyCropThresholds, CROP_RANGE_MAP };
