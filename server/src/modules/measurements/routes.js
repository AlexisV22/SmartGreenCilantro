'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requireDeviceKey } = require('../../middleware/apiKey');
const { requirePermission } = require('../../middleware/rbac');
const { validateQuery } = require('../../middleware/validate');
const { unauthorized } = require('../../middleware/errors');

const router = express.Router();

/**
 * Ingestion accepts either credential (API specification 2.1 / 2.2):
 * a device API key, or a Bearer token of a user allowed to write readings.
 * The device path is tried first because that is the hot path.
 */
function deviceOrUser(req, res, next) {
  if (req.get('apikey')) return requireDeviceKey(req, res, next);
  if (req.get('authorization')) {
    return requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (!req.user.permissions.has('measurements.read')) {
        return next(unauthorized('This account cannot submit measurements.'));
      }
      return next();
    });
  }
  return next(unauthorized('Provide either an "apikey" header (device) or a Bearer token (user).'));
}

const latestQuery = z.object({ area_id: z.string().min(1).optional() });

// The body is validated inside the service so a batch can report per-row
// errors instead of rejecting the whole buffer.
router.post('/', deviceOrUser, controller.ingest);
router.get('/latest', requireAuth, requirePermission('measurements.read'), validateQuery(latestQuery), controller.latest);

module.exports = router;
