'use strict';

/**
 * User activity trail (FR-21).
 *
 * Every write performed by a logged-in user is recorded with a before/after
 * snapshot, so the Administrator and Super Administrator log screens can show
 * who changed what and when. Audit writes never block the response.
 */

const db = require('../db');

/** Client IP, honouring the proxy header set by Render/Railway/Nginx. */
function clientIp(req) {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

/**
 * Record one audited action.
 *
 * @param {object}  req         the Express request (for user and IP)
 * @param {string}  action      CREATE | UPDATE | DELETE | LOGIN | DECISION ...
 * @param {string}  entity      table or domain object name
 * @param {string?} entityId    affected row id
 * @param {object?} beforeData  snapshot before the change
 * @param {object?} afterData   snapshot after the change
 */
function record(req, action, entity, entityId = null, beforeData = null, afterData = null) {
  const user = req.user || null;

  db.query(
    `INSERT INTO audit_logs (user_id, organization_id, action, entity, entity_id, before_data, after_data, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      user ? user.id : null,
      user ? user.organization_id : null,
      action,
      entity,
      entityId,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
      clientIp(req),
    ],
  ).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[audit] could not persist audit entry:', err.message);
  });
}

/** Remove sensitive fields before they reach the audit trail (NFR-03). */
function scrub(row) {
  if (!row || typeof row !== 'object') return row;
  const clone = { ...row };
  delete clone.password_hash;
  delete clone.api_key_hash;
  return clone;
}

module.exports = { record, scrub, clientIp };
