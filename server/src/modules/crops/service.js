'use strict';

/**
 * Crop catalogue (Administrator: "Register kind of crop").
 *
 * Each crop carries the agronomic ranges that become the thresholds of any
 * area it is assigned to, which is how selecting a crop auto-configures the
 * greenhouse.
 */

const db = require('../../db');
const areasService = require('../areas/service');
const { notFound, conflict, badRequest } = require('../../middleware/errors');

async function list() {
  return db.rows('SELECT * FROM crop_types ORDER BY name');
}

async function getById(id) {
  const row = await db.one('SELECT * FROM crop_types WHERE id = $1', [id]);
  if (!row) throw notFound(`No crop type with id "${id}".`);
  return row;
}

const RANGE_COLUMNS = [
  'temperature_min', 'temperature_max',
  'air_humidity_min', 'air_humidity_max',
  'soil_moisture_min', 'soil_moisture_max',
  'light_min', 'light_max',
  'co2_min', 'co2_max',
  'ph_min', 'ph_max',
  'water_level_min', 'water_level_max',
];

/** Reject a crop whose min is not strictly below its max. */
function validateRanges(payload) {
  const details = [];
  for (const variable of ['temperature', 'air_humidity', 'soil_moisture', 'light', 'co2', 'ph', 'water_level']) {
    const min = payload[`${variable}_min`];
    const max = payload[`${variable}_max`];
    if (min === undefined || max === undefined || min === null || max === null) continue;
    if (Number(min) >= Number(max)) {
      details.push({ field: `${variable}_min`, issue: `The minimum must be lower than the maximum for ${variable}.` });
    }
  }
  if (details.length) throw badRequest('The crop ranges are inconsistent.', details);
}

async function create(payload) {
  validateRanges(payload);

  const id = payload.id || `crop-${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const existing = await db.one('SELECT id FROM crop_types WHERE id = $1 OR name = $2', [id, payload.name]);
  if (existing) throw conflict('A crop type with that id or name already exists.');

  const columns = ['id', 'name', 'description', 'default_crop_stage', ...RANGE_COLUMNS];
  const values = [id, payload.name, payload.description || null, payload.default_crop_stage || 'vegetative',
    ...RANGE_COLUMNS.map((c) => (payload[c] === undefined ? null : payload[c]))];

  await db.query(
    `INSERT INTO crop_types (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    values,
  );
  return getById(id);
}

async function update(id, payload) {
  const current = await getById(id);
  validateRanges({ ...current, ...payload });

  const assignments = [];
  const params = [];
  const push = (column, value) => { params.push(value); assignments.push(`${column} = $${params.length}`); };

  if (payload.name !== undefined) push('name', payload.name);
  if (payload.description !== undefined) push('description', payload.description);
  if (payload.default_crop_stage !== undefined) push('default_crop_stage', payload.default_crop_stage);
  if (payload.is_active !== undefined) push('is_active', payload.is_active);
  for (const column of RANGE_COLUMNS) {
    if (payload[column] !== undefined) push(column, payload[column]);
  }

  if (assignments.length) {
    params.push(id);
    await db.query(
      `UPDATE crop_types SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params,
    );
  }

  return getById(id);
}

/**
 * POST /crops/:id/apply/:areaId — push the crop ranges into an area.
 * Returns the thresholds that were written, so the admin screen can show
 * exactly what changed.
 */
async function applyToArea(actor, cropId, areaId) {
  await getById(cropId);
  await areasService.getById(actor, areaId);

  await db.query('UPDATE areas SET crop_type_id = $1, updated_at = NOW() WHERE id = $2', [cropId, areaId]);
  const applied = await areasService.applyCropThresholds(areaId, cropId, actor.id);

  return { area_id: areaId, crop_type_id: cropId, thresholds: applied };
}

module.exports = { list, getById, create, update, applyToArea };
