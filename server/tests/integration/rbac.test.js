'use strict';

// FR-02, FR-03, NFR-04 — role-based access: every role x every endpoint group.
// 'ok' means the role is allowed (any 2xx/4xx other than 401/403 proves the
// guard let it through); 403 means the permission guard blocked it.

const { db, api, reseed } = require('../helpers');

beforeAll(reseed);
afterAll(() => db.close());

const ALLOW = 'ok';
const DENY = 403;

// [method, url, body, Producer, Administrator, SuperAdministrator]
const MATRIX = [
  ['get', '/measurements/latest', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/sensors', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/actuators/status', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/alerts', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/anomalies', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/analysis/trends?area_id=AREA-1', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/recommendations', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/observations', undefined, ALLOW, ALLOW, ALLOW],
  ['get', '/thresholds', undefined, ALLOW, ALLOW, ALLOW],
  ['put', '/thresholds/th-a1-soil-moisture', { min_value: 60, max_value: 80 }, DENY, ALLOW, ALLOW],
  ['get', '/users', undefined, DENY, ALLOW, ALLOW],
  ['get', '/admins', undefined, DENY, DENY, ALLOW],
  ['get', '/roles', undefined, DENY, ALLOW, ALLOW],
  ['put', '/roles/role-producer/permissions', { permissions: ['measurements.read'] }, DENY, DENY, 'skip'],
  ['get', '/organizations', undefined, DENY, ALLOW, ALLOW],
  ['post', '/organizations', { name: 'Tenant X' }, DENY, DENY, ALLOW],
  ['post', '/greenhouses', { id: 'GH-RBAC', name: 'RBAC greenhouse' }, DENY, ALLOW, 'skip'],
  ['post', '/devices', { name: 'RBAC node' }, DENY, ALLOW, ALLOW],
  ['get', '/irrigation/config/AREA-1', undefined, ALLOW, ALLOW, ALLOW],
  ['put', '/irrigation/config/AREA-1', { target_moisture: 65 }, DENY, ALLOW, ALLOW],
  ['get', '/automation-rules', undefined, DENY, ALLOW, ALLOW],
  ['get', '/ai/config', undefined, DENY, ALLOW, ALLOW],
  ['put', '/ai/config', { irrigate_score_threshold: 60 }, DENY, ALLOW, ALLOW],
  ['post', '/recommendations/generate', { area_id: 'AREA-1' }, DENY, ALLOW, ALLOW],
  ['get', '/logs/system', undefined, DENY, ALLOW, ALLOW],
  ['get', '/logs/audit', undefined, DENY, ALLOW, ALLOW],
  ['get', '/stats', undefined, DENY, ALLOW, ALLOW],
  ['get', '/settings/global', undefined, DENY, ALLOW, ALLOW],
  ['get', '/integrations', undefined, DENY, DENY, ALLOW],
  ['post', '/integrations', { name: 'hook', type: 'webhook' }, DENY, DENY, ALLOW],
];

const ROLES = ['producer', 'admin', 'superadmin'];

describe.each(MATRIX)('%s %s', (method, url, body, ...expected) => {
  test.each(ROLES.map((r, i) => [r, expected[i]]))('%s -> %p', async (role, exp) => {
    if (exp === 'skip') return;
    const res = await api(role)[method](url, body);
    if (exp === DENY) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_INSUFFICIENT_PERMISSIONS');
    } else {
      expect([401, 403]).not.toContain(res.status);
    }
  });
});

describe('organization scope', () => {
  test('an administrator only sees its own organization data', async () => {
    await db.query("INSERT INTO organizations (id, name) VALUES ('org-other', 'Other tenant') ON CONFLICT DO NOTHING");
    await db.query("INSERT INTO greenhouses (id, organization_id, name) VALUES ('GH-OTHER', 'org-other', 'Foreign greenhouse') ON CONFLICT DO NOTHING");
    const admin = await api('admin').get('/greenhouses');
    const sa = await api('superadmin').get('/greenhouses');
    expect(admin.body.map((g) => g.id)).not.toContain('GH-OTHER');
    expect(sa.body.map((g) => g.id)).toContain('GH-OTHER');
  });

  test('an administrator cannot create another administrator', async () => {
    const res = await api('admin').post('/users', {
      email: 'x@smartgreen.ai', username: 'xadmin', password: 'Cilantro#2026', role: 'Administrator',
    });
    expect([400, 403]).toContain(res.status);
  });
});
