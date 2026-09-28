'use strict';

/**
 * Device connectivity monitor (FR-11, US27-T4).
 *
 * A device whose last contact is older than `device.offline_minutes` raises a
 * DEVICE_OFFLINE alert; when it reports again the alert resolves itself and
 * the dashboard indicator returns to ONLINE.
 */

const db = require('../db');
const settings = require('../utils/settings');
const alerts = require('../modules/alerts/service');
const { logSystem } = require('../utils/logger');

const NAME = 'connectivityJob';
const SCHEDULE = '* * * * *';

async function run() {
  const offlineMinutes = await settings.getNumber('device.offline_minutes', 5);

  const devices = await db.rows(
    `SELECT id, name, area_id, last_seen, is_active,
            (last_seen IS NULL OR last_seen < NOW() - ($1 || ' minutes')::interval) AS is_offline
       FROM devices
      WHERE is_active`,
    [String(offlineMinutes)],
  );

  let raised = 0;
  let resolved = 0;

  for (const device of devices) {
    if (device.is_offline) {
      // A device that has never reported is not "disconnected" yet.
      if (!device.last_seen) continue;

      const result = await alerts.raiseAlert({
        deviceId: device.id,
        areaId: device.area_id,
        type: 'DEVICE_OFFLINE',
        severity: 'HIGH',
        message: `The device ${device.name} has not communicated for more than ${offlineMinutes} minutes. Check its power supply and network connection.`,
      });
      if (result.created) raised += 1;
    } else {
      resolved += await alerts.resolveAlerts({ deviceId: device.id, type: 'DEVICE_OFFLINE' });
    }
  }

  if (raised || resolved) {
    logSystem('INFO', NAME, `Connectivity check: ${raised} device(s) went offline, ${resolved} recovered.`);
  }
  return { raised, resolved };
}

module.exports = { NAME, SCHEDULE, run };
