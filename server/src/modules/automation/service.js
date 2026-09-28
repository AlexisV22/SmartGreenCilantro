'use strict';

/**
 * Generic automation rules (FR-18).
 *
 * These cover the equipment that is not the irrigation pump: ventilation
 * fans, shade and auxiliary lighting. A rule fires only while its area is in
 * AUTOMATIC mode, and releases with hysteresis so the actuator does not
 * oscillate around the threshold.
 */

const db = require('../../db');
const alerts = require('../alerts/service');
const actuators = require('../actuators/service');
const commands = require('../commands/service');
const { notFound, badRequest } = require('../../middleware/errors');
const { logSystem } = require('../../utils/logger');
const settings = require('../../utils/settings');

/** Hour of day (0-23) in the greenhouse time zone, not in UTC. */
function localHour(timeZone, date = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date));
  } catch {
    return date.getUTCHours();
  }
}

async function list({ areaId = null } = {}) {
  return db.rows(
    `SELECT r.*, a.name AS area_name, a.mode, u.email AS updated_by_email
       FROM automation_rules r
       JOIN areas a ON a.id = r.area_id
       LEFT JOIN users u ON u.id = r.updated_by
      WHERE $1::text IS NULL OR r.area_id = $1
      ORDER BY r.area_id, r.name`,
    [areaId],
  );
}

async function getById(id) {
  const row = await db.one('SELECT * FROM automation_rules WHERE id = $1', [id]);
  if (!row) throw notFound(`No automation rule with id "${id}".`);
  return row;
}

async function update(actor, id, payload) {
  await getById(id);

  if (payload.active_from_hour !== undefined && payload.active_to_hour !== undefined
      && payload.active_from_hour !== null && payload.active_to_hour !== null
      && payload.active_from_hour >= payload.active_to_hour) {
    throw badRequest('The active hours are inconsistent.', [
      { field: 'active_from_hour', issue: 'The start hour must be earlier than the end hour.' },
    ]);
  }

  await db.query(
    `UPDATE automation_rules
        SET name             = COALESCE($1, name),
            condition        = COALESCE($2, condition),
            action           = COALESCE($3, action),
            hysteresis       = COALESCE($4, hysteresis),
            active_from_hour = COALESCE($5, active_from_hour),
            active_to_hour   = COALESCE($6, active_to_hour),
            enabled          = COALESCE($7, enabled),
            updated_by       = $8,
            updated_at       = NOW()
      WHERE id = $9`,
    [payload.name ?? null, payload.condition ?? null, payload.action ?? null,
      payload.hysteresis ?? null, payload.active_from_hour ?? null, payload.active_to_hour ?? null,
      payload.enabled ?? null, actor.id, id],
  );

  return getById(id);
}

async function create(actor, payload) {
  const area = await db.one('SELECT id FROM areas WHERE id = $1', [payload.area_id]);
  if (!area) {
    throw badRequest('The area does not exist.', [
      { field: 'area_id', issue: `Unknown area "${payload.area_id}".` },
    ]);
  }

  const created = await db.one(
    `INSERT INTO automation_rules
        (area_id, name, sensor_type, condition, actuator_type, action, hysteresis,
         active_from_hour, active_to_hour, enabled, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 1), $8, $9, COALESCE($10, TRUE), $11)
     RETURNING id`,
    [payload.area_id, payload.name, payload.sensor_type, payload.condition,
      payload.actuator_type, payload.action, payload.hysteresis ?? null,
      payload.active_from_hour ?? null, payload.active_to_hour ?? null,
      payload.enabled ?? null, actor.id],
  );

  return getById(created.id);
}

/**
 * Evaluate every enabled rule of an AUTOMATIC area (FR-18).
 * Returns the list of actions taken, for the job log and the tests.
 */
async function evaluateArea(area) {
  if (area.mode !== 'AUTOMATIC') return [];

  const rules = await db.rows(
    'SELECT * FROM automation_rules WHERE area_id = $1 AND enabled',
    [area.id],
  );
  const taken = [];

  for (const rule of rules) {
    // Current value of the driving variable.
    const latest = await db.one(
      `SELECT v.value, v.recorded_at
         FROM v_latest_measurements v
        WHERE v.area_id = $1 AND v.sensor_type = $2 AND v.is_anomaly = FALSE
        ORDER BY v.recorded_at DESC LIMIT 1`,
      [area.id, rule.sensor_type],
    );
    if (!latest) continue;

    const threshold = await alerts.resolveThreshold({ area_id: area.id, type: rule.sensor_type });
    if (!threshold) continue;

    const targets = await actuators.findByType(area.id, rule.actuator_type);
    if (!targets.length) continue;
    const actuator = targets[0];

    if (await commands.hasInFlight(actuator.id)) continue;

    // Optional daytime window (the auxiliary lighting rule).
    if (rule.active_from_hour !== null && rule.active_to_hour !== null) {
      const timeZone = await settings.getString('platform.timezone', 'America/Mexico_City');
      const hour = localHour(timeZone);
      if (hour < rule.active_from_hour || hour >= rule.active_to_hour) {
        // Outside the window the equipment must be off.
        if (actuator.state === 'ON') {
          const command = await commands.createCommand({
            actuatorId: actuator.id, action: 'OFF', source: 'AUTOMATIC',
            reason: `Outside the configured operating hours (${rule.active_from_hour}:00-${rule.active_to_hour}:00, ${timeZone}).`,
          });
          taken.push({ rule: rule.id, action: 'OFF', command_id: command.id });
        }
        continue;
      }
    }

    const value = Number(latest.value);
    const min = Number(threshold.min_value);
    const max = Number(threshold.max_value);
    const hysteresis = Number(rule.hysteresis);

    // Engage when the condition is met, release once the variable came back
    // past the threshold by the hysteresis margin.
    const engaged = rule.condition === 'ABOVE_MAX' ? value > max : value < min;
    const released = rule.condition === 'ABOVE_MAX' ? value < max - hysteresis : value > min + hysteresis;

    const desired = engaged ? rule.action : (released ? (rule.action === 'ON' ? 'OFF' : 'ON') : null);
    if (!desired || desired === actuator.state) continue;

    const reason = engaged
      ? `${rule.name}: ${rule.sensor_type} is ${value} ${threshold.unit} (${rule.condition === 'ABOVE_MAX' ? `above ${max}` : `below ${min}`} ${threshold.unit}).`
      : `${rule.name}: ${rule.sensor_type} returned to ${value} ${threshold.unit}, inside the optimal range.`;

    const command = await commands.createCommand({
      actuatorId: actuator.id,
      action: desired,
      source: 'AUTOMATIC',
      reason,
      enforceManualMode: false,
    });

    logSystem('INFO', 'automationEngine', reason, { command_id: command.id, rule_id: rule.id });
    taken.push({ rule: rule.id, action: desired, command_id: command.id, reason });
  }

  return taken;
}

module.exports = {
  localHour, list, getById, create, update, evaluateArea,
};
