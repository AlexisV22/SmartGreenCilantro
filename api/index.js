'use strict';

/**
 * Vercel entry point: exposes the Express app as a serverless function.
 * Static files are served by Vercel from /public (see vercel.json).
 * The cron engines (server/src/jobs) do not run here.
 */

module.exports = require('../server/src/app');
