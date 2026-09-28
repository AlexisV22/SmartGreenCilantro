'use strict';

/**
 * Automatic irrigation (US-16) — configuration and decision logic.
 *
 * Rule agreed with the Product Owner (US16-T1):
 *   in AUTOMATIC mode, if the average soil moisture of the area stays below
 *   the minimum threshold for N consecutive readings, turn the pump ON until
 *   the target moisture is reached or the maximum duration elapses, then
 *   respect a cooldown.
 *
 * Safety conditions (US16-T4), each one blocking:
 *   * the cooldown after the previous irrigation has not elapsed
 *   * the water tank is below its minimum level -> LOW_WATER alert
 *   * a soil sensor has not reported for 5 minutes (stale data)
 *   * a command is already in flight for the pump
 * MANUAL mode disables the engine entirely.
 */

const db = require('../../db');
const commands = require('../commands/service');
const alerts = require('../alerts/service');
const actuators = require('../actuators/service');
const events = require('../events/service');
const { notFound, badRequest } = require('../../middleware/errors');
const { logSystem } = require('../../utils/logger');

const STALE_MINUTES = 5;

async function getConfig(areaId) {
  const row = await db.one(
    `SELECT ic.*, a.name AS area_name, a.mode, u.email AS updated_by_email
       FROM irrigation_config ic
       JOIN areas a ON a.id = ic.area_id
       LEFT JOIN users u ON u.id = ic.updated_by
      WHERE ic.area_id = $1`,
    [areaId],
  );
  if (!row) throw notFound(`No irrigation configuration for area "${areaId}".`);
  return row;
}

async function updateConfig(actor, areaId, payload) {
  const current = await getConfig(areaId);

  const target = payload.target_moisture ?? current.target_moisture;
  const maxDuration = payload.max_duration_min ?? current.max_duration_min;
  const cooldown = payload.cooldown_min ?? current.cooldown_min;
  const readings = payload.consecutive_readings ?? current.consecutive_readings;
  const minTank = payload.min_tank_level ?? current.min_tank_level;

  const details = [];
  if (target <= 0 || target > 100) details.push({ field: 'target_moisture', issue: 'Must be between 0 and 100 %.' });
  if (maxDuration <= 0) details.push({ field: 'max_duration_min', issue: 'Must be greater than zero.' });
  if (cooldown < 0) details.push({ field: 'cooldown_min', issue: 'Cannot be negative.' });
  if (readings < 1) details.push({ field: 'consecutive_readings', issue: 'Must be at least 1.' });
  if (minTank < 0 || minTank > 100) details.push({ field: 'min_tank_level', issue: 'Must be between 0 and 100 %.' });
  if (details.length) throw badRequest('The irrigation parameters are invalid.', details);

  await db.query(
    `UPDATE irrigation_config
        SET enabled              = COALESCE($1, enabled),
            target_moisture      = $2,
            max_duration_min     = $3,
            cooldown_min         = $4,
            consecutive_readings = $5,
            min_tank_level       = $6,
            updated_by           = $7,
            updated_at           = NOW()
      WHERE area_id = $8`,
    [payload.enabled ?? null, target, maxDuration, cooldown, readings, minTank, actor.id, areaId],
  );

  return getConfig(areaId);
}

/** Latest reading of the water tank of an area, or null when not installed. */
async function tankLevel(areaId) {
  return db.one(
    `SELECT v.value, v.recorded_at
       FROM v_latest_measurements v
      WHERE v.area_id = $1 AND v.sensor_type = 'water_level'
      ORDER BY v.recorded_at DESC LIMIT 1`,
    [areaId],
  );
}

/** Instant the pump of this area was last switched ON, for the cooldown. */
async function lastIrrigationAt(areaId) {
  const row = await db.one(
    `SELECT MAX(e.created_at) AS at
       FROM actuator_events e
       JOIN actuators a ON a.id = e.actuator_id
      WHERE a.area_id = $1 AND a.type = 'irrigation_pump' AND e.action = 'ON'`,
    [areaId],
  );
  return row && row.at ? new Date(row.at) : null;
}

/**
 * The N most recent soil-moisture averages of an area, newest first.
 * Readings flagged as anomalies are excluded so a faulty sensor cannot
 * trigger irrigation (US-19 feeding US-16).
 */
async function recentMoistureAverages(areaId, samples) {
  return db.rows(
    `SELECT bucket, AVG(value)::float AS avg_value, COUNT(*)::int AS sensors
       FROM (
         SELECT date_trunc('minute', m.recorded_at) AS bucket, m.value
           FROM measurements m
           JOIN sensors s ON s.id = m.sensor_id
          WHERE s.area_id = $1 AND s.type = 'soil_moisture' AND s.is_active
            AND m.is_anomaly = FALSE
            AND m.recorded_at > NOW() - INTERVAL '2 hours'
       ) buckets
      GROUP BY bucket
      ORDER BY bucket DESC
      LIMIT $2`,
    [areaId, samples],
  );
}

/**
 * Decide what the engine should do for one area, without performing it.
 * Returning a structured decision keeps the rule testable (US16-T6).
 */
async function decide(area) {
  const config = await getConfig(area.id);
  const skip = (reason, extra = {}) => ({ action: 'SKIP', reason, ...extra });

  if (area.mode !== 'AUTOMATIC') return skip('The area is in MANUAL mode.');
  if (!config.enabled) return skip('Automatic irrigation is disabled for this area.');

  const pumps = await actuators.findByType(area.id, 'irrigation_pump');
  if (!pumps.length) return skip('The area has no active irrigation pump.');
  const pump = pumps[0];

  // Never queue a second command while one is in flight.
  if (await commands.hasInFlight(pump.id)) {
    return skip('A command for the pump is already pending execution.', { actuator_id: pump.id });
  }

  const threshold = await alerts.resolveThreshold({ area_id: area.id, type: 'soil_moisture' });
  if (!threshold) return skip('No soil-moisture threshold is configured for this area.');

  const averages = await recentMoistureAverages(area.id, config.consecutive_readings);
  if (!averages.length) return skip('No soil-moisture readings are available.');

  // --- Safety: stale sensor data (US16-T4) --------------------------------
  const newest = await db.one(
    `SELECT MAX(m.recorded_at) AS at
       FROM measurements m JOIN sensors s ON s.id = m.sensor_id
      WHERE s.area_id = $1 AND s.type = 'soil_moisture' AND s.is_active`,
    [area.id],
  );
  const ageMinutes = newest && newest.at ? (Date.now() - new Date(newest.at).getTime()) / 60000 : Infinity;
  if (ageMinutes > STALE_MINUTES) {
    return skip(`The soil sensors have not reported for ${Math.round(ageMinutes)} minutes; irrigation is blocked for safety.`,
      { blocked: true, safety: 'STALE_SENSOR', actuator_id: pump.id });
  }

  const currentMoisture = averages[0].avg_value;

  // --- Stop condition: the pump is running and reached the target ---------
  if (pump.state === 'ON') {
    if (currentMoisture >= Number(config.target_moisture)) {
      return {
        action: 'OFF',
        actuator_id: pump.id,
        reason: `Soil moisture reached the target of ${config.target_moisture} % (currently ${currentMoisture.toFixed(1)} %).`,
        current_moisture: currentMoisture,
      };
    }

    // Maximum duration reached: the device auto-stops, but the engine also
    // sends an explicit OFF so the state converges if the timer was missed.
    const startedAt = await lastIrrigationAt(area.id);
    if (startedAt && (Date.now() - startedAt.getTime()) / 60000 >= Number(config.max_duration_min)) {
      return {
        action: 'OFF',
        actuator_id: pump.id,
        reason: `The maximum irrigation duration of ${config.max_duration_min} minutes has elapsed.`,
        current_moisture: currentMoisture,
      };
    }

    return skip('Irrigation is in progress and has not reached the target yet.', { actuator_id: pump.id });
  }

  // --- Start condition: N consecutive readings below the minimum ----------
  const belowMin = averages.filter((a) => a.avg_value < Number(threshold.min_value));
  if (averages.length < config.consecutive_readings || belowMin.length < config.consecutive_readings) {
    return skip(
      `Soil moisture is ${currentMoisture.toFixed(1)} %; ${config.consecutive_readings} consecutive readings below ${threshold.min_value} % are required.`,
      { current_moisture: currentMoisture },
    );
  }

  // --- Safety: cooldown ---------------------------------------------------
  const lastAt = await lastIrrigationAt(area.id);
  if (lastAt) {
    const sinceMinutes = (Date.now() - lastAt.getTime()) / 60000;
    if (sinceMinutes < Number(config.cooldown_min)) {
      return skip(
        `The cooldown is active: ${Math.round(Number(config.cooldown_min) - sinceMinutes)} minute(s) remaining before irrigating again.`,
        { blocked: true, safety: 'COOLDOWN', actuator_id: pump.id, current_moisture: currentMoisture },
      );
    }
  }

  // --- Safety: water tank -------------------------------------------------
  const tank = await tankLevel(area.id);
  if (tank && Number(tank.value) < Number(config.min_tank_level)) {
    return {
      action: 'BLOCK_LOW_WATER',
      actuator_id: pump.id,
      reason: `The water tank is at ${tank.value} %, below the minimum of ${config.min_tank_level} % required to irrigate.`,
      blocked: true,
      safety: 'LOW_WATER',
      tank_level: Number(tank.value),
      current_moisture: currentMoisture,
    };
  }

  // --- Go -----------------------------------------------------------------
  // Duration proportional to the deficit, capped by the configured maximum.
  const deficit = Number(config.target_moisture) - currentMoisture;
  const duration = Math.min(
    Number(config.max_duration_min),
    Math.max(1, Math.round(deficit * 0.5 * 10) / 10),
  );

  return {
    action: 'ON',
    actuator_id: pump.id,
    duration_min: duration,
    reason: `Soil moisture is ${currentMoisture.toFixed(1)} %, below the minimum of ${threshold.min_value} % for ${config.consecutive_readings} consecutive readings.`,
    current_moisture: currentMoisture,
    target_moisture: Number(config.target_moisture),
  };
}

/** Apply a decision produced by `decide`. */
async function apply(area, decision) {
  if (decision.action === 'SKIP') return decision;

  if (decision.action === 'BLOCK_LOW_WATER') {
    await alerts.raiseAlert({
      areaId: area.id,
      type: 'LOW_WATER',
      severity: 'HIGH',
      value: decision.tank_level,
      message: decision.reason,
    });
    logSystem('WARN', 'automationEngine', `Irrigation blocked in ${area.id}: ${decision.reason}`);
    return decision;
  }

  const command = await commands.createCommand({
    actuatorId: decision.actuator_id,
    action: decision.action,
    durationMin: decision.duration_min ?? null,
    source: 'AUTOMATIC',
    reason: decision.reason,
    enforceManualMode: false,
  });

  logSystem('INFO', 'automationEngine',
    `Automatic irrigation ${decision.action} in ${area.id}: ${decision.reason}`,
    { command_id: command.id });

  return { ...decision, command };
}

/** GET /api/irrigation/daily-minutes */
async function dailyMinutes({ areaId = null, days = 30 } = {}) {
  return events.dailyIrrigationMinutes({ areaId, days });
}

module.exports = {
  getConfig,
  updateConfig,
  decide,
  apply,
  dailyMinutes,
  tankLevel,
  lastIrrigationAt,
  recentMoistureAverages,
  STALE_MINUTES,
};
