'use strict';

/**
 * Standard error contract of the platform (US08-T5).
 *
 * Every failure — validation, authentication, authorization, missing
 * resource, conflict or unexpected crash — leaves the API with the same JSON
 * body, exactly as documented in US08-T1_API_Specification_SmartGreenAI:
 *
 *   { "status": 400,
 *     "code": "ERR_VALIDATION_FAILED",
 *     "message": "...",
 *     "details": [ { "field": "value", "issue": "..." } ] }
 */

/** Internal error codes mapped to their HTTP status. */
const ERROR_CODES = {
  ERR_VALIDATION_FAILED: 400,
  ERR_AUTH_REQUIRED: 401,
  ERR_INSUFFICIENT_PERMISSIONS: 403,
  ERR_RESOURCE_NOT_FOUND: 404,
  ERR_CONFLICT: 409,
  ERR_RATE_LIMITED: 429,
  ERR_INTERNAL_DATABASE: 500,
};

class ApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_CODES[code] || 500;
    this.details = details;
  }

  toJSON() {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      details: this.details === null ? [] : this.details,
    };
  }
}

/** Shorthand constructors used across the modules. */
const badRequest = (message, details) => new ApiError('ERR_VALIDATION_FAILED', message, details);
const unauthorized = (message = 'Authentication is required to access this resource.', details) =>
  new ApiError('ERR_AUTH_REQUIRED', message, details);
const forbidden = (message = 'Your role does not allow this operation.', details) =>
  new ApiError('ERR_INSUFFICIENT_PERMISSIONS', message, details);
const notFound = (message = 'The requested resource does not exist.', details) =>
  new ApiError('ERR_RESOURCE_NOT_FOUND', message, details);
const conflict = (message, details) => new ApiError('ERR_CONFLICT', message, details);
const internal = (message = 'Unexpected internal error.', details) =>
  new ApiError('ERR_INTERNAL_DATABASE', message, details);

/** 404 handler for unmatched /api routes. */
function notFoundHandler(req, _res, next) {
  next(notFound(`No API route matches ${req.method} ${req.originalUrl}.`));
}

/**
 * Terminal error handler. Known ApiErrors are returned as-is; anything else
 * is logged and reported as ERR_INTERNAL_DATABASE without leaking internals.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let apiError = err;

  if (!(err instanceof ApiError)) {
    // PostgreSQL violations carry useful, safe-to-map information.
    if (err && err.code === '23505') {
      apiError = conflict('The resource already exists or violates a uniqueness rule.', [
        { field: err.constraint || 'unknown', issue: 'duplicate value' },
      ]);
    } else if (err && err.code === '23503') {
      apiError = badRequest('A referenced resource does not exist.', [
        { field: err.constraint || 'unknown', issue: 'foreign key violation' },
      ]);
    } else if (err && err.code === '23514') {
      apiError = badRequest('A value is outside the range allowed by the database.', [
        { field: err.constraint || 'unknown', issue: 'check constraint violation' },
      ]);
    } else if (err && err.type === 'entity.parse.failed') {
      apiError = badRequest('The request body is not valid JSON.');
    } else {
      apiError = internal();
    }
  }

  if (apiError.status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[api] unhandled error:', err && err.stack ? err.stack : err);
    // Persist it so the Administrator log screen shows real incidents.
    const logSystem = require('../utils/logger').logSystem;
    logSystem('ERROR', `${req.method} ${req.originalUrl}`, err && err.message ? err.message : String(err));
  }

  res.status(apiError.status).json(apiError.toJSON());
}

module.exports = {
  ApiError,
  ERROR_CODES,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internal,
  notFoundHandler,
  errorHandler,
};
