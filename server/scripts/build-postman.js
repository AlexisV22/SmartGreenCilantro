#!/usr/bin/env node
'use strict';

/**
 * Generates postman/SmartGreenAI.postman_collection.json and the environment
 * file. Every endpoint of the API has at least one success case and, where it
 * applies, the error cases of the standard contract (400/401/403/404/409).
 *
 *   node server/scripts/build-postman.js
 *   npm run postman            # runs the collection with newman
 *
 * Identifiers created by the collection use {{$timestamp}}, so it can run
 * repeatedly against the same database.
 */

const fs = require('fs');
const path = require('path');

const AUTH = {
  producer: '{{producerToken}}',
  admin: '{{adminToken}}',
  superadmin: '{{superToken}}',
};

/**
 * r(name, method, url, { as, body, expect, test })
 *   as: 'producer' | 'admin' | 'superadmin' | 'device' | 'none'
 *   expect: expected status (number or array)
 *   test: extra Postman test script lines
 */
function r(name, method, url, opts = {}) {
  const { as = 'admin', body, expect = 200, test = [] } = opts;
  const headers = [{ key: 'Content-Type', value: 'application/json' }];
  if (as === 'device') headers.push({ key: 'apikey', value: '{{deviceKey}}' });
  else if (AUTH[as]) headers.push({ key: 'Authorization', value: `Bearer ${AUTH[as]}` });

  const statuses = Array.isArray(expect) ? expect : [expect];
  const exec = [
    `pm.test('status ${statuses.join(' or ')}', () => pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(statuses)}));`,
  ];
  if (statuses.every((s) => s >= 400)) {
    exec.push("pm.test('standard error format', () => { const b = pm.response.json(); pm.expect(b).to.have.all.keys('status','code','message','details'); });");
  }
  exec.push(...test);

  const [pathPart, query = ''] = url.split('?');
  return {
    name,
    event: [{ listen: 'test', script: { type: 'text/javascript', exec } }],
    request: {
      method,
      header: headers,
      ...(body !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } } : {}),
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: pathPart.split('/').filter(Boolean),
        ...(query ? { query: query.split('&').map((kv) => { const [key, value = ''] = kv.split('='); return { key, value }; }) } : {}),
      },
    },
  };
}

const folder = (name, items) => ({ name, item: items });
const save = (variable, expr) => `if (pm.response.code < 300) pm.collectionVariables.set('${variable}', ${expr});`;
const now = '{{$isoTimestamp}}';

const collection = {
  info: {
    name: 'SmartGreenAI: Cilantro Crop API',
    description: 'Team 3 · UPAEP. Complete API with success and error cases. Run the folders in order (newman runs them in order).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'producerToken', value: '' }, { key: 'adminToken', value: '' }, { key: 'superToken', value: '' },
    { key: 'deviceId', value: '' }, { key: 'newDeviceKey', value: '' }, { key: 'alertId', value: '' },
    { key: 'recId', value: '' }, { key: 'userId', value: '' }, { key: 'roleId', value: '' }, { key: 'ruleId', value: '' },
    { key: 'integrationId', value: '' }, { key: 'orgId', value: '' },
  ],
  item: [
    folder('00 Health', [
      r('Health (public)', 'GET', '/health', { as: 'none', test: ["pm.test('db connected', () => pm.expect(pm.response.json().database.connected).to.be.true);"] }),
      r('Unknown route -> 404', 'GET', '/nope', { as: 'none', expect: 404 }),
    ]),
    folder('01 Auth (US-01-C)', [
      r('Login producer', 'POST', '/auth/login', { as: 'none', body: { email: 'producer@smartgreen.ai', password: 'Producer123!' }, test: [save('producerToken', 'pm.response.json().access_token')] }),
      r('Login administrator', 'POST', '/auth/login', { as: 'none', body: { email: 'admin@smartgreen.ai', password: 'Admin123!' }, test: [save('adminToken', 'pm.response.json().access_token')] }),
      r('Login super administrator', 'POST', '/auth/login', { as: 'none', body: { email: 'superadmin@smartgreen.ai', password: 'SuperAdmin123!' }, test: [save('superToken', 'pm.response.json().access_token')] }),
      r('Login wrong password -> 401 generic', 'POST', '/auth/login', { as: 'none', body: { email: 'producer@smartgreen.ai', password: 'bad' }, expect: 401 }),
      r('Login empty fields -> 400', 'POST', '/auth/login', { as: 'none', body: { email: '', password: '' }, expect: 400 }),
      r('Me', 'GET', '/auth/me', { as: 'producer', test: ["pm.test('role', () => pm.expect(pm.response.json().role).to.eql('Producer'));"] }),
      r('Me without token -> 401', 'GET', '/auth/me', { as: 'none', expect: 401 }),
    ]),
    folder('02 Users, administrators, roles (US-22/23/24)', [
      r('List users (admin)', 'GET', '/users'),
      r('List users as producer -> 403', 'GET', '/users', { as: 'producer', expect: 403 }),
      r('Create producer', 'POST', '/users', { body: { email: 'pm{{$timestamp}}@smartgreen.ai', username: 'pm{{$timestamp}}', full_name: 'Postman Producer', password: 'Cilantro#2026', role: 'Producer' }, expect: 201, test: [save('userId', 'pm.response.json().id')] }),
      r('Create producer weak password -> 400', 'POST', '/users', { body: { email: 'weak{{$timestamp}}@smartgreen.ai', username: 'weak{{$timestamp}}', password: '123', role: 'Producer' }, expect: 400 }),
      r('Create duplicate email -> 409', 'POST', '/users', { body: { email: 'producer@smartgreen.ai', username: 'dup{{$timestamp}}', password: 'Cilantro#2026', role: 'Producer' }, expect: 409 }),
      r('Get user', 'GET', '/users/{{userId}}'),
      r('Update user', 'PUT', '/users/{{userId}}', { body: { full_name: 'Postman Producer (edited)' } }),
      r('Deactivate user', 'PATCH', '/users/{{userId}}/status', { body: { is_active: false } }),
      r('Unknown user -> 404', 'GET', '/users/usr-nope', { expect: 404 }),
      r('List administrators (SA)', 'GET', '/admins', { as: 'superadmin' }),
      r('List administrators as admin -> 403', 'GET', '/admins', { expect: 403 }),
      r('Create administrator (SA)', 'POST', '/admins', { as: 'superadmin', body: { email: 'adm{{$timestamp}}@smartgreen.ai', username: 'adm{{$timestamp}}', password: 'Cilantro#2026', role: 'Administrator' }, expect: 201 }),
      r('List roles', 'GET', '/roles', { as: 'superadmin', test: [save('roleId', "pm.response.json().find(r => r.name === 'Producer').id")] }),
      r('List permissions', 'GET', '/roles/permissions', { as: 'superadmin' }),
      r('Get role', 'GET', '/roles/{{roleId}}', { as: 'superadmin' }),
      r('Create role', 'POST', '/roles', { as: 'superadmin', body: { name: 'Auditor{{$timestamp}}', description: 'Read-only', permissions: ['logs.read'] }, expect: 201 }),
      r('Set role permissions unknown code -> 400', 'PUT', '/roles/{{roleId}}/permissions', { as: 'superadmin', body: { permissions: ['do.anything'] }, expect: 400 }),
    ]),
    folder('03 Organizations, greenhouses, areas, crops', [
      r('List organizations (SA)', 'GET', '/organizations', { as: 'superadmin' }),
      r('Create organization (SA)', 'POST', '/organizations', { as: 'superadmin', body: { name: 'Tenant {{$timestamp}}', contact_email: 'tenant@example.org' }, expect: 201, test: [save('orgId', 'pm.response.json().id')] }),
      r('Create organization as admin -> 403', 'POST', '/organizations', { body: { name: 'x' }, expect: 403 }),
      r('Update organization', 'PUT', '/organizations/{{orgId}}', { as: 'superadmin', body: { is_active: false } }),
      r('List greenhouses', 'GET', '/greenhouses'),
      r('Get greenhouse', 'GET', '/greenhouses/GH-01'),
      r('Create greenhouse', 'POST', '/greenhouses', { body: { id: 'GH-{{$timestamp}}', name: 'Postman greenhouse' }, expect: 201 }),
      r('Create greenhouse duplicate -> 409', 'POST', '/greenhouses', { body: { id: 'GH-01', name: 'Duplicate' }, expect: 409 }),
      r('List areas', 'GET', '/areas'),
      r('Get area', 'GET', '/areas/AREA-1'),
      r('Create area', 'POST', '/areas', { body: { id: 'AREA-{{$timestamp}}', greenhouse_id: 'GH-01', name: 'Postman area', crop_type_id: 'crop-cilantro', mode: 'MANUAL' }, expect: 201 }),
      r('Set AREA-1 mode MANUAL', 'PATCH', '/areas/AREA-1/mode', { as: 'producer', body: { mode: 'MANUAL' } }),
      r('Set mode invalid -> 400', 'PATCH', '/areas/AREA-1/mode', { body: { mode: 'SOMETIMES' }, expect: 400 }),
      r('List crop types', 'GET', '/crops'),
      r('Get crop type', 'GET', '/crops/crop-cilantro'),
      r('Create crop type', 'POST', '/crops', { body: { name: 'Parsley {{$timestamp}}', soil_moisture_min: 55, soil_moisture_max: 75, temperature_min: 12, temperature_max: 24 }, expect: 201 }),
      r('Update crop type', 'PUT', '/crops/crop-cilantro', { body: { description: 'Coriandrum sativum — leafy crop grown in greenhouse beds.' } }),
      r('Apply crop to area (auto thresholds)', 'POST', '/crops/crop-cilantro/apply', { body: { area_id: 'AREA-1' } }),
    ]),
    folder('04 IoT registry (US-25)', [
      r('List devices', 'GET', '/devices'),
      r('Register device (key shown once)', 'POST', '/devices', { body: { id: 'dev-pm-{{$timestamp}}', name: 'Postman node', mac_address: '{{$randomMACAddress}}', greenhouse_id: 'GH-01', area_id: 'AREA-1' }, expect: 201, test: [save('deviceId', 'pm.response.json().id'), save('newDeviceKey', 'pm.response.json().api_key'), "pm.test('api key returned', () => pm.expect(pm.response.json().api_key).to.be.a('string'));"] }),
      r('Register device invalid MAC -> 400', 'POST', '/devices', { body: { name: 'Bad', mac_address: 'zz' }, expect: 400 }),
      r('Get device (no key in response)', 'GET', '/devices/{{deviceId}}', { test: ["pm.test('no key', () => pm.expect(pm.response.text()).to.not.include(pm.collectionVariables.get('newDeviceKey')));"] }),
      r('Update device', 'PUT', '/devices/{{deviceId}}', { body: { location: 'Bench 3' } }),
      r('Rotate device key', 'POST', '/devices/{{deviceId}}/rotate-key', { test: [save('newDeviceKey', 'pm.response.json().api_key')] }),
      r('Deactivate device', 'PUT', '/devices/{{deviceId}}', { body: { is_active: false } }),
      r('List sensors', 'GET', '/sensors'),
      r('Get sensor', 'GET', '/sensors/SM-01'),
      r('Register sensor', 'POST', '/sensors', { body: { id: 'SM-{{$timestamp}}', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Soil probe', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 }, expect: 201 }),
      r('Register sensor invalid range -> 400', 'POST', '/sensors', { body: { id: 'SM-BAD', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Bad', type: 'soil_moisture', unit: '%', physical_min: 100, physical_max: 0 }, expect: 400 }),
      r('Update sensor', 'PUT', '/sensors/SM-01', { body: { name: 'Soil moisture 1' } }),
      r('List actuators', 'GET', '/actuators'),
      r('Get actuator', 'GET', '/actuators/ACT-PUMP-01'),
      r('Register actuator', 'POST', '/actuators', { body: { id: 'ACT-{{$timestamp}}', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Extra fan', type: 'ventilation_fan' }, expect: 201 }),
      r('Update actuator', 'PUT', '/actuators/ACT-PUMP-01', { body: { name: 'Irrigation pump' } }),
    ]),
    folder('05 Measurements (US-06/07/08)', [
      r('Device heartbeat', 'POST', '/devices/heartbeat', { as: 'device', body: { firmware: 'postman', actuators: [{ id: 'ACT-PUMP-01', state: 'OFF' }] } }),
      r('Post one reading', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 66.2, unit: '%', recorded_at: now }, expect: 201 }),
      r('Post buffered batch', 'POST', '/measurements', { as: 'device', body: [
        { sensor_id: 'SM-02', value: 65.4, unit: '%', recorded_at: now },
        { sensor_id: 'TMP-01', value: 22.8, unit: 'C', recorded_at: now },
        { sensor_id: 'HUM-01', value: 61, unit: '%', recorded_at: now },
      ], expect: 201, test: ["pm.test('3 accepted', () => pm.expect(pm.response.json().accepted).to.eql(3));"] }),
      r('Unknown sensor -> 400', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-99', value: 50, unit: '%', recorded_at: now }, expect: 400 }),
      r('Non-numeric value -> 400', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 'wet', unit: '%', recorded_at: now }, expect: 400 }),
      r('Invalid timestamp -> 400', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 60, unit: '%', recorded_at: 'yesterday' }, expect: 400 }),
      r('Without API key -> 401', 'POST', '/measurements', { as: 'none', body: { sensor_id: 'SM-01', value: 60, unit: '%' }, expect: 401 }),
      r('Latest measurements', 'GET', '/measurements/latest', { as: 'producer' }),
      r('Sensor history', 'GET', '/sensors/SM-01/measurements?limit=50', { as: 'producer' }),
      r('Unknown sensor history -> 404', 'GET', '/sensors/NOPE/measurements', { as: 'producer', expect: 404 }),
    ]),
    folder('06 Thresholds (US-10)', [
      r('List thresholds', 'GET', '/thresholds?area_id=AREA-1', { as: 'producer' }),
      r('Get threshold', 'GET', '/thresholds/th-a1-soil-moisture', { as: 'producer' }),
      r('Update threshold', 'PUT', '/thresholds/th-a1-soil-moisture', { body: { min_value: 60, max_value: 80 } }),
      r('Update min > max -> 400', 'PUT', '/thresholds/th-a1-soil-moisture', { body: { min_value: 80, max_value: 60 }, expect: 400 }),
      r('Update as producer -> 403', 'PUT', '/thresholds/th-a1-soil-moisture', { as: 'producer', body: { min_value: 60, max_value: 80 }, expect: 403 }),
      r('Create duplicate threshold -> 409', 'POST', '/thresholds', { body: { area_id: 'AREA-1', sensor_type: 'soil_moisture', min_value: 60, max_value: 80, unit: '%', crop_stage: 'vegetative' }, expect: 409 }),
    ]),
    folder('07 Alerts & anomalies (US-11/12/13/19)', [
      r('Low soil moisture raises an alert', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 57.5, unit: '%', recorded_at: now }, expect: 201, test: [save('alertId', 'pm.response.json().alert && pm.response.json().alert.id')] }),
      r('List alerts', 'GET', '/alerts?status=OPEN&limit=20', { as: 'producer' }),
      r('Acknowledge alert', 'PATCH', '/alerts/{{alertId}}/ack', { as: 'producer' }),
      r('Acknowledge unknown -> 404', 'PATCH', '/alerts/alr-nope/ack', { as: 'producer', expect: 404 }),
      r('Invalid severity filter -> 400', 'GET', '/alerts?severity=CRITICAL', { as: 'producer', expect: 400 }),
      r('Export alerts CSV', 'GET', '/alerts/export.csv?sensor_id=SM-01', { as: 'producer', test: ["pm.test('csv', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('text/csv'));"] }),
      r('Back in range resolves it', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 66, unit: '%', recorded_at: now }, expect: 201 }),
      r('Out of physical range -> anomaly', 'POST', '/measurements', { as: 'device', body: { sensor_id: 'SM-02', value: 150, unit: '%', recorded_at: now }, expect: 201, test: ["pm.test('OUT_OF_RANGE', () => pm.expect(pm.response.json().anomalies.map(a => a.method)).to.include('OUT_OF_RANGE'));"] }),
      r('List anomalies', 'GET', '/anomalies?limit=20', { as: 'producer' }),
    ]),
    folder('08 Actuators & irrigation (US-14/15/16/17)', [
      r('Actuator status', 'GET', '/actuators/status', { as: 'producer' }),
      r('Device collects pending commands', 'GET', '/devices/me/commands', { as: 'device' }),
      r('Manual irrigation ON', 'POST', '/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'ON', duration_min: 2 }, expect: [201, 409] }),
      r('Second command in flight -> 409', 'POST', '/actuators/ACT-PUMP-01/command', { as: 'producer', body: { action: 'OFF' }, expect: 409 }),
      r('Duration above maximum -> 400', 'POST', '/actuators/ACT-FAN-01/command', { as: 'producer', body: { action: 'ON', duration_min: 99 }, expect: 400 }),
      r('Device polls the command', 'GET', '/devices/me/commands', { as: 'device' }),
      r('Device confirms pump ON', 'POST', '/actuators/ACT-PUMP-01/state', { as: 'device', body: { state: 'ON', duration_min: 2 } }),
      r('Device confirms pump OFF', 'POST', '/actuators/ACT-PUMP-01/state', { as: 'device', body: { state: 'OFF' } }),
      r('Actuator commands', 'GET', '/actuators/ACT-PUMP-01/commands', { as: 'producer' }),
      r('Actuator events', 'GET', '/actuators/events?actuator_id=ACT-PUMP-01&limit=10', { as: 'producer' }),
      r('Irrigation config', 'GET', '/irrigation/config/AREA-1', { as: 'producer' }),
      r('Update irrigation config', 'PUT', '/irrigation/config/AREA-1', { body: { target_moisture: 65, max_duration_min: 10, cooldown_min: 30, consecutive_readings: 2, min_tank_level: 20 } }),
      r('Irrigation config invalid -> 400', 'PUT', '/irrigation/config/AREA-1', { body: { target_moisture: 150 }, expect: 400 }),
      r('Irrigation engine status', 'GET', '/irrigation/status/AREA-1', { as: 'producer' }),
      r('Daily irrigation minutes', 'GET', '/irrigation/daily-minutes?area_id=AREA-1&days=30', { as: 'producer' }),
      r('Automation rules', 'GET', '/automation-rules', { test: [save('ruleId', 'pm.response.json()[0].id')] }),
      r('Create automation rule', 'POST', '/automation-rules', { body: { area_id: 'AREA-1', name: 'Shade on strong light', sensor_type: 'light', condition: 'ABOVE_MAX', actuator_type: 'shade', action: 'ON', hysteresis: 2000, enabled: false }, expect: [201, 409] }),
      r('Update automation rule', 'PUT', '/automation-rules/{{ruleId}}', { body: { enabled: true } }),
      r('Set AREA-1 mode AUTOMATIC', 'PATCH', '/areas/AREA-1/mode', { body: { mode: 'AUTOMATIC' } }),
    ]),
    folder('09 Analysis & AI (US-18/20/21/26)', [
      r('Analysis summary', 'GET', '/analysis/summary?area_id=AREA-1', { as: 'producer' }),
      r('Analysis summary without area -> 400', 'GET', '/analysis/summary', { as: 'producer', expect: 400 }),
      r('Trends 24h', 'GET', '/analysis/trends?area_id=AREA-1&window=24h', { as: 'producer' }),
      r('Trends 7d', 'GET', '/analysis/trends?area_id=AREA-1&window=7d', { as: 'producer' }),
      r('AI config', 'GET', '/ai/config'),
      r('Update AI config', 'PUT', '/ai/config', { body: { irrigate_score_threshold: 60 } }),
      r('Update AI config invalid -> 400', 'PUT', '/ai/config', { body: { weight_trend: 500 }, expect: 400 }),
      r('Generate recommendation (forced)', 'POST', '/recommendations/generate', { body: { area_id: 'AREA-1', force: true }, expect: 201, test: [save('recId', 'pm.response.json()[0].recommendation.id')] }),
      r('Generate as producer -> 403', 'POST', '/recommendations/generate', { as: 'producer', body: {}, expect: 403 }),
      r('List recommendations', 'GET', '/recommendations?status=PENDING', { as: 'producer' }),
      r('Get recommendation (5 elements)', 'GET', '/recommendations/{{recId}}', { as: 'producer', test: ["pm.test('5 elements', () => { const b = pm.response.json(); ['recommendation','reason','relevant_measurements','confidence_text','created_at'].forEach(k => pm.expect(b).to.have.property(k)); });"] }),
      r('Reject recommendation', 'POST', '/recommendations/{{recId}}/decision', { as: 'producer', body: { decision: 'REJECTED', comment: 'Postman test' } }),
      r('Second decision -> 409', 'POST', '/recommendations/{{recId}}/decision', { as: 'producer', body: { decision: 'ACCEPTED' }, expect: 409 }),
      r('Invalid decision -> 400', 'POST', '/recommendations/{{recId}}/decision', { as: 'producer', body: { decision: 'MAYBE' }, expect: 400 }),
    ]),
    folder('10 Observations, logs, stats, settings, integrations', [
      r('Create observation', 'POST', '/observations', { as: 'producer', body: { area_id: 'AREA-1', note: 'Healthy leaves, first harvest in 10 days.' }, expect: 201 }),
      r('Observation too short -> 400', 'POST', '/observations', { as: 'producer', body: { area_id: 'AREA-1', note: 'x' }, expect: 400 }),
      r('List observations', 'GET', '/observations?area_id=AREA-1', { as: 'producer' }),
      r('System log', 'GET', '/logs/system?limit=20'),
      r('Audit log', 'GET', '/logs/audit?limit=20', { as: 'superadmin' }),
      r('Logs as producer -> 403', 'GET', '/logs/audit', { as: 'producer', expect: 403 }),
      r('Statistics', 'GET', '/stats'),
      r('Global parameters', 'GET', '/settings/global', { as: 'superadmin' }),
      r('Update global parameter', 'PUT', '/settings/global', { as: 'superadmin', body: { parameters: { 'severity.low_max_pct': 10 } } }),
      r('Unknown global parameter -> 400', 'PUT', '/settings/global', { as: 'superadmin', body: { parameters: { 'no.such': 1 } }, expect: 400 }),
      r('Security settings', 'GET', '/settings/security', { as: 'superadmin' }),
      r('Update security settings', 'PUT', '/settings/security', { as: 'superadmin', body: { session_hours: 8 } }),
      r('Security settings invalid -> 400', 'PUT', '/settings/security', { as: 'superadmin', body: { session_hours: 500 }, expect: 400 }),
      r('Notification settings', 'GET', '/settings/notifications'),
      r('Update notification settings', 'PUT', '/settings/notifications', { body: { min_severity: 'MEDIUM' } }),
      r('List integrations (SA)', 'GET', '/integrations', { as: 'superadmin' }),
      r('Create integration (SA)', 'POST', '/integrations', { as: 'superadmin', body: { name: 'webhook-{{$timestamp}}', type: 'webhook', config: { url: 'https://example.org/hook' }, enabled: false }, expect: 201, test: [save('integrationId', 'pm.response.json().id')] }),
      r('Update integration (SA)', 'PUT', '/integrations/{{integrationId}}', { as: 'superadmin', body: { enabled: false } }),
      r('Integrations as admin -> 403', 'GET', '/integrations', { expect: 403 }),
      r('Logout', 'POST', '/auth/logout', { as: 'producer' }),
    ]),
  ],
};

const environment = {
  name: 'SmartGreenAI local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:3000/api', enabled: true },
    { key: 'deviceKey', value: 'sec_iot_dev_node_01_smartgreen_team3', enabled: true },
  ],
};

const out = path.resolve(__dirname, '../../postman');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'SmartGreenAI.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(out, 'SmartGreenAI.postman_environment.json'), JSON.stringify(environment, null, 2));
const count = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`OK  postman collection with ${count} requests in ${collection.item.length} folders`);
