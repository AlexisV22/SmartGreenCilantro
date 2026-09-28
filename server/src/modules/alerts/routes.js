'use strict';

const express = require('express');
const { z } = require('zod');

const controller = require('./controller');
const { requireAuth } = require('../../middleware/auth');
const { requirePermission } = require('../../middleware/rbac');
const { validateParams, validateQuery } = require('../../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  sensor_id: z.string().min(1).optional(),
  area_id: z.string().min(1).optional(),
  type: z.enum(['LOW', 'HIGH', 'DEVICE_OFFLINE', 'LOW_WATER', 'ANOMALY']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get('/', requirePermission('alerts.read'), validateQuery(listQuery), controller.list);
router.get('/export.csv', requirePermission('alerts.read'), validateQuery(listQuery), controller.exportCsv);
router.patch('/:id/ack', requirePermission('alerts.ack'), validateParams(idParam), controller.acknowledge);

module.exports = router;
