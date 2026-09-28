'use strict';

/**
 * Cached access to the tunable platform parameters.
 *
 * The alert severity boundaries (US12-T1), the offline windows (FR-11), the
 * command expiry and every anomaly parameter (US19-T1) live in
 * `system_parameters` so an administrator can change them without a deploy.
 * Values are cached for a few seconds because the ingestion path reads them
 * on every measurement.
 */

const db = require('../db');

const CACHE_TTL_MS = 5000;

let paramsCache = null;
let paramsCachedAt = 0;
let securityCache = null;
let securityCachedAt = 0;

/** All rows of system_parameters as a plain { key: value } object. */
async function getParameters() {
  const now = Date.now();
  if (paramsCache && now - paramsCachedAt < CACHE_TTL_MS) return paramsCache;

  const rows = await db.rows('SELECT key, value FROM system_parameters');
  paramsCache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  paramsCachedAt = now;
  return paramsCache;
}

/** Numeric parameter with a fallback used when the row is missing. */
async function getNumber(key, fallback) {
  const params = await getParameters();
  const value = Number.parseFloat(params[key]);
  return Number.isFinite(value) ? value : fallback;
}

async function getString(key, fallback) {
  const params = await getParameters();
  return params[key] === undefined ? fallback : params[key];
}

/** The single security_settings row (session length, password policy). */
async function getSecuritySettings() {
  const now = Date.now();
  if (securityCache && now - securityCachedAt < CACHE_TTL_MS) return securityCache;

  const row = await db.one('SELECT * FROM security_settings WHERE id = $1', ['security-default']);
  securityCache = row || {
    id: 'security-default',
    session_hours: 8,
    password_min_length: 8,
    password_require_upper: true,
    password_require_digit: true,
    password_require_symbol: true,
    max_login_attempts: 5,
    login_window_minutes: 15,
  };
  securityCachedAt = now;
  return securityCache;
}

/** Called by the settings module after a write so the change is immediate. */
function invalidate() {
  paramsCache = null;
  securityCache = null;
}

/**
 * Validate a password against the configured policy. Returns an array of
 * `details` entries; empty means the password is acceptable.
 */
async function validatePassword(password) {
  const policy = await getSecuritySettings();
  const details = [];

  if (typeof password !== 'string' || password.length < policy.password_min_length) {
    details.push({ field: 'password', issue: `Must be at least ${policy.password_min_length} characters long.` });
    return details;
  }
  if (policy.password_require_upper && !/[A-Z]/.test(password)) {
    details.push({ field: 'password', issue: 'Must contain at least one uppercase letter.' });
  }
  if (policy.password_require_digit && !/[0-9]/.test(password)) {
    details.push({ field: 'password', issue: 'Must contain at least one digit.' });
  }
  if (policy.password_require_symbol && !/[^A-Za-z0-9]/.test(password)) {
    details.push({ field: 'password', issue: 'Must contain at least one symbol.' });
  }
  return details;
}

module.exports = {
  getParameters,
  getNumber,
  getString,
  getSecuritySettings,
  validatePassword,
  invalidate,
};
