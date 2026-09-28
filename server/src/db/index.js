'use strict';

/**
 * PostgreSQL access layer.
 *
 * Everything goes through parameterised queries, so user input can never be
 * concatenated into SQL. `withTransaction` is used wherever a write must be
 * atomic (command creation, recommendation decisions, threshold updates).
 */

const { Pool, types } = require('pg');
const config = require('../config');

// NUMERIC columns arrive as strings by default because they can exceed the
// precision of a JS number. Every numeric column in this schema fits
// comfortably in a double, and the API must return real JSON numbers.
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number.parseFloat(value)));
types.setTypeParser(types.builtins.INT8, (value) => (value === null ? null : Number.parseInt(value, 10)));

const pool = new Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl,
  max: config.db.maxClients,
  // Timestamps are handled in UTC everywhere (NFR-05).
  options: '-c timezone=UTC',
});

pool.on('error', (err) => {
  // A broken idle client must not take the process down.
  // eslint-disable-next-line no-console
  console.error('[db] idle client error:', err.message);
});

/** Run a parameterised query and return the full pg result. */
async function query(text, params) {
  return pool.query(text, params);
}

/** Run a query and return only its rows. */
async function rows(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

/** Run a query and return its first row, or null. */
async function one(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

/**
 * Execute `fn` inside a transaction, committing on success and rolling back
 * on any thrown error. `fn` receives a dedicated client.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** True when the database answers, used by GET /api/health. */
async function isHealthy() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, rows, one, withTransaction, isHealthy, close };
