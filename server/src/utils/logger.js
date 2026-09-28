'use strict';

/**
 * Technical logging into `system_logs`, consulted from the Administrator and
 * Super Administrator log screens (FR-21 companion).
 *
 * Writes are fire-and-forget on purpose: a logging failure must never break
 * a request or stop a background engine.
 */

const db = require('../db');

function logSystem(level, source, message, context = null) {
  db.query(
    `INSERT INTO system_logs (level, source, message, context)
     VALUES ($1, $2, $3, $4)`,
    [level, String(source).slice(0, 200), String(message).slice(0, 2000), context ? JSON.stringify(context) : null],
  ).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[logger] could not persist system log:', err.message);
  });
}

const debug = (source, message, context) => logSystem('DEBUG', source, message, context);
const info = (source, message, context) => logSystem('INFO', source, message, context);
const warn = (source, message, context) => logSystem('WARN', source, message, context);
const error = (source, message, context) => logSystem('ERROR', source, message, context);

module.exports = { logSystem, debug, info, warn, error };
