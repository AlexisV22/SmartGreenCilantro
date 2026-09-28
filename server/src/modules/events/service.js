'use strict';

/**
 * Actuator event log (US-17, FR-19, FR-23).
 *
 * `recordEvent` is the single entry point used by manual control (US-15),
 * the automatic irrigation engine (US-16), the generic automation rules
 * (FR-18) and the AI decisions (US-26), so every state change is traceable to
 * its source.
 */

const db = require('../../db');

/**
 * Append one actuator event.
 *
 * @param {object}  event
 * @param {string}  event.actuatorId
 * @param {string}  event.action       ON | OFF | OFFLINE
 * @param {string}  event.source       MANUAL | AUTOMATIC | AI | SYSTEM
 * @param {string?} event.userId       who requested it, when applicable
 * @param {string?} event.reason       plain-language justification
 * @param {number?} event.durationMin
 * @param {string?} event.commandId
 * @param {object?} client             optional transaction client
 */
async function recordEvent(event, client = null) {
  const runner = client || db;
  const result = await runner.query(
    `INSERT INTO actuator_events (actuator_id, command_id, action, source, user_id, reason, duration_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [event.actuatorId, event.commandId || null, event.action, event.source,
      event.userId || null, event.reason || null,
      event.durationMin === undefined ? null : event.durationMin],
  );
  return result.rows[0];
}

/** GET /api/actuators/events — irrigation and actuation history (US17-T2). */
async function list({ actuatorId = null, areaId = null, source = null, from = null, to = null, limit = 200, offset = 0 }) {
  return db.rows(
    `SELECT e.*, a.name AS actuator_name, a.type AS actuator_type, a.area_id,
            u.email AS user_email
       FROM actuator_events e
       JOIN actuators a ON a.id = e.actuator_id
       LEFT JOIN users u ON u.id = e.user_id
      WHERE ($1::text IS NULL OR e.actuator_id = $1)
        AND ($2::text IS NULL OR a.area_id    = $2)
        AND ($3::text IS NULL OR e.source     = $3)
        AND ($4::timestamptz IS NULL OR e.created_at >= $4)
        AND ($5::timestamptz IS NULL OR e.created_at <= $5)
      ORDER BY e.created_at DESC
      LIMIT $6 OFFSET $7`,
    [actuatorId, areaId, source, from, to, limit, offset],
  );
}

/**
 * Irrigation minutes per day (US17-T2).
 *
 * An ON event opens an irrigation window that closes with the next OFF event
 * of the same pump; the window is attributed to the day it started.
 */
async function dailyIrrigationMinutes({ areaId = null, days = 30 }) {
  return db.rows(
    `WITH pump_events AS (
        SELECT e.actuator_id,
               a.area_id,
               e.action,
               e.created_at,
               e.duration_min,
               LEAD(e.created_at) OVER (PARTITION BY e.actuator_id ORDER BY e.created_at) AS next_at
          FROM actuator_events e
          JOIN actuators a ON a.id = e.actuator_id
         WHERE a.type = 'irrigation_pump'
           AND ($1::text IS NULL OR a.area_id = $1)
           AND e.created_at >= NOW() - ($2 || ' days')::interval
     )
     SELECT area_id,
            date_trunc('day', created_at) AS day,
            ROUND(SUM(
              LEAST(
                COALESCE(duration_min, 9999),
                COALESCE(EXTRACT(EPOCH FROM (next_at - created_at)) / 60.0, COALESCE(duration_min, 0))
              )
            )::numeric, 2) AS minutes
       FROM pump_events
      WHERE action = 'ON'
      GROUP BY area_id, date_trunc('day', created_at)
      ORDER BY day DESC`,
    [areaId, String(days)],
  );
}

module.exports = { recordEvent, list, dailyIrrigationMinutes };
