'use strict';

const service = require('./service');
const audit = require('../../middleware/audit');
const { asyncHandler, p, q, toCsv } = require('../../utils/http');

function filtersFrom(req) {
  const query = q(req);
  return {
    status: query.status || null,
    severity: query.severity || null,
    sensorId: query.sensor_id || null,
    areaId: query.area_id || null,
    type: query.type || null,
    from: query.from || null,
    to: query.to || null,
  };
}

/** GET /api/alerts — filtered history, newest first (US13-T1). */
const list = asyncHandler(async (req, res) => {
  const query = q(req);
  const filters = filtersFrom(req);
  const limit = query.limit || 100;
  const offset = query.offset || 0;

  const [data, total] = await Promise.all([
    service.list({ ...filters, limit, offset }),
    service.count(filters),
  ]);

  res.json({ total, limit, offset, count: data.length, data });
});

/** GET /api/alerts/export.csv — the export button of US13-T2. */
const exportCsv = asyncHandler(async (req, res) => {
  const rows = await service.list({ ...filtersFrom(req), limit: 10000, offset: 0 });

  const csv = toCsv(rows, [
    { key: 'created_at', label: 'Date' },
    { key: 'sensor_id', label: 'Sensor' },
    { key: 'sensor_type', label: 'Variable' },
    { key: 'value', label: 'Value' },
    { key: 'sensor_unit', label: 'Unit' },
    { key: 'min_value', label: 'Threshold min' },
    { key: 'max_value', label: 'Threshold max' },
    { key: 'type', label: 'Type' },
    { key: 'severity', label: 'Severity' },
    { key: 'status', label: 'Status' },
    { key: 'message', label: 'Message' },
    { key: 'acknowledged_by_email', label: 'Acknowledged by' },
    { key: 'acknowledged_at', label: 'Acknowledged at' },
    { key: 'resolved_at', label: 'Resolved at' },
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="smartgreenai-alerts.csv"');
  res.send(csv);
});

/** PATCH /api/alerts/:id/ack */
const acknowledge = asyncHandler(async (req, res) => {
  const alert = await service.acknowledge(p(req).id, req.user);
  audit.record(req, 'ACKNOWLEDGE', 'alerts', alert.id, null, { status: alert.status });
  res.json(alert);
});

module.exports = { list, exportCsv, acknowledge };
