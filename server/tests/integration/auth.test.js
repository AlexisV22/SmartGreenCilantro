'use strict';

// US-01-C / FR-01 — secure login, JWT sessions, generic errors, direct URL access.

const jwt = require('jsonwebtoken');
const { app, db, request, api, reseed } = require('../helpers');
const config = require('../../src/config');

beforeAll(reseed);
afterAll(() => db.close());

describe('POST /api/auth/login', () => {
  test.each([
    ['producer@smartgreen.ai', 'Producer123!', 'Producer'],
    ['admin@smartgreen.ai', 'Admin123!', 'Administrator'],
    ['superadmin@smartgreen.ai', 'SuperAdmin123!', 'SuperAdministrator'],
  ])('%s signs in with role %s', async (email, password, role) => {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(8 * 3600);
    expect(res.body.user.role).toBe(role);
    expect(res.body.user.password_hash).toBeUndefined();
    const payload = jwt.decode(res.body.access_token, { complete: true });
    expect(payload.header.alg).toBe('HS256');
  });

  test('the username also works', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'producer', password: 'Producer123!' });
    expect(res.status).toBe(200);
  });

  test('wrong password and unknown user get the same generic 401 (no account enumeration)', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'producer@smartgreen.ai', password: 'nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@smartgreen.ai', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('ERR_AUTH_REQUIRED');
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(Object.keys(wrong.body).sort()).toEqual(['code', 'details', 'message', 'status']);
  });

  test('empty fields -> 400 ERR_VALIDATION_FAILED with field details', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_VALIDATION_FAILED');
    expect(res.body.details.map((d) => d.field)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  test('passwords are stored only as bcrypt hashes (NFR-03)', async () => {
    const rows = await db.rows('SELECT password_hash FROM users');
    for (const r of rows) expect(r.password_hash).toMatch(/^\$2[aby]\$/);
  });

  test('a successful login is audited and updates last_login', async () => {
    await request(app).post('/api/auth/login').send({ email: 'admin@smartgreen.ai', password: 'Admin123!' });
    await new Promise((r) => setTimeout(r, 300));
    const audit = await db.one("SELECT * FROM audit_logs WHERE action = 'LOGIN' ORDER BY created_at DESC LIMIT 1");
    expect(audit.entity).toBe('users');
    const user = await db.one("SELECT last_login FROM users WHERE email = 'admin@smartgreen.ai'");
    expect(user.last_login).not.toBeNull();
  });
});

describe('protected routes', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ERR_AUTH_REQUIRED');
  });

  test('expired token -> 401 with a session-expired message', async () => {
    const token = jwt.sign({ sub: 'usr-producer', role: 'Producer' }, config.auth.jwtSecret, { expiresIn: -10 });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  test('token signed with another secret -> 401', async () => {
    const token = jwt.sign({ sub: 'usr-admin', role: 'Administrator' }, 'forged-secret', { expiresIn: 600 });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('GET /auth/me returns the user with its permissions', async () => {
    const res = await api('producer').get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('Producer');
    expect(res.body.permissions).toEqual(expect.arrayContaining(['measurements.read', 'actuators.command']));
    expect(res.body.permissions).not.toContain('users.write');
  });

  test('direct URL access: pages are static but every API call behind them requires a token', async () => {
    const page = await request(app).get('/admin/users.html');
    expect(page.status).toBe(200);
    const data = await request(app).get('/api/users');
    expect(data.status).toBe(401);
  });

  test('a deactivated account is blocked immediately, even with a valid token', async () => {
    const token = (await request(app).post('/api/auth/login').send({ email: 'producer@smartgreen.ai', password: 'Producer123!' })).body.access_token;
    await db.query("UPDATE users SET is_active = FALSE WHERE email = 'producer@smartgreen.ai'");
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    const login = await request(app).post('/api/auth/login').send({ email: 'producer@smartgreen.ai', password: 'Producer123!' });
    expect(login.status).toBe(401);
    await db.query("UPDATE users SET is_active = TRUE WHERE email = 'producer@smartgreen.ai'");
  });

  test('logout answers 200 and is audited', async () => {
    const res = await api('producer').post('/auth/logout');
    expect(res.status).toBe(200);
    // Audit writes never block the response; give the insert a moment.
    await new Promise((r) => setTimeout(r, 300));
    const row = await db.one("SELECT 1 FROM audit_logs WHERE action = 'LOGOUT'");
    expect(row).not.toBeNull();
  });
});

describe('health (public)', () => {
  test('GET /api/health reports status, DB connection, uptime and version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(res.body.version).toBeDefined();
  });

  test('unknown API route -> 404 ERR_RESOURCE_NOT_FOUND', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ERR_RESOURCE_NOT_FOUND');
  });
});
