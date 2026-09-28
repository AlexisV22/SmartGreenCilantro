'use strict';

/**
 * Small HTTP helpers shared by every controller.
 */

/**
 * Express 4 does not forward rejections from async handlers, so every route
 * handler is wrapped: a thrown ApiError reaches the standard error handler
 * instead of hanging the request.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parsed query produced by validateQuery, or the raw query when unvalidated. */
const q = (req) => req.validatedQuery || req.query;

/** Parsed route params produced by validateParams, or the raw ones. */
const p = (req) => req.validatedParams || req.params;

/** Render an array of plain objects as a CSV document. */
function toCsv(rows, columns) {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = columns.map((c) => escape(c.label || c.key)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

module.exports = { asyncHandler, q, p, toCsv };
