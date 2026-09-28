'use strict';

/**
 * Request validation with zod, funnelled into the standard error format
 * (US08-T5): a failed schema always produces 400 ERR_VALIDATION_FAILED with
 * one `details` entry per offending field.
 */

const { badRequest } = require('./errors');

/** Turn a ZodError into the `details` array of the error contract. */
function zodDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '(body)',
    issue: issue.message,
  }));
}

/** Validate and replace `req.body`. */
function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(badRequest('The submitted data does not match the required schema.', zodDetails(result.error)));
    }
    req.body = result.data;
    return next();
  };
}

/** Validate and replace `req.query` (coercions are applied by the schema). */
function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(badRequest('The query parameters are invalid.', zodDetails(result.error)));
    }
    // Express 4 allows req.query to be reassigned; keep the parsed values.
    req.validatedQuery = result.data;
    return next();
  };
}

/** Validate route parameters. */
function validateParams(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(badRequest('The route parameters are invalid.', zodDetails(result.error)));
    }
    req.validatedParams = result.data;
    return next();
  };
}

module.exports = { validateBody, validateQuery, validateParams, zodDetails };
