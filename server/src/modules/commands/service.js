'use strict';

/**
 * Actuator command flow (US-15).
 *
 *   web/API  ->  actuator_commands (PENDING)
 *   device   ->  GET /devices/me/commands   (marks SENT)
 *   device   ->  POST /actuators/:id/state  (marks EXECUTED, records event)
 *
 * The device polls, so the greenhouse never needs an inbound connection. A
 * command that nobody collects before `expires_at` becomes EXPIRED, which is
 * what the "offline device" case of US15-T5 verifies.
 */

const db = require('../../db');
const settings = require('../../utils/settings');
const events = require('../events/service');
const { notFound, badRequest, conflict } = require('../../middleware/errors');
const { logSystem } = require('../../utils/logger');

/** Load an actuator together with the operating mode of its area. */
async function loadActuator(actuatorId) {
  const actuator = await db.one(
    `SELECT a.*, ar.mode AS area_mode, ar.name AS area_name,
            ic.max_duration_min
       FROM actuators a
       JOIN areas ar ON ar.id = a.area_id
       LEFT JOIN irrigation_config ic ON ic.area_id = a.area_id
      WHERE a.id = $1`,
    [actuatorId],
  );
  if (!actuator) throw notFound(`No actuator with id "${actuatorId}".`);
  return actuator;
}

/**
 * Queue a command.
 *
 * @param {object}   options
 * @param {string}   options.actuatorId
 * @param {string}   options.action       ON | OFF
 * @param {number?}  options.durationMin
 * @param {string}   options.source       MANUAL | AUTOMATIC | AI
 * @param {object?}  options.user         requesting user, for MANUAL/AI
 * @param {string?}  options.reason
 * @param {boolean}  options.enforceManualMode  reject when the area is AUTOMATIC
 */
async function createCommand({
  actuatorId, action, durationMin = null, source, user = null, reason = null,
  enforceManualMode = false,
}) {
  const actuator = await loadActuator(actuatorId);

  if (!actuator.is_active) {
    throw badRequest('The actuator is deactivated.', [
      { field: 'actuator_id', issue: `Actuator "${actuatorId}" is not active.` },
    ]);
  }

  // A user may only drive an actuator by hand while its area is in MANUAL
  // mode; otherwise the automation engine owns it (US15-T2, US15-T4).
  if (enforceManualMode && actuator.area_mode !== 'MANUAL') {
    throw badRequest(
      `Area ${actuator.area_id} is in AUTOMATIC mode. Switch it to MANUAL before sending commands by hand.`,
      [{ field: 'mode', issue: 'The area is in AUTOMATIC mode.' }],
    );
  }

  // The configured maximum protects the crop from an over-long irrigation.
  const maxDuration = actuator.max_duration_min === null || actuator.max_duration_min === undefined
    ? 10
    : Number(actuator.max_duration_min);

  if (action === 'ON' && durationMin !== null && durationMin !== undefined) {
    if (Number(durationMin) <= 0) {
      throw badRequest('The duration must be greater than zero.', [
        { field: 'duration_min', issue: 'Must be a positive number of minutes.' },
      ]);
    }
    if (Number(durationMin) > maxDuration) {
      throw badRequest(
        `The duration exceeds the maximum configured for this area (${maxDuration} min).`,
        [{ field: 'duration_min', issue: `Maximum allowed: ${maxDuration} minutes.` }],
      );
    }
  }

  // Never queue a second command while one is still in flight (US16-T3).
  const inFlight = await db.one(
    `SELECT id, status FROM actuator_commands
      WHERE actuator_id = $1 AND status IN ('PENDING', 'SENT')
      ORDER BY created_at DESC LIMIT 1`,
    [actuatorId],
  );
  if (inFlight) {
    throw conflict(
      'Another command for this actuator is still pending execution.',
      [{ field: 'actuator_id', issue: `Command ${inFlight.id} is ${inFlight.status}.` }],
    );
  }

  const expirySeconds = await settings.getNumber('command.expiry_seconds', 60);

  const command = await db.one(
    `INSERT INTO actuator_commands
        (actuator_id, action, duration_min, source, reason, requested_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' seconds')::interval)
     RETURNING *`,
    [actuatorId, action, durationMin, source, reason, user ? user.id : null, String(expirySeconds)],
  );

  logSystem('INFO', 'commands',
    `Queued ${action} for ${actuatorId} (source ${source}, ${durationMin ?? 'n/a'} min)`,
    { command_id: command.id });

  return command;
}

/**
 * GET /api/devices/me/commands — the device collects its pending work.
 * Collected commands move to SENT so they are handed out only once.
 */
async function collectForDevice(deviceId) {
  await expireStale();

  const commands = await db.rows(
    `UPDATE actuator_commands c
        SET status = 'SENT', sent_at = NOW()
       FROM actuators a
      WHERE a.id = c.actuator_id
        AND a.device_id = $1
        AND c.status = 'PENDING'
        AND c.expires_at > NOW()
      RETURNING c.id, c.actuator_id, c.action, c.duration_min, c.source, c.created_at, c.expires_at`,
    [deviceId],
  );

  return commands;
}

/**
 * POST /api/actuators/:id/state — the device confirms the new state.
 * Marks the matching command EXECUTED and appends the event (US-17).
 */
async function reportState({ actuatorId, state, deviceId = null, durationMin = null }) {
  const actuator = await loadActuator(actuatorId);

  if (deviceId && actuator.device_id !== deviceId) {
    throw notFound(`No actuator with id "${actuatorId}" on this device.`);
  }

  return db.withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE actuators SET state = $1, last_update = NOW(), updated_at = NOW()
        WHERE id = $2 RETURNING *`,
      [state, actuatorId],
    );

    // Close the most recent command that is waiting for this confirmation.
    const commandResult = await client.query(
      `UPDATE actuator_commands
          SET status = 'EXECUTED', executed_at = NOW()
        WHERE id = (
          SELECT id FROM actuator_commands
           WHERE actuator_id = $1 AND status IN ('PENDING', 'SENT') AND action = $2
           ORDER BY created_at DESC LIMIT 1
        )
        RETURNING *`,
      [actuatorId, state],
    );
    const command = commandResult.rows[0] || null;

    await events.recordEvent({
      actuatorId,
      commandId: command ? command.id : null,
      action: state,
      source: command ? command.source : 'SYSTEM',
      userId: command ? command.requested_by : null,
      reason: command ? command.reason : 'State reported by the device.',
      durationMin: durationMin !== null ? durationMin : (command ? command.duration_min : null),
    }, client);

    return { actuator: updated.rows[0], command };
  });
}

/** Mark as EXPIRED every command the device never collected (US15-T5). */
async function expireStale() {
  const result = await db.query(
    `UPDATE actuator_commands
        SET status = 'EXPIRED'
      WHERE status IN ('PENDING', 'SENT') AND expires_at < NOW()
      RETURNING id, actuator_id`,
  );
  if (result.rowCount) {
    logSystem('WARN', 'commands',
      `${result.rowCount} command(s) expired without being executed by the device.`);
  }
  return result.rowCount;
}

/** True when a command is still waiting; used by the automation engines. */
async function hasInFlight(actuatorId) {
  const row = await db.one(
    `SELECT 1 FROM actuator_commands
      WHERE actuator_id = $1 AND status IN ('PENDING', 'SENT') AND expires_at > NOW()
      LIMIT 1`,
    [actuatorId],
  );
  return !!row;
}

async function listForActuator(actuatorId, limit = 50) {
  return db.rows(
    `SELECT * FROM actuator_commands WHERE actuator_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [actuatorId, limit],
  );
}

module.exports = {
  createCommand,
  collectForDevice,
  reportState,
  expireStale,
  hasInFlight,
  listForActuator,
  loadActuator,
};
