'use strict';

const service = require('./service');
const { asyncHandler, q, p } = require('../../utils/http');
const { notFound } = require('../../middleware/errors');

/**
 * POST /api/measurements
 *
 * Accepts either a single reading (the shape documented in the API
 * specification) or an array, which is how the firmware flushes its offline
 * buffer after a reconnection (US06-T4).
 */
const ingest = asyncHandler(async (req, res) => {
  const device = req.device || null;

  if (Array.isArray(req.body)) {
    const result = await service.storeBatch(req.body, device);
    return res.status(201).json({
      status: 'processed',
      received: req.body.length,
      accepted: result.accepted.length,
      rejected: result.rejected.length,
      results: result.accepted,
      errors: result.rejected,
    });
  }

  const { measurement, alert, anomalies } = await service.store(req.body, device);

  return res.status(201).json({
    id: measurement.id,
    sensor_id: measurement.sensor_id,
    status: 'processed',
    inserted_at: measurement.received_at,
    // Echoed so the device (and the acceptance script) can see the effect of
    // the reading without a second round-trip.
    alert: alert.alert ? { id: alert.alert.id, type: alert.alert.type, severity: alert.alert.severity, created: alert.created } : null,
    anomalies: anomalies.map((a) => ({ id: a.id, method: a.method })),
  });
});

/** GET /api/sensors/:id/measurements?from&to&limit */
const historyBySensor = asyncHandler(async (req, res) => {
  const { from, to, limit, include_anomalies: includeAnomalies } = q(req);
  const result = await service.history(p(req).id, {
    from: from || null,
    to: to || null,
    limit: limit || 100,
    includeAnomalies: includeAnomalies === undefined ? true : includeAnomalies,
  });

  if (!result) throw notFound(`No sensor with id "${p(req).id}".`);
  res.json(result);
});

/** GET /api/measurements/latest?area_id */
const latest = asyncHandler(async (req, res) => {
  res.json(await service.latest({ areaId: q(req).area_id || null }));
});

module.exports = { ingest, historyBySensor, latest };
