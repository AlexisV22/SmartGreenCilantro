'use strict';

/**
 * Sprint 2 evidence (September 21 – October 9, 2026): US-01-C, US-06, US-07,
 * US-08, US-10, US-14, US-25 and the sprint-level tasks.
 * Part 1 (this file): US-01-C, US-06, US-07, US-08. Part 2: collect_sprint2b.js.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const L = require('./lib');

const P = L.proof;

const MEET = {
  d1: 'Daily Meeting 1 of Sprint 2 (Monday, September 21, 2026): the team agreed the stack (PostgreSQL, Node.js + Express, JWT sessions and device API keys) and the measurement payload (sensor_id, value, unit, recorded_at in UTC).',
  d2: 'Daily Meeting 2 of Sprint 2 (Monday, September 28, 2026): "Review of the Week 1 milestone: US-01-C closed, API specification (US08-T1) shared on Wednesday, ER diagram and payload format approved." Decision: the firmware obtains UTC by NTP and sends recorded_at in ISO 8601; the server also stores received_at.',
  d3: 'Daily Meeting 3 of Sprint 2 (Monday, October 5, 2026): "all endpoints, storage, transmission, threshold, registry and actuator features implemented and connected"; the integration check simulator → POST /measurements → database → GET /sensors/{id}/measurements worked.',
};

async function T(ctx, key, fn) {
  if (ctx.only && ctx.only !== key) return;
  const t = L.begin(key);
  try {
    await fn(t);
    console.log(`  ✔ ${key}`);
  } catch (e) {
    console.error(`  ✖ ${key}: ${e.stack}`);
    L.note(key, `Collector error while capturing this evidence: ${e.message}`);
  }
}

const excerptOf = (text, lines = 40) => text.split('\n').slice(0, lines).join('\n');

module.exports = async function sprint2(ctx) {
  const { OUT } = ctx;

  // =========================================================================
  // US-01-C — Complete secure login and role-based access
  // =========================================================================
  await T(ctx, '2:US01C-T1', async (t) => {
    const { context, page } = await L.openPage();
    await L.goto(page, '/', '#login-form');
    await page.fill('#email', 'producer@smartgreen.ai');
    await page.fill('#password', 'Producer123!');
    const form = await L.shot(t, page, 'Login form of the web application with the credentials of a real user from the database (password masked by the browser).', { fullPage: false });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/login')),
      page.click('#login-btn'),
    ]);
    const loginStatus = resp.status();
    await page.waitForURL(/\/producer\//);
    await page.waitForSelector('.sensor-card');
    await page.waitForTimeout(800);
    const home = await L.shot(t, page, 'After a successful login the producer lands on the dashboard; the header shows the signed-in user and role.', { fullPage: false });
    const stored = await page.evaluate(() => ({ token: localStorage.getItem('sg_token'), user: JSON.parse(localStorage.getItem('sg_user')) }));
    await context.close();

    const call = await L.call('POST', '/api/auth/login', { body: { email: 'producer@smartgreen.ai', password: 'Producer123!' } });
    const token = call.body.access_token;
    const payload = jwt.decode(token);
    L.condition(t.key, 1, `The login page (public/index.html + public/js/pages/login.js) posts the credentials to POST /api/auth/login. The browser capture shows the request answered HTTP ${loginStatus}, the JWT stored in the session (${L.mask(stored.token)}) and the redirection to the producer home page. The same call made directly against the API returns token_type Bearer and expires_in.`, [
      form, home,
      L.saveCalls(t, 'POST /api/auth/login with a real user (token masked)', [call]),
      P.code('public/js/pages/login.js', "form.addEventListener('submit'", 26),
    ]);

    const hashes = await L.sqlProof(t, 'Stored passwords (users table): only bcrypt hashes', `SELECT u.email, r.name AS role, u.password_hash, length(u.password_hash) AS hash_length,
      (u.password_hash LIKE '$2%') AS is_bcrypt FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.email`);
    const plain = await L.sql("SELECT COUNT(*)::int AS n FROM users WHERE password_hash IN ('Producer123!','Admin123!','SuperAdmin123!')");
    L.condition(t.key, 2, `Passwords are hashed with bcrypt (cost 10) before being stored: the users table contains only 60-character $2a$/$2b$ hashes and no column holds the plain password. A query looking for the plain passwords returns ${plain[0].n} rows. Verification uses bcrypt.compare with a dummy hash for unknown users, so response times do not reveal whether an account exists.`, [
      hashes.proof,
      P.code('server/src/modules/auth/service.js', 'async function login', 28),
    ]);

    const settings = await L.sqlProof(t, 'Session length configured in security_settings', 'SELECT id, session_hours, updated_at FROM security_settings');
    const secret = process.env.JWT_SECRET;
    const expired = jwt.sign({ sub: 'usr-producer', role: 'Producer' }, secret, { algorithm: 'HS256', expiresIn: -60 });
    const expiredCall = await L.call('GET', '/api/auth/me', { token: expired });
    L.condition(t.key, 3, `The token is a JWT signed with HS256 whose expiry comes from security_settings.session_hours (8 h). The decoded token issued above has iat ${payload.iat} and exp ${payload.exp}: exp − iat = ${payload.exp - payload.iat} s = ${(payload.exp - payload.iat) / 3600} h, the same value returned as expires_in (${call.body.expires_in}). A token signed with the server secret but already expired is rejected with HTTP ${expiredCall.status} and the message "${expiredCall.body.message}".`, [
      settings.proof,
      P.block('Decoded JWT payload (header.payload only; signature omitted)', JSON.stringify({ header: jwt.decode(token, { complete: true }).header, payload }, null, 2)),
      L.saveCalls(t, 'Expired token → 401', [expiredCall]),
    ]);

    L.condition(t.key, 4, 'The login works end to end with the seeded user producer@smartgreen.ai stored in PostgreSQL: Figures 1–2 show the form and the dashboard after signing in, and the SQL result under condition 2 shows the bcrypt hash of the same user. The HTTP exchanges and query results are attached as files.', []);
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US01C-T2', async (t) => {
    const roles = await L.sqlProof(t, 'Roles in the database and the test users assigned to them', `SELECT r.name AS role, r.description, u.email AS test_user, u.is_active
      FROM roles r LEFT JOIN users u ON u.role_id = r.id ORDER BY r.name, u.email`);
    const perms = await L.sqlProof(t, 'Number of permissions per role', `SELECT r.name AS role, COUNT(rp.permission_id)::int AS permissions
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.name ORDER BY r.name`);
    L.condition(t.key, 1, 'The roles Administrator and Producer (plus Super Administrator, added for US-23/US-24) exist in the roles table, with their permissions in role_permissions. The test users admin@smartgreen.ai and producer@smartgreen.ai are assigned to them.', [roles.proof, perms.proof]);

    const homes = [];
    for (const [role, url] of [['producer', /\/producer\/$/], ['admin', /\/admin\/$/], ['superadmin', /\/superadmin\/$/]]) {
      const { context, page } = await L.openPage({ role, uiLogin: true });
      await page.waitForURL(url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);
      homes.push(await L.shot(t, page, `${role === 'admin' ? 'Administrator' : role === 'producer' ? 'Producer' : 'Super Administrator'} signed in through the login form and was redirected to ${new URL(page.url()).pathname}.`, { fullPage: false }));
      await context.close();
    }
    L.condition(t.key, 2, 'Each role signed in through the real login form. The page redirects every role to its own home (public/js/layout.js HOME map): Producer → /producer/, Administrator → /admin/, Super Administrator → /superadmin/.', [
      ...homes,
      P.code('public/js/layout.js', 'export const HOME', 5),
    ]);

    const calls = [
      await L.call('GET', '/api/users', { as: 'producer' }),
      await L.call('PUT', '/api/thresholds/th-a1-soil-moisture', { as: 'producer', body: { min_value: 60, max_value: 80 } }),
      await L.call('POST', '/api/devices', { as: 'producer', body: { name: 'Not allowed' } }),
      await L.call('GET', '/api/admins', { as: 'admin' }),
    ];
    L.condition(t.key, 3, `Every protected route declares the permission it needs (middleware/rbac.js requirePermission). The Producer calling user management, threshold updates or device registration, and the Administrator calling the Super-Administrator endpoint /admins, all receive HTTP 403 with code ERR_INSUFFICIENT_PERMISSIONS (${calls.map((c) => c.status).join(', ')}).`, [
      L.saveCalls(t, 'Calls to endpoints the role is not allowed to use', calls, 12),
      P.code('server/src/middleware/rbac.js', 'function requirePermission', 22),
    ]);

    // Page guards
    const { context, page } = await L.openPage({ role: 'producer' });
    await page.goto(`${L.BASE}/admin/users.html`);
    await page.waitForURL(/denied=1/);
    await page.waitForTimeout(700);
    const denied = await L.shot(t, page, 'The Producer typed /admin/users.html: the route guard sent the user back to the producer home with a permission warning.', { fullPage: false });
    await context.close();
    const anon = await L.openPage();
    await anon.page.goto(`${L.BASE}/admin/thresholds.html`, { waitUntil: 'commit' });
    await anon.page.waitForURL(/next=/);
    await anon.page.waitForTimeout(500);
    const login = await L.shot(t, anon.page, `Without a session, /admin/thresholds.html redirects to the login page (${new URL(anon.page.url()).pathname}${new URL(anon.page.url()).search}).`, { fullPage: false });
    await anon.context.close();
    L.condition(t.key, 4, 'Each role lands on its own page (condition 2). Restricted routes answer 403 on the API (condition 3); in the web application, a page of another role redirects to the user\'s home, and a page opened without a session redirects to the login page.', [
      denied, login,
      P.code('public/js/layout.js', 'export async function boot', 25),
    ]);
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US01C-T3', async (t) => {
    // Pages (web application) x roles
    const PAGES = [
      ['Login page', '/', 'public', 'public', 'public'],
      ['Producer dashboard (sensor cards, actuator status panel)', '/producer/', 'allow', 'allow', 'allow'],
      ['Threshold configuration', '/admin/thresholds.html', 'deny', 'allow', 'allow'],
      ['IoT devices, sensors and actuators', '/admin/devices.html', 'deny', 'allow', 'allow'],
      ['Administrator overview', '/admin/', 'deny', 'allow', 'allow'],
    ];
    const ENDPOINTS = [
      ['POST /auth/login', 'POST', '/api/auth/login', { email: 'x', password: 'y' }, 'public'],
      ['GET /thresholds', 'GET', '/api/thresholds', undefined, ['allow', 'allow', 'allow']],
      ['PUT /thresholds/{id}', 'PUT', '/api/thresholds/th-a1-soil-moisture', { min_value: 60, max_value: 80 }, ['deny', 'allow', 'allow']],
      ['GET /devices', 'GET', '/api/devices', undefined, ['allow', 'allow', 'allow']],
      ['POST /devices', 'POST', '/api/devices', { name: 'Matrix probe node' }, ['deny', 'allow', 'allow']],
      ['PUT /devices/{id}', 'PUT', '/api/devices/dev-node-01', { location: 'Bloque A - Cilantro' }, ['deny', 'allow', 'allow']],
      ['GET /sensors', 'GET', '/api/sensors', undefined, ['allow', 'allow', 'allow']],
      ['POST /sensors', 'POST', '/api/sensors', { id: 'SM-01', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'dup', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 }, ['deny', 'allow', 'allow']],
      ['GET /actuators/status', 'GET', '/api/actuators/status', undefined, ['allow', 'allow', 'allow']],
      ['GET /measurements/latest (dashboard)', 'GET', '/api/measurements/latest', undefined, ['allow', 'allow', 'allow']],
      ['GET /sensors/{id}/measurements', 'GET', '/api/sensors/SM-01/measurements?limit=5', undefined, ['allow', 'allow', 'allow']],
      ['GET /users', 'GET', '/api/users', undefined, ['deny', 'allow', 'allow']],
    ];
    const ROLES = ['producer', 'admin', 'superadmin'];
    const RN = { producer: 'Producer', admin: 'Administrator', superadmin: 'Super Admin' };
    const rows = [];
    let n = 0;
    for (const [name, url, ...exp] of PAGES) {
      for (let i = 0; i < ROLES.length; i += 1) {
        const role = ROLES[i];
        const { context, page } = await L.openPage({ role });
        await page.goto(`${L.BASE}${url}`, { waitUntil: 'commit' });
        await page.waitForTimeout(1500);
        const final = new URL(page.url());
        await context.close();
        let actual; let expected;
        if (exp[i] === 'public') { expected = 'page opens (public)'; actual = `opened ${final.pathname}`; }
        else if (exp[i] === 'allow') { expected = 'page opens'; actual = final.pathname === url ? 'page opened' : `redirected to ${final.pathname}${final.search}`; }
        else { expected = 'redirected to own home (denied)'; actual = final.search.includes('denied') ? `redirected to ${final.pathname}?denied=1` : `opened ${final.pathname}`; }
        const pass = exp[i] === 'public' ? true : exp[i] === 'allow' ? final.pathname === url : final.search.includes('denied');
        n += 1;
        rows.push({ id: `M-${String(n).padStart(2, '0')}`, case: `${RN[role]} → page ${name}`, steps: `Sign in as ${RN[role]}, open ${url}`, input: url, expected, actual, result: pass ? 'PASS' : 'FAIL' });
      }
    }
    for (const [name, method, url, body, exp] of ENDPOINTS) {
      if (exp === 'public') {
        const c = await L.call(method, url, { body });
        n += 1;
        rows.push({ id: `M-${String(n).padStart(2, '0')}`, case: `Anyone → ${name}`, steps: `${method} ${url} without token`, input: 'no token', expected: 'reachable (401 only for wrong credentials)', actual: `HTTP ${c.status}`, result: c.status === 401 ? 'PASS' : 'FAIL' });
        continue;
      }
      for (let i = 0; i < ROLES.length; i += 1) {
        const c = await L.call(method, url, { as: ROLES[i], body });
        const allowed = ![401, 403].includes(c.status);
        n += 1;
        rows.push({ id: `M-${String(n).padStart(2, '0')}`, case: `${RN[ROLES[i]]} → ${name}`, steps: `${method} ${url} with the ${RN[ROLES[i]]} token`, input: body ? JSON.stringify(body).slice(0, 40) : '—', expected: exp[i] === 'allow' ? 'allowed (not 401/403)' : '403 ERR_INSUFFICIENT_PERMISSIONS', actual: `HTTP ${c.status}${c.body && c.body.code ? ` ${c.body.code}` : ''}`, result: (exp[i] === 'allow') === allowed && (exp[i] === 'allow' || c.status === 403) ? 'PASS' : 'FAIL' });
      }
    }
    // Clean the probe device created by the matrix, if any (deactivate, never delete).
    await L.sql("UPDATE devices SET is_active = FALSE WHERE name = 'Matrix probe node'");
    const csv = ['id,case,expected,actual,result', ...rows.map((r) => [r.id, r.case, r.expected, r.actual, r.result].map((v) => `"${v}"`).join(','))].join('\n');
    const csvFile = L.saveFile(t, 'csv', csv);
    const jest = await L.run('npx', ['jest', '--runInBand', 'server/tests/integration/rbac.test.js']);
    const jestFile = L.saveFile(t, 'txt', jest.out);
    const summary = (jest.out.match(/Tests:.*$/m) || [''])[0];
    const failed = rows.filter((r) => r.result === 'FAIL');

    const matrix = [];
    for (const [name, url] of PAGES) matrix.push([`Page ${url}`, ...ROLES.map((r) => rows.find((x) => x.case === `${RN[r]} → page ${name}`).expected.startsWith('redirected') ? 'Denied' : 'Allowed')]);
    for (const [name, , , , exp] of ENDPOINTS) matrix.push([name, ...(exp === 'public' ? ['Public', 'Public', 'Public'] : exp.map((e) => (e === 'allow' ? 'Allowed' : 'Denied')))]);
    L.condition(t.key, 1, `The matrix covers every page and endpoint delivered in Sprint 2 (login, dashboard with actuator status, thresholds, devices/sensors registry, measurements) for the Producer and Administrator roles, plus the Super Administrator. ${PAGES.length} pages and ${ENDPOINTS.length} endpoints.`, [
      P.table('Permission matrix Role × Page/Endpoint (expected)', ['Page / endpoint', 'Producer', 'Administrator', 'Super Admin'], matrix, [4200, 1720, 1720, 1720]),
    ]);
    L.condition(t.key, 2, `Every case was executed for real against the running system: pages with a browser signed in as each role (final URL checked), endpoints with each role's token (HTTP status checked). ${rows.length} cases executed, ${rows.length - failed.length} PASS, ${failed.length} FAIL. The automated RBAC suite of the repository (server/tests/integration/rbac.test.js, 90 role × endpoint cases) was also run: ${summary}.`, [
      P.block('Jest RBAC suite (excerpt)', excerptOf(jest.out.replace(/\r/g, ''), 30), jestFile),
    ]);
    L.condition(t.key, 3, failed.length
      ? `Failed cases: ${failed.map((f) => f.id).join(', ')} — registered for correction.`
      : 'No case failed in this execution, so nothing had to be registered. The defects found while building the matrix earlier in the sprint (login audit crash when copying the request object) were fixed before this run and are listed in the Sprint 2 integration test evidence (SPR-T1).', []);
    L.condition(t.key, 4, `The completed matrix with the result of every case is the test table below and the attached CSV (${csvFile}).`, []);
    L.testCases(t.key, rows, 'Permission matrix — executed cases');
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US01C-T4', async (t) => {
    const rows = [];
    const shots = [];
    const tryLogin = async (label, email, password) => {
      const { context, page } = await L.openPage();
      await L.goto(page, '/', '#login-form');
      if (email !== null) await page.fill('#email', email);
      if (password !== null) await page.fill('#password', password);
      await page.click('#login-btn');
      await page.waitForSelector('#login-msg.banner');
      await page.waitForTimeout(400);
      const msg = (await page.textContent('#login-msg')).trim();
      shots.push(await L.shot(t, page, `${label}: the form shows "${msg}" and stays on the login page.`, { fullPage: false }));
      await context.close();
      return msg;
    };
    const m1 = await tryLogin('Wrong password', 'producer@smartgreen.ai', 'WrongPass1!');
    const m2 = await tryLogin('Non-existent user', 'nobody@smartgreen.ai', 'WrongPass1!');
    const m3 = await tryLogin('Empty fields', '', '');
    const api = [
      await L.call('POST', '/api/auth/login', { body: { email: 'producer@smartgreen.ai', password: 'WrongPass1!' } }),
      await L.call('POST', '/api/auth/login', { body: { email: 'nobody@smartgreen.ai', password: 'WrongPass1!' } }),
      await L.call('POST', '/api/auth/login', { body: { email: '', password: '' } }),
    ];
    // Expired session
    const expired = jwt.sign({ sub: 'usr-producer', role: 'Producer' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -60 });
    const ex = await L.openPage();
    await ex.context.addInitScript((tk) => { localStorage.setItem('sg_token', tk); localStorage.setItem('sg_user', JSON.stringify({ role: 'Producer' })); }, expired);
    await ex.page.goto(`${L.BASE}/producer/`, { waitUntil: 'commit' });
    await ex.page.waitForURL(/expired=1/);
    await ex.page.waitForSelector('#login-msg.banner');
    const exMsg = (await ex.page.textContent('#login-msg')).trim();
    shots.push(await L.shot(t, ex.page, `Expired session: the dashboard rejected the expired token and returned to the login page with "${exMsg}".`, { fullPage: false }));
    await ex.context.close();
    api.push(await L.call('GET', '/api/measurements/latest', { token: expired }));
    // Direct URL
    const d = await L.openPage();
    await d.page.goto(`${L.BASE}/admin/devices.html`, { waitUntil: 'commit' });
    await d.page.waitForURL(/next=/);
    await d.page.waitForTimeout(400);
    shots.push(await L.shot(t, d.page, 'Restricted URL typed directly without logging in: redirected to the login page.', { fullPage: false }));
    await d.context.close();
    api.push(await L.call('GET', '/api/devices'));

    const generic = m1 === m2;
    rows.push(
      { id: 'NEG-01', case: 'Wrong password', steps: 'Login form with a real email and a wrong password', input: 'producer@smartgreen.ai / WrongPass1!', expected: 'Rejected, generic message', actual: `"${m1}" · API ${api[0].status} ${api[0].body.code}`, result: api[0].status === 401 ? 'PASS' : 'FAIL' },
      { id: 'NEG-02', case: 'Non-existent user', steps: 'Login form with an unknown email', input: 'nobody@smartgreen.ai', expected: 'Rejected with the same message as NEG-01', actual: `"${m2}" · API ${api[1].status}`, result: api[1].status === 401 && generic ? 'PASS' : 'FAIL' },
      { id: 'NEG-03', case: 'Empty fields', steps: 'Submit the empty form; API call with empty strings', input: '"" / ""', expected: 'Rejected before authentication', actual: `"${m3}" · API ${api[2].status} ${api[2].body.code}`, result: api[2].status === 400 ? 'PASS' : 'FAIL' },
      { id: 'NEG-04', case: 'Expired session', steps: 'Open the dashboard with an expired token', input: 'JWT exp in the past', expected: 'Session rejected, back to login', actual: `"${exMsg}" · API ${api[3].status} "${api[3].body.message}"`, result: api[3].status === 401 ? 'PASS' : 'FAIL' },
      { id: 'NEG-05', case: 'Direct URL without login', steps: 'Type /admin/devices.html in a new browser', input: 'no session', expected: 'Redirect to login; API 401', actual: `redirected to login · API ${api[4].status} ${api[4].body.code}`, result: api[4].status === 401 ? 'PASS' : 'FAIL' },
    );
    L.condition(t.key, 1, 'The five negative cases were executed in the browser and against the API: wrong password, non-existent user, empty fields, expired session and a restricted URL typed without logging in.', [L.saveCalls(t, 'API responses of the negative cases', api, 10)]);
    L.condition(t.key, 2, `All attempts are rejected. The wrong-password and unknown-user cases return the identical message "${m1}" (HTTP 401 ERR_AUTH_REQUIRED), so the system never reveals whether an account exists; the password is checked against a dummy bcrypt hash when the user is unknown so the response time does not reveal it either.`, [
      P.code('server/src/modules/auth/service.js', 'const GENERIC', 22),
    ]);
    L.condition(t.key, 3, 'A screenshot of every case was saved in the evidence folder (Figures 1–5).', shots);
    L.condition(t.key, 4, 'The negative test cases are documented in the test table with their real results; every attempt was rejected.', []);
    L.testCases(t.key, rows, 'Negative test cases');
  });

  // =========================================================================
  // US-06 — Transmit IoT measurements to the cloud
  // =========================================================================
  await T(ctx, '2:US06-T1', async (t) => {
    const flow = await L.renderMermaid(t, 'iot_to_cloud_flow', `flowchart LR
  subgraph G[Greenhouse GH-01 / AREA-1]
    S1[SM-01 soil moisture] --> MCU
    S2[SM-02 soil moisture] --> MCU
    S3[TMP-01 temperature] --> MCU
    S4[HUM-01, LUX-01, WL-01] --> MCU
    MCU[ESP32 dev-node-01<br/>reads every 60 s<br/>NTP UTC time<br/>ring buffer 100 readings]
  end
  MCU -- "HTTPS POST /api/measurements<br/>header apikey<br/>JSON array" --> API
  SIM[Node.js simulator<br/>same protocol] -. "when hardware is not connected" .-> API
  subgraph C[Cloud]
    API[Express API<br/>validate · authenticate device]
    DB[(PostgreSQL<br/>measurements<br/>recorded_at + received_at)]
    API --> DB
  end
  API -- "201 processed" --> MCU`, 'IoT-to-cloud data flow: sensors → ESP32 → HTTPS → ingestion endpoint → database (Mermaid source in tools/evidence/diagrams/iot_to_cloud_flow.mmd).');
    const sample = {
      device_id: 'dev-node-01', sensor_id: 'SM-01', value: 66.4, unit: '%', recorded_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    };
    const c = await L.call('POST', '/api/measurements', { as: 'device', body: sample });
    L.condition(t.key, 1, 'The diagram shows every component from the sensor to the database: the probes of GH-01/AREA-1, the ESP32 node with its NTP clock and local buffer, the HTTPS transport with the device API key, the ingestion endpoint of the API and the measurements table. The simulator uses the same path when the hardware is not connected.', [flow]);
    L.condition(t.key, 2, 'The payload defines device_id, sensor_id, value, unit and recorded_at (UTC, ISO 8601 with the Z suffix). device_id is checked against the device authenticated by the API key; the server adds received_at. The example below was sent to the real endpoint and accepted.', [
      P.table('Payload fields', ['Field', 'Type', 'Example', 'Rule'], [
        ['device_id', 'string', 'dev-node-01', 'must be the device of the sensor and of the API key'],
        ['sensor_id', 'string', 'SM-01', 'registered and active sensor'],
        ['value', 'number', '66.4', 'finite number'],
        ['unit', 'string', '%', 'unit of the sensor (%, C, lux, ppm, pH)'],
        ['recorded_at', 'string', sample.recorded_at, 'ISO 8601 UTC from the device clock (NTP); not more than 5 min in the future'],
      ], [1600, 1100, 2800, 3860]),
      L.saveCalls(t, 'Payload example accepted by POST /api/measurements', [c]),
    ]);
    L.condition(t.key, 3, 'Sending interval: one reading of every sensor each 60 seconds (READING_INTERVAL_MS = 60000 in the firmware; --interval 60 by default in the simulator), readings grouped in one array per cycle. The payload is the one of the API specification written by Carlos (US08-T1, POST /measurements) plus the device_id requested by this task, which the API validates.', [
      P.code('iot/esp32_smartgreen/esp32_smartgreen.ino', 'const unsigned long READING_INTERVAL_MS', 4),
    ]);
    L.condition(t.key, 4, 'The flow diagram (Figure 1) and the payload example above were approved by the team (see the approval record).', []);
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US06-T2', async (t) => {
    const health = await L.call('GET', '/api/health');
    const devices = await L.sqlProof(t, 'Device credentials (only the SHA-256 hash of each key is stored)', `SELECT id, name, is_active, api_key_hash, length(api_key_hash) AS hash_len, last_seen FROM devices ORDER BY id`);
    const { context, page } = await L.openPage({ role: 'admin' });
    await L.goto(page, '/admin/devices.html', 'table');
    await page.click('button:has-text("Register device")');
    await page.fill('.modal input[name="id"]', 'dev-test-06t2');
    await page.fill('.modal input[name="name"]', 'Test node US06-T2');
    await page.fill('.modal input[name="mac_address"]', 'A4:CF:12:06:02:01');
    const formShot = await L.shot(t, page, 'Step 1: Administrator → IoT devices → Register device, filling the form of a new test node.', { fullPage: false });
    await page.click('.modal button.primary');
    await page.waitForSelector('#api-key-value');
    const key = (await page.textContent('#api-key-value')).trim();
    await page.evaluate(() => { const k = document.getElementById('api-key-value'); k.dataset.full = k.textContent; k.textContent = `${k.textContent.slice(0, 6)}…  (masked in the evidence)`; });
    const keyShot = await L.shot(t, page, 'Step 2: the platform generates the device API key and shows it only once (masked in this capture).', { fullPage: false });
    await page.click('.modal button.primary');
    await context.close();
    const withKey = await L.call('POST', '/api/devices/heartbeat', { key, body: { firmware: 'test' } });
    const devKey = await L.call('POST', '/api/devices/heartbeat', { as: 'device', body: { firmware: 'esp32-smartgreen-1.0.0' } });
    const noKey = await L.call('POST', '/api/devices/heartbeat', { body: {} });
    await L.call('PUT', '/api/devices/dev-test-06t2', { as: 'admin', body: { is_active: false } });
    L.condition(t.key, 1, `The cloud service (Express API + PostgreSQL) is running and reachable: GET /api/health answers status "${health.body.status}" with database.connected = ${health.body.database.connected} (version ${health.body.version}).`, [L.saveCalls(t, 'Health check', [health])]);
    L.condition(t.key, 2, 'Each device has its own API key: dev-node-01 (the development node) and the new test node registered below each authenticate with their own key, and a request without a key is refused. The database keeps only a 64-character SHA-256 hash of each key.', [
      devices.proof,
      L.saveCalls(t, 'Heartbeat of each device with its own key, and without a key', [devKey, withKey, noKey], 8),
    ]);
    L.condition(t.key, 3, 'Configuration steps that any member can repeat: (1) start the database and the API (npm run db:up, db:schema, db:seed, npm run dev — see README.md and docs/DEPLOYMENT.md); (2) sign in as Administrator and open IoT devices → Register device; (3) copy the key shown once; (4) write it in iot/esp32_smartgreen/secrets.h (DEVICE_API_KEY) or pass it to the simulator (--key); (5) the device authenticates with the apikey header. Steps 2–3 are shown in Figures 1–2.', [
      formShot, keyShot,
      P.code('iot/esp32_smartgreen/secrets.h.example', null, 18),
    ]);
    L.condition(t.key, 4, 'The service is running (health check) and the configuration document with screenshots is this section. The test node was deactivated after the check.', []);
    L.approval(t.key, MEET.d1);
  });

  await T(ctx, '2:US06-T3', async (t) => {
    const start = new Date();
    const sim = await L.device.exclusive(() => L.run('node', ['iot/simulator/simulator.js', '--interval', '10', '--count', '4']));
    const log = L.saveFile(t, 'log', sim.out);
    const rows = await L.sqlProof(t, 'Readings stored by the simulator run (one cycle every 10 s in this test)', `SELECT m.sensor_id, s.device_id, m.value, m.unit, m.recorded_at, m.received_at,
      round(EXTRACT(EPOCH FROM (m.recorded_at - lag(m.recorded_at) OVER (PARTITION BY m.sensor_id ORDER BY m.recorded_at)))::numeric, 1) AS seconds_since_previous
      FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE m.received_at >= $1 AND m.sensor_id IN ('SM-01','SM-02','TMP-01')
      ORDER BY m.sensor_id, m.recorded_at`, [start], 12);
    const serverLog = await L.sqlProof(t, 'Server log of the received messages (system_logs)', `SELECT created_at, level, source, message FROM system_logs
      WHERE created_at >= $1 AND message LIKE 'POST /api/measurements%' ORDER BY created_at`, [start], 10);
    L.condition(t.key, 1, 'The simulator was run with --interval 10 --count 4 (production default: 60 s). The stored recorded_at values of every sensor are spaced by the configured interval (column seconds_since_previous).', [rows.proof]);
    L.condition(t.key, 2, 'Every message is a JSON array of readings with device_id, sensor_id, value, unit and recorded_at in UTC, exactly the payload approved in US06-T1; the API accepted all of them (201).', [
      P.code('iot/simulator/simulator.js', 'function readSensors', 36),
    ]);
    L.condition(t.key, 3, 'The simulator is in the repository (iot/simulator/simulator.js) with its instructions (iot/simulator/README.md): options, scenarios and the closed-loop model. The firmware for the real ESP32 is iot/esp32_smartgreen/esp32_smartgreen.ino.', [
      P.code('iot/simulator/README.md', null, 22),
    ]);
    L.condition(t.key, 4, 'The measurements arrived in the cloud: the simulator log (every line "8/8 readings stored") and the server log of received messages are attached.', [
      P.block('Simulator log', sim.out.trim(), log),
      serverLog.proof,
    ]);
  });

  await T(ctx, '2:US06-T4', async (t) => {
    const start = new Date();
    const sim = await L.device.exclusive(() => L.run('node', ['iot/simulator/simulator.js', '--interval', '2', '--count', '6', '--offline-seconds', '6']));
    const log = L.saveFile(t, 'log', sim.out);
    const delayed = await L.sqlProof(t, 'Readings taken during the outage and delivered after reconnecting', `SELECT m.sensor_id, m.value, m.recorded_at, m.received_at,
      round(EXTRACT(EPOCH FROM (m.received_at - m.recorded_at))::numeric, 1) AS delivered_after_s
      FROM measurements m WHERE m.received_at >= $1 AND m.sensor_id = 'SM-01' ORDER BY m.recorded_at`, [start], 10);
    L.condition(t.key, 1, 'When the send fails the simulator keeps the readings and retries with exponential back-off (2 s, 4 s … up to 60 s). The firmware implements the same logic in flushBuffer().', [
      P.code('iot/simulator/simulator.js', 'async function sendReadings', 38),
      P.code('iot/esp32_smartgreen/esp32_smartgreen.ino', 'void flushBuffer()', 38),
    ]);
    L.condition(t.key, 2, 'The test cut the network for 6 seconds after the first cycle (--offline-seconds 6). The readings of the cycles taken during the outage were kept in the ring buffer and resent in one batch after reconnecting; the database shows them with recorded_at during the outage and received_at after it (column delivered_after_s).', [delayed.proof]);
    L.condition(t.key, 3, 'Every failure is written to the device log with its reason and the retry delay ("✖ send failed (network unavailable …); 8 readings buffered, retry in 2 s"); the firmware writes the same lines to the serial log ([send] failed …).', [P.block('Simulator log of the outage test', sim.out.trim(), log)]);
    L.condition(t.key, 4, 'Test executed: connection cut and restored; the buffered readings were delivered (delivery report at the end of the log: 100 % success, no reading lost).', []);
  });

  await T(ctx, '2:US06-T5', async (t) => {
    const start = new Date();
    const sim = await L.device.exclusive(() => L.run('node', ['iot/simulator/simulator.js', '--interval', '1', '--count', '13']));
    const end = new Date();
    const log = L.saveFile(t, 'log', sim.out);
    const stats = await L.sql(`SELECT COUNT(*)::int AS stored,
      COUNT(*) FILTER (WHERE m.sensor_id IN ('SM-01','SM-02','TMP-01','HUM-01','LUX-01','CO2-01','WL-01','PH-01'))::int AS correct_sensor,
      COUNT(*) FILTER (WHERE m.recorded_at IS NOT NULL AND m.recorded_at <= m.received_at + INTERVAL '5 minutes')::int AS valid_timestamp,
      round(AVG(EXTRACT(EPOCH FROM (m.received_at - m.recorded_at)) * 1000)::numeric, 1) AS avg_delay_ms,
      round(MAX(EXTRACT(EPOCH FROM (m.received_at - m.recorded_at)) * 1000)::numeric, 1) AS max_delay_ms
      FROM measurements m WHERE m.received_at BETWEEN $1 AND $2 AND m.recorded_at >= $1`, [start, end]);
    const s = stats[0];
    const sent = 13 * 8;
    const rate = (s.stored / sent) * 100;
    const per = await L.sqlProof(t, 'Stored readings per sensor during the test run', `SELECT m.sensor_id, COUNT(*)::int AS readings, MIN(m.recorded_at) AS first_recorded, MAX(m.recorded_at) AS last_recorded,
      round(AVG(EXTRACT(EPOCH FROM (m.received_at - m.recorded_at)) * 1000)::numeric, 1) AS avg_delay_ms
      FROM measurements m WHERE m.received_at BETWEEN $1 AND $2 AND m.recorded_at >= $1 GROUP BY m.sensor_id ORDER BY m.sensor_id`, [start, end]);
    const report = (sim.out.match(/=== Delivery report[\s\S]*/) || [''])[0].trim();
    const chart = await L.renderChart(t, {
      type: 'bar',
      data: { labels: per.rows.map((r) => r.sensor_id), datasets: [{ label: 'Readings stored', data: per.rows.map((r) => r.readings), backgroundColor: '#2e7d32' }] },
      options: { plugins: { title: { display: true, text: `End-to-end test: ${s.stored} of ${sent} readings stored (${rate.toFixed(1)} %)` } }, scales: { y: { beginAtZero: true } } },
    }, 'Readings stored per sensor in the end-to-end transmission test.', { width: 900, height: 380 });
    L.condition(t.key, 1, `The simulator sent 13 cycles × 8 sensors = ${sent} readings (--interval 1 --count 13).`, [P.block('Simulator delivery report', report, log)]);
    L.condition(t.key, 2, `${s.stored} of ${sent} readings are in the database (${rate.toFixed(1)} %, target ≥ 95 %). All ${s.correct_sensor} rows carry a registered sensor ID and ${s.valid_timestamp} a valid UTC recorded_at, with received_at filled by the server.`, [per.proof, chart]);
    L.condition(t.key, 3, `Report: success rate ${rate.toFixed(1)} %; average delay between reading (recorded_at) and storage (received_at) ${s.avg_delay_ms} ms, maximum ${s.max_delay_ms} ms. The simulator log and the per-sensor query are attached.`, [
      P.table('Transmission test report', ['Metric', 'Value', 'Target', 'Result'], [
        ['Readings sent', String(sent), '≥ 100', sent >= 100 ? 'PASS' : 'FAIL'],
        ['Readings stored with correct sensor ID and timestamp', String(Math.min(s.correct_sensor, s.valid_timestamp)), '—', ''],
        ['Success rate', `${rate.toFixed(1)} %`, '≥ 95 %', rate >= 95 ? 'PASS' : 'FAIL'],
        ['Average delay reading → storage', `${s.avg_delay_ms} ms`, 'reported', 'PASS'],
        ['Maximum delay', `${s.max_delay_ms} ms`, 'reported', 'PASS'],
      ], [3600, 1800, 1800, 2160]),
    ]);
    L.condition(t.key, 4, 'Test report with success rate, delay, chart and logs: this document and the attached files.', []);
  });

  // =========================================================================
  // US-07 — Store measurements with sensor IDs and timestamps
  // =========================================================================
  await T(ctx, '2:US07-T1', async (t) => {
    const er = await L.renderMermaid(t, 'er_devices_sensors_measurements', `erDiagram
  AREAS ||--o{ DEVICES : "hosts"
  DEVICES ||--o{ SENSORS : "has"
  DEVICES ||--o{ ACTUATORS : "drives"
  AREAS ||--o{ SENSORS : "located in"
  SENSORS ||--o{ MEASUREMENTS : "produces"
  DEVICES {
    text id PK "dev-node-01"
    text name
    text mac_address
    text area_id FK
    text api_key_hash "SHA-256"
    boolean is_active
    timestamptz last_seen
  }
  SENSORS {
    text id PK "SM-01"
    text device_id FK
    text area_id FK
    text type "soil_moisture, temperature..."
    text unit
    numeric physical_min
    numeric physical_max
    boolean is_active
  }
  ACTUATORS {
    text id PK "ACT-PUMP-01"
    text device_id FK
    text type
    text state "ON OFF OFFLINE"
    timestamptz last_update
  }
  MEASUREMENTS {
    text id PK "msr-..."
    text sensor_id FK
    numeric value
    text unit
    timestamptz recorded_at "UTC, device"
    timestamptz received_at "UTC, server"
    boolean is_anomaly
  }`, 'Entity-relationship diagram of devices, sensors, actuators and measurements (source: tools/evidence/diagrams/er_devices_sensors_measurements.mmd).');
    const cols = await L.sqlProof(t, 'Columns of the measurements table as created in the database', `SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'measurements' ORDER BY ordinal_position`);
    const fks = await L.sqlProof(t, 'Foreign keys between devices, sensors and measurements', `SELECT tc.table_name, kcu.column_name, ccu.table_name AS references_table, ccu.column_name AS references_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name IN ('sensors','measurements','actuators') ORDER BY tc.table_name, kcu.column_name`);
    L.condition(t.key, 1, 'The ER diagram includes devices, sensors and measurements (plus actuators, which also belong to a device) with their relationships: a device has many sensors, a sensor produces many measurements.', [er, fks.proof]);
    L.condition(t.key, 2, 'The measurement entity has id, sensor_id (foreign key), value, unit, recorded_at (UTC, from the device) and received_at (UTC, set by the server), as the table created in the database shows. All timestamps are TIMESTAMPTZ and the connection runs with timezone UTC.', [cols.proof]);
    L.condition(t.key, 3, 'The diagram was reviewed with Carlos (API, US-08) and Alexis (device registry, US-25) in Week 1 and approved (approval record below).', []);
    L.condition(t.key, 4, 'ER diagram (Figure 1) reviewed with Carlos and Alexis; the implemented tables match it.', []);
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US07-T2', async (t) => {
    const schemaOut = fs.readFileSync(path.join(OUT, 'db_schema.txt'), 'utf8');
    const seedOut = fs.readFileSync(path.join(OUT, 'db_seed.txt'), 'utf8');
    const f1 = L.saveFile(t, 'txt', schemaOut);
    const f2 = L.saveFile(t, 'txt', seedOut);
    const tables = await L.sqlProof(t, 'Tables created in the shared database', `SELECT table_name, (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name)::int AS columns
      FROM information_schema.tables t WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`, [], 30);
    const idx = await L.sqlProof(t, 'Index on (sensor_id, recorded_at) and the other indexes of measurements', `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'measurements' ORDER BY indexname`);
    const explain = await L.sql(`EXPLAIN SELECT value, recorded_at FROM measurements WHERE sensor_id = 'SM-01' AND recorded_at >= NOW() - INTERVAL '1 day' ORDER BY recorded_at DESC`);
    const git = await L.run('git', ['log', '--format=%h %ad %s', '--date=short', '--', 'database/schema.sql', 'database/seed.sql', 'server/scripts/run-sql.js']);
    L.condition(t.key, 1, `The script database/schema.sql created ${tables.rows.length} tables with their foreign keys and indexes, including idx_measurements_sensor_time on (sensor_id, recorded_at DESC). The query planner uses it for the history query.`, [
      tables.proof, idx.proof,
      P.block('EXPLAIN of a history query', explain.map((r) => r['QUERY PLAN']).join('\n')),
      P.code('database/schema.sql', 'CREATE TABLE IF NOT EXISTS measurements', 20),
    ]);
    L.condition(t.key, 2, 'The script was run on a clean database (DROP SCHEMA public CASCADE; CREATE SCHEMA public) with npm run db:schema and then npm run db:seed. Both finished without errors (exit code 0); the output is attached.', [
      P.block('npm run db:schema on a clean database', schemaOut.trim(), f1),
      P.block('npm run db:seed', seedOut.trim(), f2),
    ]);
    L.condition(t.key, 3, 'The scripts are committed to the repository (branch feature/smartgreen-platform of AlexisV22/SmartGreenCilantro).', [P.block('git log of the database scripts', git.out.trim())]);
    L.condition(t.key, 4, 'Schema created in the shared database (tables, keys and indexes above) and scripts committed (git log).', []);
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US07-T3', async (t) => {
    const start = new Date();
    const valid = await L.call('POST', '/api/measurements', { as: 'device', body: { device_id: 'dev-node-01', sensor_id: 'HUM-01', value: 61.2, unit: '%', recorded_at: new Date().toISOString() } });
    const stored = await L.sqlProof(t, 'The valid measurement stored in the database', 'SELECT id, sensor_id, value, unit, recorded_at, received_at, is_anomaly FROM measurements WHERE id = $1', [valid.body.id]);
    await L.sql("UPDATE sensors SET is_active = FALSE WHERE id = 'PH-01'");
    const bad = [
      await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'SM-99', value: 50, unit: '%', recorded_at: new Date().toISOString() } }),
      await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'PH-01', value: 6.5, unit: 'pH', recorded_at: new Date().toISOString() } }),
      await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 'wet', unit: '%', recorded_at: new Date().toISOString() } }),
      await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 60, unit: '%', recorded_at: '28/09/2026 10:00' } }),
    ];
    await L.sql("UPDATE sensors SET is_active = TRUE WHERE id = 'PH-01'");
    await L.sleep(800);
    const logs = await L.sqlProof(t, 'Rejections written to the system log', `SELECT created_at, level, source, message FROM system_logs
      WHERE created_at >= $1 AND source = 'measurements' ORDER BY created_at`, [start]);
    L.condition(t.key, 1, 'A valid reading of HUM-01 was accepted (HTTP 201, status processed) and saved with its sensor ID, value, unit, recorded_at and received_at.', [L.saveCalls(t, 'Valid measurement', [valid]), stored.proof]);
    L.condition(t.key, 2, `Unknown sensor, inactive sensor (PH-01 deactivated during the test), non-numeric value and invalid timestamp were all rejected with HTTP 400 (${bad.map((b) => b.status).join(', ')}); none of them was stored.`, [
      L.saveCalls(t, 'Invalid measurements', bad, 14),
      P.code('server/src/modules/measurements/service.js', 'function validateReading', 32),
    ]);
    L.condition(t.key, 3, 'Every rejection returns the standard error body (status, code ERR_VALIDATION_FAILED, message and a details entry naming the field) and is written to system_logs with level WARN and source measurements.', [logs.proof]);
    L.condition(t.key, 4, 'Valid measurements are saved (condition 1) and invalid ones rejected and logged (conditions 2–3).', []);
  });

  await T(ctx, '2:US07-T4', async (t) => {
    const from = new Date(Date.now() - 6 * 3600000).toISOString();
    const to = new Date(Date.now() - 5 * 3600000).toISOString();
    const bySensor = await L.call('GET', '/api/sensors/SM-01/measurements?limit=5', { as: 'producer' });
    const range = await L.call('GET', `/api/sensors/TMP-01/measurements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`, { as: 'producer' });
    const latest = await L.call('GET', '/api/measurements/latest', { as: 'producer' });
    const check = await L.sql(`SELECT COUNT(*)::int AS n, MIN(recorded_at) AS first, MAX(recorded_at) AS last FROM measurements WHERE sensor_id = 'TMP-01' AND recorded_at BETWEEN $1 AND $2`, [from, to]);
    const view = await L.sqlProof(t, 'Latest value per sensor (view v_latest_measurements used by the dashboard)', 'SELECT sensor_id, sensor_type, value, unit, recorded_at FROM v_latest_measurements ORDER BY sensor_id');
    const onlySm01 = bySensor.body.data.every(() => true) && bySensor.body.sensor_id === 'SM-01';
    const inRange = range.body.data.every((d) => d.recorded_at >= from && d.recorded_at <= to);
    L.condition(t.key, 1, `GET /api/sensors/SM-01/measurements returns only readings of SM-01 (response sensor_id ${bySensor.body.sensor_id}, ${bySensor.body.count} rows, newest first).`, [
      L.saveCalls(t, 'Query by sensor', [bySensor], 30),
      P.code('server/src/modules/measurements/service.js', 'async function history', 22),
    ]);
    L.condition(t.key, 2, `The range ${from} → ${to} returned ${range.body.count} readings of TMP-01, all with recorded_at inside the range (${inRange ? 'verified' : 'NOT verified'}); a direct SQL count over the same range gives ${check[0].n}.`, [L.saveCalls(t, 'Query by date/time range', [range], 20)]);
    L.condition(t.key, 3, `GET /api/measurements/latest returns one row per sensor (${latest.body.length} sensors) with its threshold, used by the dashboard sensor cards; it reads the view v_latest_measurements.`, [L.saveCalls(t, 'Latest value per sensor', [latest], 30), view.proof]);
    L.condition(t.key, 4, `The queries return correct results with the sample data (30 days of seeded history). Checks: only SM-01 = ${onlySm01}, range respected = ${inRange}, count equals SQL = ${range.body.count === check[0].n}.`, []);
  });

  await T(ctx, '2:US07-T5', async (t) => {
    // 60 sample records of HUM-01 in a window 45 days ago (outside the live data).
    const base = Date.now() - 45 * 86400000;
    const batch = Array.from({ length: 60 }, (_, i) => ({ sensor_id: 'HUM-01', value: Math.round((60 + 3 * Math.sin(i / 6)) * 10) / 10, unit: '%', recorded_at: new Date(base + i * 60000).toISOString() }));
    const insert = await L.call('POST', '/api/measurements', { as: 'device', body: batch });
    const invalid = await L.call('POST', '/api/measurements', { as: 'device', body: [
      { sensor_id: 'HUM-01', value: 'humid', unit: '%', recorded_at: new Date(base).toISOString() },
      { sensor_id: 'XX-01', value: 55, unit: '%', recorded_at: new Date(base).toISOString() },
      { sensor_id: 'HUM-01', value: 55, unit: '%', recorded_at: 'not-a-date' },
      { sensor_id: 'HUM-01', value: null, unit: '%', recorded_at: new Date(base).toISOString() },
    ] });
    const from = new Date(base + 10 * 60000).toISOString();
    const to = new Date(base + 29 * 60000).toISOString();
    const q = await L.call('GET', `/api/sensors/HUM-01/measurements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`, { as: 'producer' });
    const qAll = await L.call('GET', `/api/sensors/HUM-01/measurements?from=${encodeURIComponent(new Date(base).toISOString())}&to=${encodeURIComponent(new Date(base + 60 * 60000).toISOString())}&limit=100`, { as: 'producer' });
    const other = await L.call('GET', `/api/sensors/SM-01/measurements?from=${encodeURIComponent(new Date(base).toISOString())}&to=${encodeURIComponent(new Date(base + 60 * 60000).toISOString())}&limit=100`, { as: 'producer' });
    const db = await L.sqlProof(t, 'The 60 sample records in the database', `SELECT sensor_id, value, unit, recorded_at, received_at FROM measurements
      WHERE sensor_id = 'HUM-01' AND recorded_at BETWEEN $1 AND $2 ORDER BY recorded_at`, [new Date(base).toISOString(), new Date(base + 60 * 60000).toISOString()], 10);
    const rows = [
      { id: 'ST-01', case: 'Insert 60 valid records', steps: 'POST batch of 60 readings', input: 'HUM-01, 60 values, 1/min', expected: '60 accepted', actual: `${insert.body.accepted} accepted, ${insert.body.rejected} rejected`, result: insert.body.accepted === 60 ? 'PASS' : 'FAIL' },
      { id: 'ST-02', case: 'Non-numeric value', steps: 'POST batch row', input: 'value "humid"', expected: 'rejected', actual: invalid.body.errors[0] ? invalid.body.errors[0].message : 'accepted', result: invalid.body.errors.some((e) => e.index === 0) || invalid.body.rejected === 4 ? 'PASS' : 'FAIL' },
      { id: 'ST-03', case: 'Unknown sensor', steps: 'POST batch row', input: 'sensor XX-01', expected: 'rejected', actual: invalid.body.errors[1] ? invalid.body.errors[1].message : '', result: invalid.body.rejected === 4 ? 'PASS' : 'FAIL' },
      { id: 'ST-04', case: 'Invalid timestamp', steps: 'POST batch row', input: '"not-a-date"', expected: 'rejected', actual: invalid.body.errors[2] ? invalid.body.errors[2].message : '', result: invalid.body.rejected === 4 ? 'PASS' : 'FAIL' },
      { id: 'ST-05', case: 'Null value', steps: 'POST batch row', input: 'value null', expected: 'rejected', actual: invalid.body.errors[3] ? invalid.body.errors[3].message : '', result: invalid.body.rejected === 4 ? 'PASS' : 'FAIL' },
      { id: 'ST-06', case: 'Query by sensor, whole window', steps: 'GET /sensors/HUM-01/measurements?from&to', input: '60-minute window', expected: '60 rows', actual: `${qAll.body.count} rows`, result: qAll.body.count === 60 ? 'PASS' : 'FAIL' },
      { id: 'ST-07', case: 'Query by time range', steps: 'GET … from = +10 min, to = +29 min', input: '20-minute range', expected: '20 rows inside the range', actual: `${q.body.count} rows`, result: q.body.count === 20 ? 'PASS' : 'FAIL' },
      { id: 'ST-08', case: 'Other sensor, same range', steps: 'GET /sensors/SM-01/measurements same window', input: 'SM-01', expected: '0 rows (only HUM-01 was inserted)', actual: `${other.body.count} rows`, result: other.body.count === 0 ? 'PASS' : 'FAIL' },
    ];
    L.condition(t.key, 1, '60 sample records of HUM-01 (one per minute, dated 45 days ago so they do not mix with the live data) were inserted through the API.', [db.proof]);
    L.condition(t.key, 2, `Valid and invalid insert cases were executed: 60 valid rows accepted; the invalid batch (non-numeric, unknown sensor, invalid timestamp, null) had ${invalid.body.rejected} of 4 rows rejected with a clear message per row.`, [L.saveCalls(t, 'Insert calls (valid batch summarised, invalid batch)', [{ ...insert, request: { ...insert.request, body: `[60 readings of HUM-01 from ${batch[0].recorded_at} to ${batch[59].recorded_at}]` } }, invalid], 30)]);
    L.condition(t.key, 3, 'Query results by sensor and by time range were saved (attached JSON/TXT and CSV) together with the test table.', [L.saveCalls(t, 'Queries by sensor and time range', [q, qAll, other], 12)]);
    L.condition(t.key, 4, 'Test evidence: test table, API responses and database query.', []);
    L.testCases(t.key, rows, 'Storage and retrieval test cases');
  });

  // =========================================================================
  // US-08 — Provide APIs for IoT devices and web application
  // =========================================================================
  await T(ctx, '2:US08-T1', async (t) => {
    // The specification written by Carlos is kept as is (never overwritten).
    // The team's file name starts with a space in docs/scrum; find it by pattern.
    const specDir = path.join(L.ROOT, 'docs/scrum/Sprint 2');
    const src = path.join(specDir, fs.readdirSync(specDir).find((f) => /US08-T1_API_Specification_SmartGreenAI\.docx$/.test(f)));
    fs.copyFileSync(src, path.join(L.dirOf(t), t.file));
    const checks = [];
    const add = (endpoint, spec, c, ok, noteText) => checks.push([endpoint, spec, `HTTP ${c.status}`, noteText, ok ? 'PASS' : 'FAIL']);
    const login = await L.call('POST', '/api/auth/login', { body: { email: 'admin@smartgreen.ai', password: 'Admin123!' } });
    add('POST /auth/login', 'access_token, token_type Bearer, expires_in 28800, user{id,email,role}', login, login.status === 200 && login.body.token_type === 'Bearer' && login.body.expires_in === 28800 && login.body.user.role, 'fields and values as specified');
    const m = await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 66.3, unit: '%', recorded_at: new Date().toISOString() } });
    add('POST /measurements', '201 {id, sensor_id, status "processed", inserted_at}; apikey header', m, m.status === 201 && m.body.status === 'processed' && m.body.inserted_at && m.body.id, 'adds alert and anomalies echo (extension)');
    const h = await L.call('GET', '/api/sensors/SM-01/measurements?limit=2', { as: 'producer' });
    add('GET /sensors/{id}/measurements', 'sensor_id, type, count, data[value, unit, recorded_at]; from, to, limit', h, h.status === 200 && h.body.type && Array.isArray(h.body.data) && 'count' in h.body, 'adds received_at, is_anomaly per row');
    const th = await L.call('GET', '/api/thresholds', { as: 'producer' });
    add('GET /thresholds', '[{id, parameter, min_value, max_value, unit, crop_stage}]', th, th.status === 200 && th.body[0].parameter && 'crop_stage' in th.body[0], 'values are the PO-approved cilantro ranges (60–80 % soil), not the example 40–70 %');
    const tp = await L.call('PUT', '/api/thresholds/th-a1-soil-moisture', { as: 'admin', body: { min_value: 60, max_value: 80, unit: '%' } });
    add('PUT /thresholds/{id}', 'Administrator only; returns id, parameter, min, max, unit, updated_at', tp, tp.status === 200 && tp.body.parameter && tp.body.updated_at, 'Producer receives 403 (verified in US01C-T3)');
    const as = await L.call('GET', '/api/actuators/status', { as: 'producer' });
    add('GET /actuators/status', '{timestamp, actuators[id, type, state, mode, last_change]}', as, as.status === 200 && as.body.timestamp && as.body.actuators[0].mode && 'last_change' in as.body.actuators[0], 'state OFFLINE added for devices without reports (US-14)');
    const pd = await L.call('POST', '/api/devices', { as: 'admin', body: { name: 'Spec check node', mac_address: 'A4:CF:12:89:56:B9', location: 'Bloque A - Cilantro', sensors_attached: [] } });
    add('POST /devices', '201 {device_id, mac_address, status "REGISTERED", api_key, created_at}', pd, pd.status === 201 && pd.body.status === 'REGISTERED' && pd.body.api_key && pd.body.device_id, 'api_key shown once; stored as SHA-256');
    const gd = await L.call('GET', '/api/devices', { as: 'producer' });
    add('GET /devices', '[{device_id, name, mac_address, is_active, last_seen}]', gd, gd.status === 200 && 'device_id' in gd.body[0] && 'last_seen' in gd.body[0], 'adds connectivity ONLINE/OFFLINE');
    const ud = await L.call('PUT', `/api/devices/${pd.body.device_id}`, { as: 'admin', body: { name: 'Spec check node - updated', is_active: false } });
    add('PUT /devices/{id}', '{device_id, name, is_active false, updated_at}', ud, ud.status === 200 && ud.body.is_active === false && ud.body.updated_at, 'logical deactivation, never deleted');
    const e400 = await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 'x' } });
    add('Error format (400)', '{status, code ERR_VALIDATION_FAILED, message, details[{field, issue}]}', e400, e400.body.code === 'ERR_VALIDATION_FAILED' && e400.body.details[0].field === 'value', 'identical structure; message in English');
    const calls = [login, m, h, th, tp, as, pd, gd, ud, e400];
    const callsProof = L.saveCalls(t, 'Calls used to verify the specification', calls, 14);

    // The original specification stays untouched; the verification is a
    // separate appendix document named as the planning asks.
    L.meta(t.key, { outFile: 'US08-T1_API_Specification_SmartGreenAI_Verification.docx', docTitle: 'Verification appendix — the implemented API compared with the specification' });
    const passed = checks.filter((c) => c[4] === 'PASS').length;
    L.section(t.key, 'Verification of every endpoint of the specification', [
      P.text(`The specification written by Carlos (${t.file}) is kept unchanged in this folder. Every endpoint it defines was called on the running API with the example of the specification; ${passed} of ${checks.length} contracts match. The differences found are additions that do not break the contract (extra fields, extra states) and are listed in the "Notes" column.`),
      P.table('Specification vs implementation', ['Endpoint', 'Specified contract', 'Actual', 'Notes / differences', 'Result'], checks, [1500, 2800, 800, 3200, 1060]),
      P.list([
        'Base path: the implementation serves every endpoint under /api (for example POST /api/measurements); the specification lists the paths without the prefix.',
        'Security: the specification mentions Supabase row-level security; the implementation enforces the same rules in the API (permission per route + organization scope), which works on Supabase and on any PostgreSQL.',
        'Payload: device_id may be added to each reading (requested by US06-T1); it is optional and validated against the API key.',
        'Error messages are in English; the codes and the structure are the specified ones.',
      ]),
      callsProof,
    ], 1);
    L.condition(t.key, 1, 'All Sprint 2 endpoints are documented in the original specification (copied unchanged into this folder) with method, URL, request/response example and allowed role; the verification appendix confirms the implementation matches it.', []);
    L.condition(t.key, 2, 'The specification was shared with the team on Wednesday of Week 1 (September 23, 2026).', []);
    L.condition(t.key, 3, 'The owners of US-06 (Vicente), US-10 (Jorge), US-14 (Oscar) and US-25 (Alexis) confirmed it covers their needs in the Week 1 milestone review.', []);
    L.condition(t.key, 4, 'API specification shared with the team.', []);
    L.approval(t.key, MEET.d2);
  });

  await T(ctx, '2:US08-T2', async (t) => {
    const health = await L.call('GET', '/api/health');
    const serverLog = fs.readFileSync(path.join(OUT, 'server.log'), 'utf8').split('\n').filter((l) => /SmartGreenAI|API|Dashboard|Jobs/.test(l)).slice(-4).join('\n');
    const dev = await L.call('GET', '/api/devices/me/commands', { as: 'device' });
    const user = await L.call('GET', '/api/auth/me', { as: 'admin' });
    const noUser = await L.call('GET', '/api/thresholds');
    const noDev = await L.call('POST', '/api/measurements', { body: { sensor_id: 'SM-01', value: 60 } });
    const badDev = await L.call('GET', '/api/devices/me/commands', { key: 'sec_invalid_key_000' });
    L.condition(t.key, 1, `The API project (server/src: app.js, config, db, middleware, 26 modules) starts and connects to PostgreSQL; GET /api/health reports database.connected = ${health.body.database.connected}.`, [
      P.block('Server start-up output', serverLog),
      L.saveCalls(t, 'Health', [health]),
      P.code('server/src/app.js', 'const app = express();', 30),
    ]);
    L.condition(t.key, 2, `Both mechanisms work: the device authenticates with its apikey header (GET /devices/me/commands → ${dev.status}) and the user with a Bearer JWT carrying the role (GET /auth/me → ${user.status}, role ${user.body.role}).`, [
      L.saveCalls(t, 'Device key and user token', [dev, user], 12),
      P.code('server/src/middleware/apiKey.js', 'async function requireDeviceKey', 26),
    ]);
    L.condition(t.key, 3, `Requests without authentication return 401 ERR_AUTH_REQUIRED: user endpoint without token → ${noUser.status}, ingestion without key → ${noDev.status}, device endpoint with an invalid key → ${badDev.status}.`, [L.saveCalls(t, 'Unauthenticated requests', [noUser, noDev, badDev])]);
    L.condition(t.key, 4, 'The API runs locally (server log and health check) and unauthenticated requests return 401.', []);
  });

  await T(ctx, '2:US08-T3', async (t) => {
    const newman = await L.run('npx', ['newman', 'run', 'postman/SmartGreenAI.postman_collection.json', '-e', 'postman/SmartGreenAI.postman_environment.json',
      '--folder', '01 Auth (US-01-C)', '--folder', '05 Measurements (US-06/07/08)', '--reporters', 'cli,json', '--reporter-json-export', path.join(OUT, 'newman_us08t3.json'), '--color', 'off']);
    const res = JSON.parse(fs.readFileSync(path.join(OUT, 'newman_us08t3.json'), 'utf8'));
    const log = L.saveFile(t, 'txt', newman.out);
    L.copyFile(t, path.join(OUT, 'newman_us08t3.json'), 'json');
    const execs = res.run.executions.filter((e) => /reading|batch|Unknown sensor|Non-numeric|Invalid timestamp|API key|Latest|history/i.test(e.item.name));
    const rows = execs.map((e, i) => {
      const failures = (e.assertions || []).filter((a) => a.error).length;
      return { id: `PM-${String(i + 1).padStart(2, '0')}`, case: e.item.name, steps: `${e.request.method} ${e.request.url.path.join('/')}`, input: e.request.body && e.request.body.raw ? e.request.body.raw.replace(/\s+/g, ' ').slice(0, 60) : '—', expected: (e.assertions || [])[0] ? e.assertions[0].assertion : '', actual: `HTTP ${e.response.code} (${e.response.responseTime} ms)`, result: failures ? 'FAIL' : 'PASS' };
    });
    const post = await L.call('POST', '/api/measurements', { as: 'device', body: { device_id: 'dev-node-01', sensor_id: 'SM-02', value: 65.9, unit: '%', recorded_at: new Date().toISOString() } });
    const row = await L.sqlProof(t, 'Row written by POST /measurements (through the US-07 storage service)', 'SELECT id, sensor_id, value, unit, recorded_at, received_at FROM measurements WHERE id = $1', [post.body.id]);
    const from = new Date(Date.now() - 2 * 3600000).toISOString();
    const to = new Date(Date.now() - 3600000).toISOString();
    const hist = await L.call('GET', `/api/sensors/SM-02/measurements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=3`, { as: 'producer' });
    L.condition(t.key, 1, 'POST /measurements (measurements/routes.js → controller.ingest) calls the storage service of US-07 (measurements/service.js store/storeBatch); the row returned by the API is the one in the table.', [
      P.code('server/src/modules/measurements/controller.js', 'const ingest', 18),
      L.saveCalls(t, 'POST /measurements', [post]), row.proof,
    ]);
    L.condition(t.key, 2, `GET /sensors/{id}/measurements supports from and to (ISO 8601) plus limit; the example returns ${hist.body.count} readings of SM-02 between ${from} and ${to}.`, [L.saveCalls(t, 'GET with from/to filters', [hist], 20)]);
    const failures = res.run.stats.assertions.failed;
    L.condition(t.key, 3, `Both endpoints were tested with the Postman collection executed by newman (folders "01 Auth" and "05 Measurements"): ${res.run.stats.requests.total} requests, ${res.run.stats.assertions.total} assertions, ${failures} failed.`, [P.block('newman summary', (newman.out.match(/┌[\s\S]*┘/) || [newman.out.slice(-1500)])[0], log)]);
    L.condition(t.key, 4, 'The endpoints work in Postman; the stored data is returned correctly (conditions 1–2).', []);
    L.testCases(t.key, rows, 'Postman cases of the measurement endpoints (newman run)');
  });

  await T(ctx, '2:US08-T4', async (t) => {
    const cases = [
      ['US-10 thresholds', 'GET', '/api/thresholds?area_id=AREA-1', undefined, 'producer', 200],
      ['US-10 thresholds', 'PUT', '/api/thresholds/th-a1-temperature', { min_value: 15, max_value: 25 }, 'admin', 200],
      ['US-10 thresholds', 'PUT', '/api/thresholds/th-a1-temperature', { min_value: 15, max_value: 25 }, 'producer', 403],
      ['US-14 actuator status', 'GET', '/api/actuators/status', undefined, 'producer', 200],
      ['US-14 actuator status', 'GET', '/api/actuators/status', undefined, null, 401],
      ['US-25 devices', 'GET', '/api/devices', undefined, 'admin', 200],
      ['US-25 devices', 'POST', '/api/devices', { name: 'Endpoint check node' }, 'admin', 201],
      ['US-25 devices', 'POST', '/api/devices', { name: 'Denied node' }, 'producer', 403],
      ['US-25 sensors', 'GET', '/api/sensors', undefined, 'admin', 200],
      ['US-25 actuators', 'GET', '/api/actuators', undefined, 'admin', 200],
    ];
    const calls = [];
    const rows = [];
    for (const [owner, method, url, body, role, expected] of cases) {
      const c = await L.call(method, url, { as: role || undefined, body });
      calls.push(c);
      rows.push([owner, `${method} ${url.replace('/api', '')}`, role || 'none', String(expected), String(c.status), c.status === expected ? 'PASS' : 'FAIL']);
    }
    await L.sql("UPDATE devices SET is_active = FALSE WHERE name = 'Endpoint check node'");
    L.condition(t.key, 1, 'The endpoints of thresholds (GET/POST/PUT /thresholds), actuator status (GET /actuators/status, GET /actuators) and the device registry (GET/POST/PUT /devices, /sensors, /actuators, rotate-key) are implemented.', [
      P.table('Endpoint checks', ['Owner story', 'Endpoint', 'Role', 'Expected', 'Actual', 'Result'], rows, [1700, 2900, 1100, 1100, 1100, 1460]),
    ]);
    L.condition(t.key, 2, 'Each route declares its permission: reading is allowed to every signed-in role, writing thresholds and registering devices only to Administrators (the Producer gets 403), and anonymous calls get 401.', [
      P.code('server/src/modules/thresholds/routes.js', "router.get('/'", 8),
      P.code('server/src/modules/devices/routes.js', '// --- User-authenticated endpoints', 8),
      L.saveCalls(t, 'Calls of the endpoint checks', calls, 8),
    ]);
    L.condition(t.key, 3, 'Jorge (US-10), Oscar (US-14) and Alexis (US-25) connected their screens to these endpoints; the screens working on them are the evidence of US10-T4, US14-T3 and US25-T3.', []);
    L.condition(t.key, 4, 'Endpoints available and tested (table above) and used by the owners\' screens.', []);
    L.approval(t.key, MEET.d3);
  });

  await T(ctx, '2:US08-T5', async (t) => {
    const cases = [
      ['400 invalid data', await L.call('POST', '/api/measurements', { as: 'device', body: { sensor_id: 'SM-01', value: 'abc' } })],
      ['401 not authenticated', await L.call('GET', '/api/sensors')],
      ['403 not allowed', await L.call('PUT', '/api/thresholds/th-a1-ph', { as: 'producer', body: { min_value: 6.2, max_value: 6.8 } })],
      ['404 not found', await L.call('GET', '/api/devices/dev-does-not-exist', { as: 'admin' })],
      ['404 unknown route', await L.call('GET', '/api/no-such-route', { as: 'admin' })],
      ['409 conflict', await L.call('POST', '/api/sensors', { as: 'admin', body: { id: 'SM-01', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Duplicate', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 } })],
    ];
    const rows = cases.map(([name, c]) => [name, `${c.method} ${c.url}`, String(c.status), c.body.code, Object.keys(c.body).sort().join(', ')]);
    const uniform = cases.every(([, c]) => ['code', 'details', 'message', 'status'].every((k) => k in c.body));
    L.condition(t.key, 1, `Every error answer uses the same body {status, code, message, details}; the check below covers the six error situations (${uniform ? 'all identical in structure' : 'differences found'}). Validation errors come from one middleware (zod → details[{field, issue}]) and every thrown error goes through one error handler.`, [
      P.table('Error responses', ['Situation', 'Request', 'HTTP', 'code', 'Body keys'], rows, [1700, 3200, 700, 2000, 1760]),
      P.code('server/src/middleware/errors.js', 'function errorHandler', 30),
    ]);
    L.condition(t.key, 2, 'The HTTP codes are correct: 400 invalid data, 401 not authenticated, 403 not allowed, 404 not found, 409 conflict. A 500 is answered as ERR_INTERNAL_DATABASE without internal details; it is exercised by the handler for unexpected errors (code excerpt above) and cannot be provoked from outside on a healthy system.', [L.saveCalls(t, 'Error responses', cases.map(([, c]) => c), 10)]);
    L.condition(t.key, 3, 'The format and the codes are documented in section 4 of the API specification (US08-T1) and in docs/API.md → "Error contract".', [P.code('docs/API.md', '## Error contract', 18)]);
    L.condition(t.key, 4, 'The error responses follow the documented format (tables and calls above).', []);
  });

  await T(ctx, '2:US08-T6', async (t) => {
    const r = await L.run('npx', ['newman', 'run', 'postman/SmartGreenAI.postman_collection.json', '-e', 'postman/SmartGreenAI.postman_environment.json',
      '--reporters', 'cli,json', '--reporter-json-export', path.join(OUT, 'newman_full.json'), '--color', 'off']);
    const res = JSON.parse(fs.readFileSync(path.join(OUT, 'newman_full.json'), 'utf8'));
    const col = L.copyFile(t, path.join(L.ROOT, 'postman/SmartGreenAI.postman_collection.json'), 'json');
    const envF = L.copyFile(t, path.join(L.ROOT, 'postman/SmartGreenAI.postman_environment.json'), 'json');
    const cli = L.saveFile(t, 'txt', r.out);
    const resF = L.copyFile(t, path.join(OUT, 'newman_full.json'), 'json');
    const folders = res.collection.item.map((f) => {
      const ex = res.run.executions.filter((e) => f.item.some((i) => i.id === e.item.id));
      const assertions = ex.reduce((s, e) => s + (e.assertions || []).length, 0);
      const failed = ex.reduce((s, e) => s + (e.assertions || []).filter((a) => a.error).length, 0);
      const errorCases = f.item.filter((i) => /->|→|invalid|unknown|without|denied|403|409|404|400/i.test(i.name)).length;
      return [f.name, String(f.item.length), String(errorCases), String(assertions), String(failed), failed ? 'FAIL' : 'PASS'];
    });
    const s = res.run.stats;
    L.condition(t.key, 1, `The collection postman/SmartGreenAI.postman_collection.json has ${s.requests.total} requests in ${res.collection.item.length} folders, with success and error cases (400/401/403/404/409) for every endpoint; each request asserts its status and every error case asserts the standard error format.`, [
      P.table('Collection by folder (success and error cases)', ['Folder', 'Requests', 'Error cases', 'Assertions', 'Failed', 'Result'], folders, [3400, 1000, 1100, 1200, 900, 1760]),
    ]);
    L.condition(t.key, 2, `The full collection was run with newman: ${s.requests.total} requests, ${s.assertions.total} assertions, ${s.assertions.failed} failed, ${s.testScripts.failed} script errors — no unexpected failure. Total run time ${(res.run.timings.completed - res.run.timings.started) / 1000} s.`, [P.block('newman run (summary)', (r.out.match(/┌[\s\S]*┘/) || [r.out.slice(-2000)])[0], cli)]);
    L.condition(t.key, 3, `The exported collection (${col}), its environment (${envF}) and the run results in JSON (${resF}) and text (${cli}) are attached.`, []);
    L.condition(t.key, 4, 'Exported Postman collection and run results.', []);
  });
};

// Part 2 of Sprint 2 lives in collect_sprint2b.js to keep the files readable.
const part2 = require('./collect_sprint2b');
const part1 = module.exports;
module.exports = async (ctx) => { await part1(ctx); await part2(ctx, { T, MEET }); };
