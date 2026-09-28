'use strict';

/** Shared helpers for the integration tests. */

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../src/app');
const db = require('../src/db');
const settings = require('../src/utils/settings');

const DEVICE_KEY = 'sec_iot_dev_node_01_smartgreen_team3';
const USERS = {
  producer: ['producer@smartgreen.ai', 'Producer123!'],
  admin: ['admin@smartgreen.ai', 'Admin123!'],
  superadmin: ['superadmin@smartgreen.ai', 'SuperAdmin123!'],
};

const SEED = fs.readFileSync(path.resolve(__dirname, '../../database/seed.sql'), 'utf8');

/** Empty every table and load the seed again: each test file starts from the same state. */
async function reseed() {
  const tables = await db.rows(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  await db.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await db.query(SEED);
  settings.invalidate();
}

const tokenCache = {};
async function token(role) {
  if (tokenCache[role]) return tokenCache[role];
  const [email, password] = USERS[role];
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${role} failed: ${JSON.stringify(res.body)}`);
  tokenCache[role] = res.body.access_token;
  return tokenCache[role];
}

function api(role) {
  const wrap = (method) => async (url, body) => {
    let req = request(app)[method](`/api${url}`);
    if (role) req = req.set('Authorization', `Bearer ${await token(role)}`);
    return body === undefined ? req : req.send(body);
  };
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

function device(key = DEVICE_KEY) {
  return {
    post: (url, body) => request(app).post(`/api${url}`).set('apikey', key).send(body),
    get: (url) => request(app).get(`/api${url}`).set('apikey', key),
  };
}

/** Readings `minutesAgo` minutes in the past (default: now). */
function reading(sensorId, value, minutesAgo = 0, unit) {
  const units = { SM: '%', TMP: 'C', HUM: '%', LUX: 'lux', CO2: 'ppm', WL: '%', PH: 'pH' };
  return {
    sensor_id: sensorId,
    value,
    unit: unit || units[sensorId.split('-')[0]],
    recorded_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  };
}

/** Insert measurements directly (fast history for engine tests). */
async function insertHistory(sensorId, values, { stepMinutes = 5, endMinutesAgo = 0 } = {}) {
  const unit = (await db.one('SELECT unit FROM sensors WHERE id = $1', [sensorId])).unit;
  for (let i = 0; i < values.length; i += 1) {
    const at = new Date(Date.now() - (endMinutesAgo + (values.length - 1 - i) * stepMinutes) * 60000);
    await db.query(
      'INSERT INTO measurements (sensor_id, value, unit, recorded_at) VALUES ($1, $2, $3, $4)',
      [sensorId, values[i], unit, at],
    );
  }
}

module.exports = { app, db, request, api, device, token, reading, insertHistory, reseed, DEVICE_KEY, USERS };
