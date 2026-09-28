'use strict';

/**
 * Device authentication for the IoT nodes (US06-T2, US25-T4, NFR-09).
 *
 * The firmware sends `apikey: <plain key>`. Only the SHA-256 digest of the
 * key is stored, so a database dump never exposes a usable credential. A
 * deactivated device is rejected with 401, which is what US25-T5 verifies.
 */

const crypto = require('crypto');
const db = require('../db');
const { unauthorized } = require('./errors');

/** SHA-256 digest used both to store and to look up an API key. */
function hashApiKey(plainKey) {
  return crypto.createHash('sha256').update(String(plainKey), 'utf8').digest('hex');
}

/** Generate a new device key. The plain value is returned to the caller once. */
function generateApiKey() {
  return `sec_iot_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Require a valid device API key and populate `req.device`.
 * `devices.last_seen` is refreshed so the connectivity job and the dashboard
 * indicator stay accurate (FR-11).
 */
async function requireDeviceKey(req, _res, next) {
  try {
    const provided = req.get('apikey');
    if (!provided) {
      throw unauthorized('A device API key is required in the "apikey" header.');
    }

    const device = await db.one(
      `SELECT id, name, organization_id, greenhouse_id, area_id, is_active, firmware
         FROM devices
        WHERE api_key_hash = $1`,
      [hashApiKey(provided)],
    );

    // The same generic message for unknown and inactive keys: the caller must
    // not be able to tell whether a device id exists.
    if (!device || !device.is_active) {
      throw unauthorized('The device API key is invalid or the device is deactivated.');
    }

    await db.query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [device.id]);

    req.device = device;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { hashApiKey, generateApiKey, requireDeviceKey };
