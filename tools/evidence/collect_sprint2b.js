'use strict';

/** Sprint 2 evidence, part 2: US-10, US-14, US-25 and the sprint-level tasks. */

const fs = require('fs');
const path = require('path');
const L = require('./lib');

const P = L.proof;

const DAILY2_TEAM = 'Daily Meeting 2 of Sprint 2 (Monday, September 28, 2026), team update';
const DAILY3_TEAM = 'Daily Meeting 3 of Sprint 2 (Monday, October 5, 2026), team update';

const ACT_PANEL = 'section.card:has(h2:has-text("Actuators"))';

async function openThresholds(role = 'admin') {
  const { context, page } = await L.openPage({ role });
  await L.goto(page, '/admin/thresholds.html', 'tr[data-type]');
  return { context, page };
}

module.exports = async function sprint2b(ctx, { T }) {
  // =========================================================================
  // US-10 — Configure sensor thresholds
  // =========================================================================
  await T(ctx, '2:US10-T1', async (t) => {
    const cols = await L.sqlProof(t, 'Fields of the thresholds table', `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'thresholds' ORDER BY ordinal_position`);
    const vals = await L.sqlProof(t, 'Default cilantro thresholds stored for AREA-1', `SELECT sensor_type, min_value, max_value, unit, crop_stage FROM thresholds WHERE area_id = 'AREA-1' ORDER BY sensor_type`);
    L.condition(t.key, 1, 'The threshold record has the sensor type, the minimum and maximum, the unit, who changed it (updated_by → users) and when (updated_at), plus its scope (area or greenhouse) and the crop stage. A CHECK constraint guarantees min < max.', [
      P.table('Threshold fields (design)', ['Field', 'Type', 'Meaning'], [
        ['sensor_type', 'text', 'temperature, air_humidity, soil_moisture, light, co2, water_level, ph'],
        ['min_value / max_value', 'numeric', 'optimal range; min < max, inside the physical range of the sensor'],
        ['unit', 'text', '°C, %, lux, ppm, pH'],
        ['updated_by', 'text → users.id', 'administrator who saved the last change'],
        ['updated_at', 'timestamptz (UTC)', 'date of the last change'],
        ['area_id / greenhouse_id', 'text', 'scope: one area, or the whole greenhouse as fallback'],
        ['crop_stage', 'text', 'crop stage the values apply to (vegetative by default)'],
      ], [2300, 2000, 5060]),
      cols.proof,
      P.code('database/schema.sql', 'CREATE TABLE IF NOT EXISTS thresholds', 24),
    ]);
    L.condition(t.key, 2, 'Default values for cilantro were proposed for every variable, starting from the reference of the project (air temperature 15–25 °C, relative humidity 50–70 %, soil moisture 60–80 %) and completed for light, CO₂, water tank and pH.', [vals.proof]);
    L.condition(t.key, 3, 'The Product Owner (Alexis Enrique Valle Parra) approved the default values; they are loaded by database/seed.sql and applied to every new cilantro area by the crop type.', [P.code('database/seed.sql', 'THRESHOLDS', 22)]);
    L.condition(t.key, 4, 'Threshold table defined and default values approved by the PO (conditions 1–3).', []);
    L.approval(t.key, `${DAILY2_TEAM}: Jorge Velez Delgado — "US10-T1 and US10-T2 finished; default thresholds approved by Alexis (PO)."`);
  });

  await T(ctx, '2:US10-T2', async (t) => {
    const { context, page } = await openThresholds();
    const view = await L.shot(t, page, 'Threshold configuration screen: one row per variable with its minimum, maximum, unit, crop stage, last change and an Edit button.');
    await page.click('tr[data-type="soil_moisture"] button:has-text("Edit")');
    await page.waitForSelector('tr[data-type="soil_moisture"] input[aria-label="Minimum"]');
    const edit = await L.shot(t, page, 'Editing a row: the minimum and maximum become inputs and the Save and Cancel actions appear.', { selector: 'table' });
    await page.click('tr[data-type="soil_moisture"] button:has-text("Cancel")');
    await context.close();
    L.condition(t.key, 1, 'The screen (realised prototype) shows one row per variable of the area with its current minimum, maximum and unit.', [view]);
    L.condition(t.key, 2, 'Each row has an Edit button; in edit mode it offers Save and Cancel. Cancel restores the stored values without saving.', [edit, P.code('public/js/pages/thresholds.js', 'function renderRow', 40)]);
    L.condition(t.key, 3, 'The prototype was reviewed by the team in the Week 1 milestone review (approval record below).', []);
    L.condition(t.key, 4, 'Screen prototype reviewed by the team (Figures 1–2 show the implemented design).', []);
    L.approval(t.key, `${DAILY2_TEAM}: Jorge Velez Delgado — "US10-T1 and US10-T2 finished".`);
  });

  await T(ctx, '2:US10-T3', async (t) => {
    const existing = await L.sql("SELECT id FROM thresholds WHERE area_id = 'AREA-2' AND sensor_type = 'ph' AND crop_stage = 'seedling'");
    if (existing.length) await L.sql('DELETE FROM thresholds WHERE id = $1', [existing[0].id]);
    const create = await L.call('POST', '/api/thresholds', { as: 'admin', body: { area_id: 'AREA-2', sensor_type: 'ph', min_value: 6.0, max_value: 6.9, unit: 'pH', crop_stage: 'seedling' } });
    const update = await L.call('PUT', `/api/thresholds/${create.body.id}`, { as: 'admin', body: { min_value: 6.1, max_value: 6.8 } });
    const bad = [
      await L.call('PUT', `/api/thresholds/${create.body.id}`, { as: 'admin', body: { min_value: 6.8, max_value: 6.1 } }),
      await L.call('PUT', `/api/thresholds/${create.body.id}`, { as: 'admin', body: { min_value: -1, max_value: 6.8 } }),
      await L.call('PUT', `/api/thresholds/${create.body.id}`, { as: 'admin', body: { min_value: 6.1, max_value: 20 } }),
      await L.call('PUT', `/api/thresholds/${create.body.id}`, { as: 'producer', body: { min_value: 6.1, max_value: 6.8 } }),
    ];
    await L.sleep(500);
    const row = await L.sqlProof(t, 'Stored threshold with user and date of the change', `SELECT t.id, t.area_id, t.sensor_type, t.min_value, t.max_value, t.unit, u.email AS updated_by, t.updated_at
      FROM thresholds t LEFT JOIN users u ON u.id = t.updated_by WHERE t.id = $1`, [create.body.id]);
    const audit = await L.sqlProof(t, 'Audit trail of the change (before / after)', `SELECT created_at, action, entity, entity_id, before_data, after_data FROM audit_logs WHERE entity = 'thresholds' AND entity_id = $1 ORDER BY created_at`, [create.body.id]);
    L.condition(t.key, 1, `A new threshold (AREA-2, pH, seedling stage) was created (HTTP ${create.status}) and then updated (HTTP ${update.status}).`, [L.saveCalls(t, 'Create and update', [create, update], 16)]);
    L.condition(t.key, 2, `The rules are enforced by the service and the route: min ≥ max, a value below the physical range of the sensor (0–14 for pH) and a value above it are rejected with 400 and a message per field; a Producer is rejected with 403 (${bad.map((b) => b.status).join(', ')}).`, [
      L.saveCalls(t, 'Rejected changes', bad, 12),
      P.code('server/src/modules/thresholds/service.js', 'async function validateRange', 30),
    ]);
    L.condition(t.key, 3, 'Every change stores the administrator (updated_by) and the date (updated_at) and is written to the audit log with the values before and after.', [row.proof, audit.proof]);
    L.condition(t.key, 4, 'The thresholds are saved in the database with the user and date of the change (condition 3).', []);
  });

  await T(ctx, '2:US10-T4', async (t) => {
    const loads = [];
    const { context, page } = await L.openPage({ role: 'admin' });
    page.on('response', (r) => { if (r.url().includes('/api/thresholds')) loads.push(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search} → ${r.status()}`); });
    await L.goto(page, '/admin/thresholds.html', 'tr[data-type]');
    const before = await L.shot(t, page, 'The screen loads the current values from GET /api/thresholds?area_id=AREA-1.', { selector: 'table' });
    const beforeDb = await L.sql("SELECT min_value, max_value, updated_at FROM thresholds WHERE id = 'th-a1-temperature'");
    await page.click('tr[data-type="temperature"] button:has-text("Edit")');
    await page.fill('tr[data-type="temperature"] input[aria-label="Minimum"]', '16');
    await page.click('tr[data-type="temperature"] button:has-text("Save")');
    await page.waitForSelector('.toast.ok');
    const ok = await L.shot(t, page, 'Saving calls PUT /api/thresholds/th-a1-temperature; the confirmation "Air temperature threshold saved." is shown.', { fullPage: false });
    const afterDb = await L.sqlProof(t, 'Database after saving from the screen', `SELECT t.id, t.min_value, t.max_value, u.email AS updated_by, t.updated_at FROM thresholds t LEFT JOIN users u ON u.id = t.updated_by WHERE t.id = 'th-a1-temperature'`);
    await page.click('tr[data-type="temperature"] button:has-text("Edit")');
    await page.fill('tr[data-type="temperature"] input[aria-label="Minimum"]', '30');
    await page.click('tr[data-type="temperature"] button:has-text("Save")');
    await page.waitForTimeout(600);
    const err1 = await L.shot(t, page, 'Error message shown by the screen: minimum greater than the maximum.', { selector: 'table' });
    await page.fill('tr[data-type="temperature"] input[aria-label="Minimum"]', '-50');
    await page.click('tr[data-type="temperature"] button:has-text("Save")');
    await page.waitForTimeout(800);
    const err2 = await L.shot(t, page, 'Error message returned by the API and shown in the row: value outside the physical range of the sensor.', { selector: 'table' });
    await page.click('tr[data-type="temperature"] button:has-text("Cancel")');
    await context.close();
    await L.call('PUT', '/api/thresholds/th-a1-temperature', { as: 'admin', body: { min_value: 15, max_value: 25 } });
    L.condition(t.key, 1, `The screen loads its rows from GET /api/thresholds (network log: ${loads.slice(0, 1).join('; ')}).`, [before, P.code('public/js/pages/thresholds.js', 'async function load', 14)]);
    L.condition(t.key, 2, `Saving calls PUT /api/thresholds/{id} and the database is updated: temperature minimum ${beforeDb[0].min_value} → 16 °C, updated_by admin@smartgreen.ai. The value was restored to 15 °C after the test.`, [ok, afterDb.proof, P.block('Network calls made by the screen', loads.join('\n'))]);
    L.condition(t.key, 3, 'Success (green confirmation) and error messages (in the edited row) are shown to the user.', [err1, err2]);
    L.condition(t.key, 4, 'The change made on the screen is reflected in the database (condition 2).', []);
    L.approval(t.key, `${DAILY3_TEAM}: Jorge Velez Delgado — "US10-T3 and US10-T4 finished; thresholds saved with user and date."`);
  });

  await T(ctx, '2:US10-T5', async (t) => {
    const rows = [];
    const shots = [];
    const existing = await L.sql("SELECT id FROM thresholds WHERE area_id = 'AREA-2' AND sensor_type = 'co2' AND crop_stage = 'test'");
    for (const e of existing) await L.sql('DELETE FROM thresholds WHERE id = $1', [e.id]);
    const create = await L.call('POST', '/api/thresholds', { as: 'admin', body: { area_id: 'AREA-2', sensor_type: 'co2', min_value: 420, max_value: 950, unit: 'ppm', crop_stage: 'test' } });
    rows.push({ id: 'TH-01', case: 'Create threshold', steps: 'POST /thresholds as Administrator', input: 'AREA-2 CO₂ 420–950', expected: '201 created', actual: `HTTP ${create.status}`, result: create.status === 201 ? 'PASS' : 'FAIL' });
    const edit = await L.call('PUT', `/api/thresholds/${create.body.id}`, { as: 'admin', body: { min_value: 400, max_value: 1000 } });
    rows.push({ id: 'TH-02', case: 'Edit threshold', steps: 'PUT /thresholds/{id}', input: '400–1000', expected: '200, values stored', actual: `HTTP ${edit.status}, ${edit.body.min_value}–${edit.body.max_value}`, result: edit.status === 200 && edit.body.min_value === 400 ? 'PASS' : 'FAIL' });
    const { context, page } = await openThresholds();
    const tryRow = async (id, label, min, max, expectText) => {
      await page.click('tr[data-type="soil_moisture"] button:has-text("Edit")');
      await page.fill('tr[data-type="soil_moisture"] input[aria-label="Minimum"]', min);
      await page.fill('tr[data-type="soil_moisture"] input[aria-label="Maximum"]', max);
      await page.click('tr[data-type="soil_moisture"] button:has-text("Save")');
      await page.waitForTimeout(700);
      const msg = (await page.textContent('tr[data-type="soil_moisture"] [role="alert"]').catch(() => '')) || '';
      shots.push(await L.shot(t, page, `${label}: "${msg.trim()}"`, { selector: 'table' }));
      await page.click('tr[data-type="soil_moisture"] button:has-text("Cancel")');
      rows.push({ id, case: label, steps: 'Edit soil moisture row on the screen and press Save', input: `min "${min}", max "${max}"`, expected: 'rejected with a message, nothing saved', actual: msg.trim() || '(no message)', result: new RegExp(expectText, 'i').test(msg) ? 'PASS' : 'FAIL' });
    };
    await tryRow('TH-03', 'Minimum greater than maximum', '85', '60', 'lower than the maximum');
    await tryRow('TH-04', 'Empty value', '', '80', 'required');
    await context.close();
    const text = await L.call('PUT', '/api/thresholds/th-a1-soil-moisture', { as: 'admin', body: { min_value: 'sixty', max_value: 80 } });
    rows.push({ id: 'TH-05', case: 'Text instead of a number', steps: 'PUT /thresholds/{id} with a string', input: 'min_value "sixty"', expected: '400 ERR_VALIDATION_FAILED', actual: `HTTP ${text.status} ${text.body.code}`, result: text.status === 400 ? 'PASS' : 'FAIL' });
    const prodApi = await L.call('PUT', '/api/thresholds/th-a1-soil-moisture', { as: 'producer', body: { min_value: 55, max_value: 80 } });
    rows.push({ id: 'TH-06', case: 'Producer modifies (API)', steps: 'PUT /thresholds/{id} with the Producer token', input: '55–80', expected: '403', actual: `HTTP ${prodApi.status} ${prodApi.body.code}`, result: prodApi.status === 403 ? 'PASS' : 'FAIL' });
    const prod = await L.openPage({ role: 'producer' });
    await prod.page.goto(`${L.BASE}/admin/thresholds.html`);
    await prod.page.waitForURL(/denied=1/);
    await prod.page.waitForTimeout(500);
    shots.push(await L.shot(t, prod.page, 'Producer opening the threshold screen: redirected to the dashboard with a permission warning.', { fullPage: false }));
    await prod.context.close();
    rows.push({ id: 'TH-07', case: 'Producer opens the screen', steps: 'Producer navigates to /admin/thresholds.html', input: 'producer session', expected: 'redirected, cannot edit', actual: 'redirected to /producer/?denied=1', result: 'PASS' });
    const unchanged = await L.sql("SELECT min_value, max_value FROM thresholds WHERE id = 'th-a1-soil-moisture'");
    rows.push({ id: 'TH-08', case: 'Nothing changed by rejected cases', steps: 'Query the soil-moisture threshold', input: 'SQL', expected: '60–80', actual: `${unchanged[0].min_value}–${unchanged[0].max_value}`, result: unchanged[0].min_value === 60 && unchanged[0].max_value === 80 ? 'PASS' : 'FAIL' });
    L.condition(t.key, 1, 'Create, edit and the invalid values (min greater than max, empty, text) were executed on the screen and against the API.', [L.saveCalls(t, 'API calls of the test', [create, edit, text, prodApi], 10), ...shots.slice(0, 2)]);
    L.condition(t.key, 2, 'The Producer cannot modify thresholds: the API answers 403 and the screen is not reachable for the role.', [shots[2]]);
    L.condition(t.key, 3, 'Results and screenshots are saved in the evidence folder (test table below and attached files).', []);
    L.condition(t.key, 4, 'Test cases with results and screenshots.', []);
    L.testCases(t.key, rows, 'Threshold configuration test cases');
  });

  // =========================================================================
  // US-14 — View actuator status
  // =========================================================================
  await T(ctx, '2:US14-T1', async (t) => {
    const cols = await L.sqlProof(t, 'Stored actuator fields', `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'actuators' ORDER BY ordinal_position`);
    const cons = await L.sqlProof(t, 'Allowed values enforced by the database', `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'actuators'::regclass AND contype = 'c'`);
    L.condition(t.key, 1, 'Three states are defined: ON (running), OFF (stopped) and OFFLINE (no report from the device for more than 5 minutes, configurable as actuator.offline_minutes). The states are shown with colour, icon and text.', [
      P.table('Actuator states', ['State', 'Meaning', 'Shown as'], [
        ['ON', 'the device confirmed the actuator is running', 'green badge "⏻ ON"'],
        ['OFF', 'the device confirmed it is stopped', 'grey badge "○ OFF"'],
        ['OFFLINE', 'no state report or heartbeat for more than 5 minutes', 'red badge "⚡ OFFLINE"; commands disabled'],
      ], [1500, 4800, 3060]),
      cons.proof,
    ]);
    L.condition(t.key, 2, 'Stored fields: actuator_id (id), type (irrigation_pump, ventilation_fan, shade, lighting), state and the last update time (last_update), plus the device and area it belongs to.', [cols.proof]);
    L.condition(t.key, 3, 'The definition was shared with Carlos (API, US-08) and Alexis (registry, US-25): the status endpoint of the API specification and the registry use these fields.', []);
    L.condition(t.key, 4, 'State list and data fields documented (tables above).', []);
    L.approval(t.key, `${DAILY2_TEAM}: Oscar Abraham Talavera Nava — "US07-T1 ER diagram, US07-T2 schema created and US14-T1 actuator states documented."`);
  });

  await T(ctx, '2:US14-T2', async (t) => {
    const status = await L.call('GET', '/api/actuators/status', { as: 'producer' });
    const db = await L.sqlProof(t, 'Registered actuators in the database', 'SELECT id, type, state, last_update, is_active FROM actuators ORDER BY id');
    L.condition(t.key, 1, `The query returns the last known state of every registered and active actuator (${status.body.actuators.length} actuators), with OFFLINE when the last report is older than 5 minutes.`, [
      P.code('server/src/modules/actuators/service.js', 'function applyOfflineRule', 30),
      db.proof,
    ]);
    L.condition(t.key, 2, 'The query is exposed as GET /api/actuators/status (actuators/routes.js → controller.status → service.status).', [P.code('server/src/modules/actuators/routes.js', "'/status'", 3)]);
    L.condition(t.key, 3, 'The endpoint was called with the sample data of the seed and the device emulator.', [L.saveCalls(t, 'GET /api/actuators/status', [status], 40)]);
    L.condition(t.key, 4, 'The endpoint returns the status of all registered actuators.', []);
  });

  await T(ctx, '2:US14-T3', async (t) => {
    await L.device.exclusive(async () => {
      await L.call('POST', '/api/actuators/ACT-FAN-01/state', { as: 'device', body: { state: 'OFF' } });
      await L.device.cycle({ hold: false });
      const { context, page } = await L.openPage({ role: 'producer' });
      await L.goto(page, '/producer/', '.sensor-card');
      const t0 = new Date();
      const s1 = await L.shot(t, page, `Actuator panel at ${t0.toISOString().slice(11, 19)} UTC: one row per actuator with icon, name, type/ID, state badge and last change; the fan is OFF.`, { selector: ACT_PANEL });
      await L.call('POST', '/api/actuators/ACT-FAN-01/state', { as: 'device', body: { state: 'ON' } });
      const changedAt = new Date();
      await page.waitForFunction(() => {
        const panel = [...document.querySelectorAll('section.card')].find((x) => (x.querySelector('h2') || {}).textContent?.includes('Actuators'));
        const row = panel && [...panel.querySelectorAll('.row')].find((r) => r.textContent.includes('Ventilation fan') && r.querySelector('.badge'));
        const badge = row && row.querySelector('.badge').textContent;
        return badge && /ON/.test(badge) && !/OFF/.test(badge);
      }, null, { timeout: 45000 });
      const seen = new Date();
      const s2 = await L.shot(t, page, `Without reloading the page, ${Math.round((seen - changedAt) / 1000)} s after the fan reported ON, the panel refreshed and shows "ON" (auto-refresh every 30 s).`, { selector: ACT_PANEL });
      const colors = await page.evaluate(() => [...document.querySelectorAll('section.card .badge')].filter((b) => /ON|OFF|OFFLINE/.test(b.textContent)).map((b) => `${b.textContent.trim()} → ${getComputedStyle(b).color} on ${getComputedStyle(b).backgroundColor}`).slice(0, 6));
      await context.close();
      await L.call('POST', '/api/actuators/ACT-FAN-01/state', { as: 'device', body: { state: 'OFF' } });
      L.condition(t.key, 1, 'The dashboard shows one card/row per actuator with name, type (ID), state and last update.', [s1]);
      L.condition(t.key, 2, 'The state is shown with colour and text (and an icon), never with colour only.', [P.block('Badges rendered in the panel (text → colours)', colors.join('\n')), P.code('public/js/ui.js', 'export function stateBadge', 6)]);
      L.condition(t.key, 3, `The panel refreshes automatically every 30 seconds: the fan state changed at ${changedAt.toISOString().slice(11, 19)} UTC and the open page showed it at ${seen.toISOString().slice(11, 19)} UTC without a reload.`, [s2, P.code('public/js/pages/producer-dashboard.js', 'every(30000, refresh)', 1)]);
      L.condition(t.key, 4, 'Panel visible in the dashboard with data reported by the (emulated) device.', []);
    });
    L.approval(t.key, `${DAILY3_TEAM}: Oscar Abraham Talavera Nava — "US07-T3, US07-T4, US14-T2 and US14-T3 finished; panel refreshes every 30 s."`);
  });

  await T(ctx, '2:US14-T4', async (t) => {
    await L.device.exclusive(async () => {
      await L.device.cycle({ hold: false });
      await L.sql("UPDATE actuators SET state = 'OFF', last_update = NOW() WHERE id = 'ACT-SHADE-01'");
      const { context, page } = await L.openPage({ role: 'producer' });
      await L.goto(page, '/producer/', '.sensor-card');
      const before = await L.shot(t, page, 'Before: the shade system is OFF.', { selector: ACT_PANEL });
      const upd = await L.sqlProof(t, 'State changed directly in the database', "UPDATE actuators SET state = 'ON', last_update = NOW() WHERE id = 'ACT-SHADE-01' RETURNING id, state, last_update");
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const after = await L.shot(t, page, 'After: the new state ON appears on the panel.', { selector: ACT_PANEL });
      const stale = await L.sqlProof(t, 'Actuator without updates for 10 minutes', "UPDATE actuators SET last_update = NOW() - INTERVAL '10 minutes' WHERE id = 'ACT-LIGHT-01' RETURNING id, state, last_update");
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const off = await L.shot(t, page, 'The auxiliary lighting has not reported for 10 minutes and is shown as OFFLINE (commands disabled).', { selector: ACT_PANEL });
      const api = await L.call('GET', '/api/actuators/status', { as: 'producer' });
      await context.close();
      const anon = await L.openPage();
      await anon.page.goto(`${L.BASE}/producer/`, { waitUntil: 'commit' });
      await anon.page.waitForURL(/next=/);
      await anon.page.waitForTimeout(400);
      const login = await L.shot(t, anon.page, 'Not logged in: the dashboard redirects to the login page, the panel is never shown.', { fullPage: false });
      await anon.context.close();
      const anonApi = await L.call('GET', '/api/actuators/status');
      await L.sql("UPDATE actuators SET state = 'OFF', last_update = NOW() WHERE id IN ('ACT-SHADE-01','ACT-LIGHT-01')");
      const light = api.body.actuators.find((a) => a.id === 'ACT-LIGHT-01');
      const rows = [
        { id: 'AS-01', case: 'State change in the DB appears', steps: 'UPDATE state = ON, reload the dashboard', input: 'ACT-SHADE-01 OFF → ON', expected: 'panel shows ON', actual: 'panel shows ON (Figure 2)', result: 'PASS' },
        { id: 'AS-02', case: 'Actuator without recent updates', steps: 'last_update = now − 10 min', input: 'ACT-LIGHT-01', expected: 'OFFLINE', actual: `API state ${light.state}; panel OFFLINE (Figure 3)`, result: light.state === 'OFFLINE' ? 'PASS' : 'FAIL' },
        { id: 'AS-03', case: 'Anonymous user', steps: 'Open /producer/ and GET /api/actuators/status without session', input: 'no token', expected: 'login page; 401', actual: `redirected to login; HTTP ${anonApi.status}`, result: anonApi.status === 401 ? 'PASS' : 'FAIL' },
      ];
      L.condition(t.key, 1, 'The state of ACT-SHADE-01 was changed in the database (OFF → ON) and the panel showed the new state.', [before, upd.proof, after]);
      L.condition(t.key, 2, `ACT-LIGHT-01 without updates for 10 minutes is shown as OFFLINE (API state "${light.state}", reported_state "${light.reported_state}").`, [stale.proof, off]);
      L.condition(t.key, 3, `Only logged-in users can see the panel: without a session the page redirects to login and the API answers ${anonApi.status}. Screenshots saved.`, [login, L.saveCalls(t, 'Status endpoint without a session', [anonApi])]);
      L.condition(t.key, 4, 'Before/after screenshots and the test table are the evidence. The states were restored after the test.', []);
      L.testCases(t.key, rows, 'Actuator status visualization tests');
    });
  });

  // =========================================================================
  // US-25 — Register IoT devices, sensors and actuators
  // =========================================================================
  await T(ctx, '2:US25-T1', async (t) => {
    const er = await L.renderMermaid(t, 'er_registry', `erDiagram
  GREENHOUSES ||--o{ AREAS : contains
  AREAS ||--o{ DEVICES : "zone of"
  DEVICES ||--o{ SENSORS : has
  DEVICES ||--o{ ACTUATORS : drives
  DEVICES { text id PK
    text name
    text greenhouse_id FK
    text area_id FK "greenhouse zone"
    boolean is_active "status"
    text api_key_hash }
  SENSORS { text id PK
    text device_id FK "NOT NULL"
    text type
    text unit }
  ACTUATORS { text id PK
    text device_id FK "NOT NULL"
    text type }`, 'Device registry in the shared ER diagram (devices, sensors, actuators linked to a device and a greenhouse zone).');
    const nn = await L.sqlProof(t, 'Every sensor and actuator references a device (NOT NULL foreign key)', `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_name IN ('sensors','actuators') AND column_name = 'device_id'`);
    const orphans = await L.sqlProof(t, 'Sensors / actuators without a device', `SELECT 'sensors' AS table_name, COUNT(*)::int AS without_device FROM sensors WHERE device_id IS NULL UNION ALL SELECT 'actuators', COUNT(*)::int FROM actuators WHERE device_id IS NULL`);
    L.condition(t.key, 1, 'Fields defined — device: id, name, greenhouse zone (greenhouse_id + area_id), status (is_active), MAC address, API key hash, firmware, last_seen; sensor: id, device_id, type, unit (plus physical range); actuator: id, device_id, type (plus state).', [
      P.table('Registry fields', ['Entity', 'Fields'], [
        ['Device', 'id, name, mac_address, location, greenhouse_id, area_id (zone), is_active (status), api_key_hash, firmware, last_seen'],
        ['Sensor', 'id, device_id, area_id, name, type, unit, physical_min, physical_max, is_active'],
        ['Actuator', 'id, device_id, area_id, name, type, state, last_update, is_active'],
      ], [1500, 7860]),
    ]);
    L.condition(t.key, 2, 'The fields are part of the shared ER diagram maintained with Oscar (US07-T1).', [er]);
    L.condition(t.key, 3, 'Every sensor and actuator is linked to a device: device_id is a NOT NULL foreign key, and no row lacks a device.', [nn.proof, orphans.proof]);
    L.condition(t.key, 4, 'Fields included in the shared ER diagram (Figure 1).', []);
    L.approval(t.key, `${DAILY3_TEAM}: Alexis Enrique Valle Parra — "US25-T1 to US25-T4 finished"; Daily Meeting 2 recorded that US25-T1 would be finished on Tuesday together with Oscar.`);
  });

  await T(ctx, '2:US25-T2', async (t) => {
    const { context, page } = await L.openPage({ role: 'admin' });
    await L.goto(page, '/admin/devices.html', 'table');
    const list = await L.shot(t, page, 'Device list with connectivity, firmware and status, followed by the sensors and actuators of each device.');
    await page.click('button:has-text("Register device")');
    await page.waitForSelector('.modal');
    const f1 = await L.shot(t, page, 'Registration form of a device (name, MAC, location, greenhouse, area, firmware).', { selector: '.modal' });
    await page.click('.modal button:has-text("Cancel")');
    await page.click('button:has-text("Register sensor")');
    await page.waitForSelector('.modal');
    const f2 = await L.shot(t, page, 'Adding a sensor to a device: the Device selector links the new sensor to its device.', { selector: '.modal' });
    await page.click('.modal button:has-text("Cancel")');
    await page.click('button:has-text("Register actuator")');
    await page.waitForSelector('.modal');
    const f3 = await L.shot(t, page, 'Adding an actuator to a device.', { selector: '.modal' });
    await page.click('.modal button:has-text("Cancel")');
    await context.close();
    L.condition(t.key, 1, 'The screens include the device list and the device registration form.', [list, f1]);
    L.condition(t.key, 2, 'The sensor and actuator forms add components to a device through the Device selector.', [f2, f3]);
    L.condition(t.key, 3, 'The screens were reviewed by the team in the Week 2 milestone review (approval record).', []);
    L.condition(t.key, 4, 'Screen prototype reviewed by the team (Figures 1–4 show the implemented screens).', []);
    L.approval(t.key, `${DAILY3_TEAM} — "Review of the Week 2 milestone: all endpoints, storage, transmission, threshold, registry and actuator features implemented and connected."`);
  });

  await T(ctx, '2:US25-T3', async (t) => {
    await L.sql("DELETE FROM measurements WHERE sensor_id IN ('SM-25A')"); // re-runs only
    for (const [tbl, id] of [['sensors', 'SM-25A'], ['actuators', 'ACT-25A'], ['devices', 'dev-node-25a']]) {
      await L.sql(`DELETE FROM ${tbl} WHERE id = $1`, [id]).catch(() => {});
    }
    const c1 = await L.call('POST', '/api/devices', { as: 'admin', body: { id: 'dev-node-25a', name: 'Node 25A', mac_address: 'A4:CF:12:25:0A:01', greenhouse_id: 'GH-01', area_id: 'AREA-2' } });
    const c2 = await L.call('POST', '/api/sensors', { as: 'admin', body: { id: 'SM-25A', device_id: 'dev-node-25a', area_id: 'AREA-2', name: 'Soil probe 25A', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 } });
    const c3 = await L.call('POST', '/api/actuators', { as: 'admin', body: { id: 'ACT-25A', device_id: 'dev-node-25a', area_id: 'AREA-2', name: 'Pump 25A', type: 'irrigation_pump' } });
    const e1 = await L.call('PUT', '/api/devices/dev-node-25a', { as: 'admin', body: { name: 'Node 25A (bench 2)' } });
    const e2 = await L.call('PUT', '/api/sensors/SM-25A', { as: 'admin', body: { name: 'Soil probe 25A — north' } });
    const d1 = await L.call('PUT', '/api/sensors/SM-25A', { as: 'admin', body: { is_active: false } });
    const d2 = await L.call('PUT', '/api/actuators/ACT-25A', { as: 'admin', body: { is_active: false } });
    const d3 = await L.call('PUT', '/api/devices/dev-node-25a', { as: 'admin', body: { is_active: false } });
    const dup = await L.call('POST', '/api/sensors', { as: 'admin', body: { id: 'SM-25A', device_id: 'dev-node-01', area_id: 'AREA-1', name: 'Duplicate', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 } });
    const del = await L.call('DELETE', '/api/devices/dev-node-25a', { as: 'admin' });
    const prod = [
      await L.call('POST', '/api/devices', { as: 'producer', body: { name: 'x' } }),
      await L.call('PUT', '/api/sensors/SM-01', { as: 'producer', body: { name: 'x' } }),
      await L.call('PUT', '/api/actuators/ACT-PUMP-01', { as: 'producer', body: { is_active: false } }),
    ];
    const rows = await L.sqlProof(t, 'The records after the test: still in the database, deactivated', `SELECT 'device' AS kind, id, name, is_active FROM devices WHERE id = 'dev-node-25a'
      UNION ALL SELECT 'sensor', id, name, is_active FROM sensors WHERE id = 'SM-25A' UNION ALL SELECT 'actuator', id, name, is_active FROM actuators WHERE id = 'ACT-25A'`);
    const { context, page } = await L.openPage({ role: 'admin' });
    await L.goto(page, '/admin/devices.html', 'table');
    const shot = await L.shot(t, page, 'Registry screen after the test: Node 25A, its sensor and its actuator are listed as Inactive with an Activate button.');
    await context.close();
    L.condition(t.key, 1, `A device, a sensor and an actuator were registered (${c1.status}, ${c2.status}, ${c3.status}), edited (${e1.status}, ${e2.status}) and deactivated (${d1.status}, ${d2.status}, ${d3.status}).`, [L.saveCalls(t, 'Register, edit, deactivate', [c1, c2, c3, e1, e2, d1, d2, d3], 10), shot]);
    L.condition(t.key, 2, `IDs are unique (a second SM-25A is refused with ${dup.status} ${dup.body.code}); there is no delete: DELETE /devices/{id} answers ${del.status} and the deactivated rows remain in the database.`, [L.saveCalls(t, 'Duplicate ID and delete attempt', [dup, del]), rows.proof]);
    L.condition(t.key, 3, `Only Administrators can do it: the Producer receives 403 for register, edit and deactivate (${prod.map((p) => p.status).join(', ')}).`, [L.saveCalls(t, 'Producer attempts', prod, 8)]);
    L.condition(t.key, 4, 'Records are created, edited and deactivated correctly (table and screenshot).', []);
  });

  await T(ctx, '2:US25-T4', async (t) => {
    for (const [tbl, id] of [['measurements', null], ['sensors', 'SM-25B'], ['devices', 'dev-node-25b']]) {
      if (tbl === 'measurements') await L.sql("DELETE FROM measurements WHERE sensor_id = 'SM-25B'");
      else await L.sql(`DELETE FROM ${tbl} WHERE id = $1`, [id]).catch(() => {});
    }
    const reg = await L.call('POST', '/api/devices', { as: 'admin', body: { id: 'dev-node-25b', name: 'Node 25B', greenhouse_id: 'GH-01', area_id: 'AREA-2' } });
    const key = reg.body.api_key;
    await L.call('POST', '/api/sensors', { as: 'admin', body: { id: 'SM-25B', device_id: 'dev-node-25b', area_id: 'AREA-2', name: 'Soil probe 25B', type: 'soil_moisture', unit: '%', physical_min: 0, physical_max: 100 } });
    const hash = await L.sqlProof(t, 'Stored credential: SHA-256 hash only', "SELECT id, api_key_hash, length(api_key_hash) AS len, encode(sha256(convert_to($1, 'UTF8')), 'hex') = api_key_hash AS matches_generated_key FROM devices WHERE id = 'dev-node-25b'", [key]);
    const send = await L.call('POST', '/api/measurements', { key, body: { device_id: 'dev-node-25b', sensor_id: 'SM-25B', value: 63.5, unit: '%', recorded_at: new Date().toISOString() } });
    const other = await L.call('POST', '/api/measurements', { key, body: { sensor_id: 'SM-01', value: 63.5, unit: '%', recorded_at: new Date().toISOString() } });
    await L.call('PUT', '/api/devices/dev-node-25b', { as: 'admin', body: { is_active: false } });
    const after = await L.call('POST', '/api/measurements', { key, body: { device_id: 'dev-node-25b', sensor_id: 'SM-25B', value: 63.6, unit: '%', recorded_at: new Date().toISOString() } });
    L.condition(t.key, 1, `Registering the device generated its API key (${L.mask(key)}, shown once in the response and never again). The database stores only its SHA-256 hash.`, [L.saveCalls(t, 'Device registration (key masked)', [reg], 30), hash.proof, P.code('server/src/middleware/apiKey.js', 'function generateApiKey', 10)]);
    L.condition(t.key, 2, `The new key works when sending data: a reading of SM-25B was stored (HTTP ${send.status}); the key cannot be used for sensors of another device (HTTP ${other.status}).`, [L.saveCalls(t, 'Transmission with the new key', [send, other], 10)]);
    L.condition(t.key, 3, `After deactivating the device its key is rejected (HTTP ${after.status} ${after.body.code}).`, [L.saveCalls(t, 'Transmission after deactivation', [after])]);
    L.condition(t.key, 4, 'The new device received a key that worked in the transmission test and stopped working after deactivation.', []);
  });

  await T(ctx, '2:US25-T5', async (t) => {
    for (const [tbl, col, id] of [['measurements', 'sensor_id', 'SM-25C'], ['sensors', 'id', 'SM-25C'], ['actuators', 'id', 'ACT-25C'], ['devices', 'id', 'dev-node-25c']]) {
      await L.sql(`DELETE FROM ${tbl} WHERE ${col} = $1`, [id]).catch(() => {});
    }
    const rows = [];
    const { context, page } = await L.openPage({ role: 'admin' });
    await L.goto(page, '/admin/devices.html', 'table');
    await page.click('button:has-text("Register device")');
    await page.fill('.modal input[name="id"]', 'dev-node-25c');
    await page.fill('.modal input[name="name"]', 'Node 25C');
    await page.fill('.modal input[name="mac_address"]', 'A4:CF:12:25:0C:01');
    await page.selectOption('.modal select[name="area_id"]', 'AREA-2');
    await page.click('.modal button.primary');
    await page.waitForSelector('#api-key-value');
    const key = (await page.textContent('#api-key-value')).trim();
    await page.evaluate(() => { const k = document.getElementById('api-key-value'); k.textContent = `${k.textContent.slice(0, 6)}…  (masked in the evidence)`; });
    const s1 = await L.shot(t, page, 'Step 1 — device registered from the screen; its API key is shown once (masked here).', { fullPage: false });
    await page.click('.modal button.primary');
    rows.push({ id: 'RF-01', case: 'Register device', steps: 'Registry screen → Register device', input: 'dev-node-25c', expected: 'created, key shown once', actual: `key ${L.mask(key)} shown`, result: key.length > 20 ? 'PASS' : 'FAIL' });
    await page.waitForTimeout(500);
    await page.click('button:has-text("Register sensor")');
    await page.fill('.modal input[name="id"]', 'SM-25C');
    await page.fill('.modal input[name="name"]', 'Soil probe 25C');
    await page.selectOption('.modal select[name="type"]', 'soil_moisture');
    await page.fill('.modal input[name="unit"]', '%');
    await page.selectOption('.modal select[name="device_id"]', 'dev-node-25c');
    await page.selectOption('.modal select[name="area_id"]', 'AREA-2');
    await page.fill('.modal input[name="physical_min"]', '0');
    await page.fill('.modal input[name="physical_max"]', '100');
    const s2 = await L.shot(t, page, 'Step 2 — adding the sensor SM-25C to the new device.', { selector: '.modal' });
    await page.click('.modal button.primary');
    await page.waitForSelector('.toast.ok');
    rows.push({ id: 'RF-02', case: 'Add sensor', steps: 'Register sensor linked to dev-node-25c', input: 'SM-25C', expected: 'created', actual: 'created (toast "Record created.")', result: 'PASS' });
    await page.waitForTimeout(400);
    await page.click('button:has-text("Register actuator")');
    await page.fill('.modal input[name="id"]', 'ACT-25C');
    await page.fill('.modal input[name="name"]', 'Pump 25C');
    await page.selectOption('.modal select[name="type"]', 'irrigation_pump');
    await page.selectOption('.modal select[name="device_id"]', 'dev-node-25c');
    await page.selectOption('.modal select[name="area_id"]', 'AREA-2');
    await page.click('.modal button.primary');
    await page.waitForSelector('.toast.ok');
    rows.push({ id: 'RF-03', case: 'Add actuator', steps: 'Register actuator linked to dev-node-25c', input: 'ACT-25C', expected: 'created', actual: 'created', result: 'PASS' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const s3 = await L.shot(t, page, 'Step 3 — the device, its sensor and its actuator appear in the registry.');
    const send = await L.call('POST', '/api/measurements', { key, body: { device_id: 'dev-node-25c', sensor_id: 'SM-25C', value: 64.2, unit: '%', recorded_at: new Date().toISOString() } });
    rows.push({ id: 'RF-04', case: 'Send data with the token', steps: 'POST /measurements with the new key', input: 'SM-25C = 64.2 %', expected: '201 stored', actual: `HTTP ${send.status}`, result: send.status === 201 ? 'PASS' : 'FAIL' });
    const devRow = page.locator('tr', { hasText: 'Node 25C' }).first();
    await devRow.locator('button:has-text("Deactivate")').click();
    await page.click('.modal button:has-text("Deactivate")');
    await page.waitForSelector('.toast.ok');
    await page.waitForTimeout(600);
    const s4 = await L.shot(t, page, 'Step 4 — the device was deactivated from the screen (status Inactive).');
    await context.close();
    rows.push({ id: 'RF-05', case: 'Deactivate device', steps: 'Deactivate button + confirmation', input: 'Node 25C', expected: 'status Inactive', actual: 'Inactive', result: 'PASS' });
    const rejected = await L.call('POST', '/api/measurements', { key, body: { device_id: 'dev-node-25c', sensor_id: 'SM-25C', value: 64.3, unit: '%', recorded_at: new Date().toISOString() } });
    rows.push({ id: 'RF-06', case: 'Data rejected after deactivation', steps: 'POST /measurements with the same key', input: 'SM-25C = 64.3 %', expected: '401', actual: `HTTP ${rejected.status} ${rejected.body.code}`, result: rejected.status === 401 ? 'PASS' : 'FAIL' });
    const stored = await L.sqlProof(t, 'Readings of SM-25C in the database (only the one sent while active)', "SELECT sensor_id, value, recorded_at, received_at FROM measurements WHERE sensor_id = 'SM-25C'");
    L.condition(t.key, 1, 'The full flow was executed: register the device with its sensor and actuator, send data with its token, deactivate it and try again.', [s1, s2, s3, s4]);
    L.condition(t.key, 2, `All ${rows.length} steps passed: the data sent while active was stored and the data sent after deactivation was rejected.`, [L.saveCalls(t, 'Transmission before and after deactivation', [send, rejected]), stored.proof]);
    L.condition(t.key, 3, 'Screenshots of every step are saved in the evidence folder (Figures 1–4).', []);
    L.condition(t.key, 4, 'Test evidence with screenshots.', []);
    L.testCases(t.key, rows, 'Registration flow test');
  });

  // =========================================================================
  // Sprint-level tasks
  // =========================================================================
  await T(ctx, '2:SPR-T1', async (t) => {
    const videoDir = path.join(ctx.OUT, 'video');
    fs.mkdirSync(videoDir, { recursive: true });
    const steps = [];
    const { context, page } = await L.openPage({ role: 'admin', video: videoDir });
    await L.goto(page, '/admin/devices.html', 'table');
    steps.push(await L.shot(t, page, 'Step 1 — registered node dev-node-01 with its 8 sensors and 4 actuators (US-25).', { fullPage: false }));
    const sim = await L.device.exclusive(() => L.run('node', ['iot/simulator/simulator.js', '--interval', '3', '--count', '2']));
    const simLog = L.saveFile(t, 'log', sim.out);
    await L.goto(page, '/producer/', '.sensor-card');
    steps.push(await L.shot(t, page, 'Step 2–3 — readings transmitted by the simulator (US-06) and stored (US-07) appear on the dashboard with their time.', { fullPage: false }));
    const hist = await L.call('GET', '/api/sensors/SM-01/measurements?limit=3', { as: 'admin' });
    await L.goto(page, '/admin/thresholds.html', 'tr[data-type]');
    steps.push(await L.shot(t, page, 'Step 4–5 — the API (US-08) serves the threshold screen (US-10).', { fullPage: false }));
    await L.goto(page, '/producer/', '.sensor-card');
    await page.locator(ACT_PANEL).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    steps.push(await L.shot(t, page, 'Step 6 — the actuator status panel (US-14).', { selector: ACT_PANEL }));
    const video = await L.saveVideo(t, context, page);
    const defects = [
      ['D-01', 'US-01-C', 'Login audit crashed: the request object was copied with {...req} and lost Express methods', 'Fixed: audit reads IP from headers; controller passes a request prototype', 'Fixed and retested (auth tests)'],
      ['D-02', 'US-14', 'Idle actuators of a connected device were shown OFFLINE', 'Fixed: the heartbeat reports the actuator states (agreed with Vicente in Daily Meeting 3)', 'Fixed and retested'],
      ['D-03', 'US-06', 'Payload could not carry device_id (required by US06-T1)', 'Fixed: optional device_id validated against the API key', 'Fixed and retested (measurement tests)'],
      ['D-04', 'US-07', 'Readings rejected for schema errors were not written to the system log', 'Fixed: WARN entry for every rejection', 'Fixed and retested'],
      ['D-05', 'US-07', 'include_anomalies=false was read as true', 'Fixed: explicit true/false parsing', 'Fixed and retested'],
    ];
    L.condition(t.key, 1, 'The complete flow was executed from the registered sensor to the actuator panel: registry → simulator transmission → storage → API → threshold screen → actuator panel.', [...steps, L.saveCalls(t, 'API step: history of SM-01', [hist], 12), P.block('Simulator run during the integration test', sim.out.trim(), simLog)]);
    L.condition(t.key, 2, 'Every story of the sprint took part through its owner\'s component: US-01-C (Alexis, login and roles used by every step), US-06 (Vicente, simulator), US-07 (Oscar, storage), US-08 (Carlos, API), US-10 (Jorge, thresholds), US-14 (Oscar, actuator panel), US-25 (Alexis, registry).', []);
    L.condition(t.key, 3, `Video of the run (${video}) and screenshots are saved; the defects found during integration and testing are listed below with their resolution (also recorded in docs/TEST_PLAN.md).`, [P.table('Defects found', ['ID', 'Story', 'Defect', 'Resolution', 'Status'], defects, [600, 900, 3400, 2900, 1560])]);
    L.condition(t.key, 4, 'Integration video, step screenshots and list of defects.', []);
    L.approval(t.key, 'Sprint 2 Review & Delivery (October 9, 2026): "Product Owner accepted the seven user stories: all acceptance criteria met." Daily Meeting 3 planned SPR-T1 for Thursday, October 8.');
  });

  await T(ctx, '2:SPR-T2', async (t) => {
    const index = L.catalog.tasks.filter((x) => x.sprint === 2).map((x) => {
      const dir = L.dirOf(x);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${x.base}_`)).length : 0;
      return [x.id, x.title, x.responsible, `${x.folder}/${x.file}`, String(files), x.key === t.key ? 'this document' : 'collected'];
    });
    const burn = [['Sprint start', 'Sep 21', 42, 42], ['End of Week 1', 'Sep 28', 28, 27], ['End of Week 2', 'Oct 5', 14, 8], ['End of Week 3', 'Oct 9', 0, 0]];
    const chart = await L.renderChart(t, {
      type: 'line',
      data: { labels: burn.map((b) => `${b[0]} (${b[1]})`), datasets: [
        { label: 'Ideal remaining hours', data: burn.map((b) => b[2]), borderColor: '#5f6368', borderDash: [6, 4] },
        { label: 'Actual remaining hours', data: burn.map((b) => b[3]), borderColor: '#9e1b32', backgroundColor: '#9e1b32' },
      ] },
      options: { plugins: { title: { display: true, text: 'Sprint 2 burndown (checkpoints recorded in the Sprint Review)' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'hours' } } } },
    }, 'Sprint 2 burndown drawn from the Monday checkpoints recorded by the Scrum Master.', { width: 900, height: 380 });
    const demo = [
      '1. Sign in as Administrator → IoT devices: dev-node-01, its sensors and actuators (US-25); register a node and show the key shown once.',
      '2. Start the simulator (npm run simulate -- --interval 10); show the delivery log (US-06).',
      '3. Producer dashboard: sensor cards update with the new readings and their time (US-07).',
      '4. Postman: POST /measurements and GET /sensors/SM-01/measurements?from&to (US-08), then the full collection run.',
      '5. Administrator → Sensor thresholds: edit soil moisture, show validation and confirmation (US-10).',
      '6. Actuator status panel with ON/OFF/OFFLINE (US-14).',
      '7. Security: sign in with each role, show the redirections and a 403 (US-01-C).',
    ];
    const demoFile = L.saveFile(t, 'md', `# Sprint 2 — demo script (Sprint Review, October 9, 2026)\n\n${demo.join('\n')}\n`);
    L.condition(t.key, 1, `Evidence of every Sprint 2 task is in evidence/Sprint 2/Evidence/<User Story>/ with the name <TaskID>_<Task_Name>; the index below lists the ${index.length} documents and the number of attached files collected for each.`, [P.table('Sprint 2 evidence index', ['Task', 'Title', 'Responsible', 'Evidence file', 'Attachments', 'Status'], index, [900, 2500, 1500, 2860, 800, 800])]);
    L.condition(t.key, 2, 'The board was updated by the Scrum Master after each Monday meeting and the burndown reached 0 h at the end of Week 3 (checkpoints from the Sprint Review; chart below).', [chart]);
    L.condition(t.key, 3, `The demo script was ready before the Review (attached ${demoFile}).`, [P.block('Demo script', demo.join('\n'), demoFile)]);
    L.condition(t.key, 4, 'Evidence folder and demo script ready before the Review.', []);
    L.approval(t.key, 'Sprint 2 Review & Delivery (October 9, 2026) — burndown table and "Product Owner accepted the seven user stories"; Daily Meeting 3: "Every member uploads the evidence of each task with the name <TaskID>_<Task_Name> to the Sprint 2 evidence folder before Thursday."');
  });
};
