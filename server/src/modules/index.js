'use strict';

/**
 * API router. Every path below is mounted under /api, so the endpoints match
 * the API specification exactly (POST /api/measurements, GET /api/thresholds,
 * GET /api/actuators/status, ...).
 */

const express = require('express');

const { usersRouter, adminsRouter } = require('./users/routes');

const router = express.Router();

// --- Public ---------------------------------------------------------------
router.use('/health', require('./health/routes'));
router.use('/auth', require('./auth/routes'));

// --- Access and governance ------------------------------------------------
router.use('/users', usersRouter);
router.use('/admins', adminsRouter);
router.use('/roles', require('./roles/routes'));
router.use('/organizations', require('./organizations/routes'));

// --- Physical structure ---------------------------------------------------
router.use('/greenhouses', require('./greenhouses/routes'));
router.use('/areas', require('./areas/routes'));
router.use('/crops', require('./crops/routes'));

// --- IoT registry ---------------------------------------------------------
router.use('/devices', require('./devices/routes'));
router.use('/sensors', require('./sensors/routes'));
router.use('/actuators', require('./actuators/routes'));

// --- Monitoring -----------------------------------------------------------
router.use('/measurements', require('./measurements/routes'));
router.use('/thresholds', require('./thresholds/routes'));
router.use('/alerts', require('./alerts/routes'));
router.use('/anomalies', require('./anomalies/routes'));

// --- Irrigation and automation --------------------------------------------
router.use('/irrigation', require('./irrigation/routes'));
router.use('/automation-rules', require('./automation/routes'));

// --- Analysis and AI ------------------------------------------------------
router.use('/analysis', require('./analysis/routes'));
router.use('/recommendations', require('./recommendations/routes'));
router.use('/ai', require('./ai/routes'));

// --- Crop notes and platform ----------------------------------------------
router.use('/observations', require('./observations/routes'));
router.use('/logs', require('./logs/routes'));
router.use('/stats', require('./stats/routes'));
router.use('/settings', require('./settings/routes'));
router.use('/integrations', require('./integrations/routes'));

module.exports = router;
