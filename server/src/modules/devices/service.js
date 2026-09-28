'use strict';

/**
 * IoT device registry (US-25, FR-05).
 *
 * The plain API key exists only in the response of the registration and the
 * key-rotation endpoints; the database keeps nothing but its SHA-256 digest
 * (US25-T4, NFR-09). Devices are deactivated, never deleted, so their
 * historical measurements keep a valid foreign key.
 */

const db = require('../../db');
const rbac = require('../../middleware/rbac');
const { hashApiKey, generateApiKey } = require('../../middleware/apiKey');
const { notFound, conflict, badRequest } = require('../../middleware/errors');
const settings = require('../../utils/settings');
const events = require('../events/service');

const PUBLIC_COLUMNS = `d.id AS device_id, d.id, d.name, d.mac_address, d.location,
                        d.organization_id, d.greenhouse_id, d.area_id,
                        d.firmware, d.is_active, d.last_seen, d.created_at, d.updated_at`;

/** ONLINE while the device reported inside the configured window (FR-11). */
async function withConnectivity(rows) {
  const offlineMinutes = await settings.getNumber('device.offline_minutes', 5);
  const cutoff = Date.now() - offlineMinutes * 60 * 1000;

  return rows.map((row) => ({
    ...row,
    connectivity: !row.is_active
      ? 'DISABLED'
      : (row.last_seen && new Date(row.last_seen).getTime() >= cutoff ? 'ONLINE' : 'OFFLINE'),
  }));
}

async function list(actor) {
  const rows = await db.rows(
    `SELECT ${PUBLIC_COLUMNS},
            (SELECT COUNT(*) FROM sensors s   WHERE s.device_id = d.id) AS sensor_count,
            (SELECT COUNT(*) FROM actuators a WHERE a.device_id = d.id) AS actuator_count
       FROM devices d
      WHERE $1::text IS NULL OR d.organization_id = $1
      ORDER BY d.name`,
    [rbac.organizationScope(actor)],
  );
  return withConnectivity(rows);
}

async function getById(actor, id) {
  const row = await db.one(
    `SELECT ${PUBLIC_COLUMNS} FROM devices d
      WHERE d.id = $1 AND ($2::text IS NULL OR d.organization_id = $2)`,
    [id, rbac.organizationScope(actor)],
  );
  if (!row) throw notFound(`No device with id "${id}".`);
  return (await withConnectivity([row]))[0];
}

/**
 * Register a device and return the plain API key exactly once.
 * The caller is told explicitly that the key cannot be retrieved again.
 */
async function create(actor, payload) {
  const id = payload.id || `dev-node-${Date.now().toString(36)}`;

  const existing = await db.one(
    'SELECT id FROM devices WHERE id = $1 OR (mac_address IS NOT NULL AND mac_address = $2)',
    [id, payload.mac_address || null],
  );
  if (existing) {
    throw conflict('A device with that id or MAC address is already registered.', [
      { field: 'mac_address', issue: 'Already registered.' },
    ]);
  }

  const organizationId = rbac.isSuperAdmin(actor)
    ? (payload.organization_id || actor.organization_id)
    : actor.organization_id;

  const plainKey = generateApiKey();

  await db.query(
    `INSERT INTO devices (id, organization_id, greenhouse_id, area_id, name, mac_address,
                          location, api_key_hash, firmware, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, TRUE))`,
    [id, organizationId, payload.greenhouse_id || null, payload.area_id || null,
      payload.name, payload.mac_address || null, payload.location || null,
      hashApiKey(plainKey), payload.firmware || null, payload.is_active],
  );

  const device = await getById(actor, id);

  return {
    ...device,
    status: 'REGISTERED',
    // Shown once. Never stored, never returned again (US25-T4).
    api_key: plainKey,
    api_key_notice: 'Store this key now: it is shown only once and cannot be recovered.',
  };
}

/** Edit metadata or deactivate a device — deletion is never offered. */
async function update(actor, id, payload) {
  await getById(actor, id);

  await db.query(
    `UPDATE devices
        SET name          = COALESCE($1, name),
            location      = COALESCE($2, location),
            greenhouse_id = COALESCE($3, greenhouse_id),
            area_id       = COALESCE($4, area_id),
            firmware      = COALESCE($5, firmware),
            is_active     = COALESCE($6, is_active),
            updated_at    = NOW()
      WHERE id = $7`,
    [payload.name ?? null, payload.location ?? null, payload.greenhouse_id ?? null,
      payload.area_id ?? null, payload.firmware ?? null, payload.is_active ?? null, id],
  );

  return getById(actor, id);
}

/** Replace the API key of a device; the old key stops working immediately. */
async function rotateKey(actor, id) {
  await getById(actor, id);

  const plainKey = generateApiKey();
  await db.query('UPDATE devices SET api_key_hash = $1, updated_at = NOW() WHERE id = $2',
    [hashApiKey(plainKey), id]);

  const device = await getById(actor, id);
  return {
    ...device,
    api_key: plainKey,
    api_key_notice: 'The previous key was revoked. Store this one now: it is shown only once.',
  };
}

/**
 * POST /devices/heartbeat — device-authenticated liveness ping.
 * `last_seen` is already refreshed by the apikey middleware; this endpoint
 * lets the firmware report its firmware version and confirm connectivity.
 */
async function heartbeat(device, payload = {}) {
  if (payload.firmware) {
    await db.query('UPDATE devices SET firmware = $1, updated_at = NOW() WHERE id = $2',
      [payload.firmware, device.id]);
  }

  // The heartbeat may carry the current state of the device actuators
  // ({ actuators: [{ id, state }] }). This keeps them from being shown as
  // OFFLINE while nothing changes (US-14); an event is only written when the
  // reported state differs from the stored one (for example after a reboot).
  let actuatorsRefreshed = 0;
  for (const item of Array.isArray(payload.actuators) ? payload.actuators : []) {
    if (!item || typeof item.id !== 'string' || !['ON', 'OFF'].includes(item.state)) continue;
    const previous = await db.one(
      'SELECT state FROM actuators WHERE id = $1 AND device_id = $2 AND is_active', [item.id, device.id],
    );
    if (!previous) continue;
    await db.query(
      'UPDATE actuators SET state = $1, last_update = NOW(), updated_at = NOW() WHERE id = $2',
      [item.state, item.id],
    );
    if (previous.state !== item.state && previous.state !== 'OFFLINE') {
      await events.recordEvent({
        actuatorId: item.id, action: item.state, source: 'SYSTEM',
        reason: `State ${item.state} reported by the device heartbeat (was ${previous.state}).`,
      });
    }
    actuatorsRefreshed += 1;
  }

  const offlineMinutes = await settings.getNumber('device.offline_minutes', 5);
  return {
    device_id: device.id,
    status: 'ONLINE',
    actuators_refreshed: actuatorsRefreshed,
    server_time: new Date().toISOString(),
    offline_after_minutes: offlineMinutes,
  };
}

/** Validate that a target area belongs to the actor before assigning it. */
async function assertAreaVisible(actor, areaId) {
  if (!areaId) return;
  const area = await db.one(
    `SELECT a.id FROM areas a
       JOIN greenhouses g ON g.id = a.greenhouse_id
      WHERE a.id = $1 AND ($2::text IS NULL OR g.organization_id = $2)`,
    [areaId, rbac.organizationScope(actor)],
  );
  if (!area) {
    throw badRequest('The area does not exist or is not visible to you.', [
      { field: 'area_id', issue: `Unknown area "${areaId}".` },
    ]);
  }
}

module.exports = { list, getById, create, update, rotateKey, heartbeat, assertAreaVisible };
