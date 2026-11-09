'use strict';

/**
 * Shared helpers for the evidence collectors.
 *
 * Every artefact comes from the running system: HTTP calls against the API,
 * SQL queries against the database, screenshots and videos of the real web
 * application (Playwright), runs of the simulator and of the test suites.
 * Tokens and API keys are masked (first 6 characters) before being saved.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'evidence');
const MANIFESTS = path.join(__dirname, 'manifests');
const BASE = process.env.EVIDENCE_BASE_URL || 'http://localhost:3000';
const DEVICE_KEY = process.env.DEVICE_API_KEY || 'sec_iot_dev_node_01_smartgreen_team3';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || 'C:/Users/velez/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';

const catalog = require('./catalog.json');

// ---------------------------------------------------------------------------
// Tasks, folders and attachment names
// ---------------------------------------------------------------------------
function task(key) {
  const t = catalog.tasks.find((x) => x.key === key || (x.id === key && !key.startsWith('SPR')));
  if (!t) throw new Error(`Unknown task ${key}`);
  return t;
}
const dirOf = (t) => path.join(EVIDENCE, `Sprint ${t.sprint}`, 'Evidence', t.folder);

const counters = {};
const manifest = {};

/** Start collecting a task: clear its previous attachments and its manifest entry. */
function begin(key) {
  const t = task(key);
  fs.mkdirSync(dirOf(t), { recursive: true });
  for (const f of fs.readdirSync(dirOf(t))) {
    if (f.startsWith(`${t.base}_`) && !f.endsWith('.docx')) fs.unlinkSync(path.join(dirOf(t), f));
  }
  counters[t.key] = 0;
  manifest[t.key] = { key: t.key, collectedAt: new Date().toISOString(), conditions: [], sections: [], testCases: null, notes: [] };
  return t;
}

function attachName(t, ext) {
  counters[t.key] = (counters[t.key] || 0) + 1;
  return `${t.base}_${counters[t.key]}.${ext}`;
}

function saveFile(t, ext, content) {
  const name = attachName(t, ext);
  fs.writeFileSync(path.join(dirOf(t), name), content);
  return name;
}

function copyFile(t, src, ext) {
  const name = attachName(t, ext || path.extname(src).slice(1));
  fs.copyFileSync(src, path.join(dirOf(t), name));
  return name;
}

// ---------------------------------------------------------------------------
// Proof objects (rendered by build_docs.js)
// ---------------------------------------------------------------------------
const proof = {
  heading: (content, level = 2) => ({ type: 'heading', content, level }),
  img: (file, caption) => ({ type: 'image', file, caption }),
  text: (content) => ({ type: 'text', content }),
  list: (items) => ({ type: 'list', items }),
  // table(title, columns, rows, [note], [widths]) — widths may also be given as the 4th argument.
  table: (title, columns, rows, note, widths) => (Array.isArray(note)
    ? { type: 'table', title, columns, rows, widths: note }
    : { type: 'table', title, columns, rows, note, widths }),
  block: (title, content, file) => ({ type: 'block', title, content, file }),
  code(relPath, startPattern, maxLines = 30, endPattern = null) {
    const lines = fs.readFileSync(path.join(ROOT, relPath), 'utf8').split('\n');
    let start = 0;
    if (startPattern) {
      start = lines.findIndex((l) => (startPattern instanceof RegExp ? startPattern.test(l) : l.includes(startPattern)));
      if (start < 0) throw new Error(`Pattern ${startPattern} not found in ${relPath}`);
    }
    let end = Math.min(lines.length, start + maxLines);
    if (endPattern) {
      const e = lines.findIndex((l, i) => i > start && (endPattern instanceof RegExp ? endPattern.test(l) : l.includes(endPattern)));
      if (e > 0) end = Math.min(e + 1, start + maxLines);
    }
    return { type: 'code', path: relPath.replace(/\\/g, '/'), startLine: start + 1, endLine: end, content: lines.slice(start, end).join('\n') };
  },
};

/**
 * Register one completion condition. `index` is 1-based and must follow the
 * order of the planning; `how` is the verification paragraph.
 */
function condition(key, index, how, proofs = [], opts = {}) {
  const t = task(key);
  const m = manifest[t.key];
  // pending: the condition needs something only the team can provide (a real
  // person's reading, a signature…). It is never faked: the document shows it
  // as pending and check_evidence.js reports it.
  m.conditions[index - 1] = { index, text: t.conditions[index - 1], how, proofs: proofs.filter(Boolean), pending: opts.pending || null };
}

function approval(key, text) { manifest[task(key).key].approval = text; }
function meta(key, values) { Object.assign(manifest[task(key).key], values); }

/** Extra section rendered before the conditions (design content, manual chapters…). */
function section(key, title, proofs, level = 2) {
  manifest[task(key).key].sections.push({ title, level, proofs: proofs.filter(Boolean) });
}

/** Test case table: rows of { id, case, steps, input, expected, actual, result }. */
function testCases(key, rows, title = 'Test cases (real executions)') {
  manifest[task(key).key].testCases = { title, rows };
}

function note(key, text) { manifest[task(key).key].notes.push(text); }

function saveManifest(name) {
  fs.mkdirSync(MANIFESTS, { recursive: true });
  const file = path.join(MANIFESTS, `${name}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...manifest }, null, 2));
  return file;
}

// ---------------------------------------------------------------------------
// HTTP (API) with masking
// ---------------------------------------------------------------------------
const mask = (s) => (s && s.length > 6 ? `${s.slice(0, 6)}…` : s);
const USERS = {
  producer: ['producer@smartgreen.ai', 'Producer123!'],
  admin: ['admin@smartgreen.ai', 'Admin123!'],
  superadmin: ['superadmin@smartgreen.ai', 'SuperAdmin123!'],
};
const tokens = {};

async function login(role) {
  if (tokens[role]) return tokens[role];
  const [email, password] = USERS[role];
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${role}: ${JSON.stringify(body)}`);
  tokens[role] = body.access_token;
  return tokens[role];
}

/**
 * call('POST', '/api/measurements', { as: 'device'|'producer'|'admin'|'superadmin'|null, body, token, key })
 * returns { method, url, status, body, ms, request: { headers, body } }
 */
async function call(method, url, opts = {}) {
  const headers = { Accept: 'application/json' };
  const shown = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.as === 'device' || opts.key) {
    headers.apikey = opts.key || DEVICE_KEY;
    shown.apikey = mask(headers.apikey);
  } else if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
    shown.Authorization = `Bearer ${mask(opts.token)}`;
  } else if (opts.as) {
    const tk = await login(opts.as);
    headers.Authorization = `Bearer ${tk}`;
    shown.Authorization = `Bearer ${mask(tk)}`;
  }
  if (opts.headers) Object.assign(headers, opts.headers);
  const started = Date.now();
  const res = await fetch(`${BASE}${url}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const ms = Date.now() - started;
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* csv / html */ }
  return { method, url, status: res.status, statusText: res.statusText, body, ms, contentType: res.headers.get('content-type'), request: { headers: shown, body: opts.body } };
}

function redact(value) {
  const s = JSON.stringify(value, (k, v) => {
    if (typeof v === 'string' && (k === 'access_token' || k === 'api_key')) return mask(v);
    if (typeof v === 'string' && k === 'password') return '********';
    return v;
  }, 2);
  return s;
}

function formatCall(c, maxLines = 40) {
  const head = [`${c.method} ${c.url}`, ...Object.entries(c.request.headers).map(([k, v]) => `${k}: ${v}`)];
  if (c.request.body !== undefined) head.push('', redact(c.request.body));
  const resp = typeof c.body === 'string' ? c.body : redact(c.body);
  let respLines = resp.split('\n');
  if (respLines.length > maxLines) respLines = [...respLines.slice(0, maxLines), `… (${respLines.length - maxLines} more lines in the attached file)`];
  return `${head.join('\n')}\n\n→ HTTP ${c.status} ${c.statusText} (${c.ms} ms)\n${respLines.join('\n')}`;
}

/** Save a list of calls as one .txt attachment and return a block proof. */
function saveCalls(t, title, calls, maxLines = 25) {
  const full = calls.map((c) => formatCall(c, 100000)).join('\n\n' + '-'.repeat(70) + '\n\n');
  const file = saveFile(t, 'txt', `${title}\nCaptured ${new Date().toISOString()} against ${BASE}\n\n${full}\n`);
  return proof.block(title, calls.map((c) => formatCall(c, maxLines)).join('\n\n'), file);
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
let pg;
async function sql(text, params) {
  if (!pg) {
    pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query("SET timezone = 'UTC'");
  }
  return (await pg.query(text, params)).rows;
}

function cell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Run a query, save it as CSV (+ the SQL), return a table proof (first `show` rows). */
async function sqlProof(t, title, text, params = [], show = 15) {
  if (!pg) await sql('SELECT 1');
  const result = await pg.query(text, params);
  const rows = result.rows;
  // Zero rows can be the evidence (for example "no duplicates"): keep the header.
  const columns = result.fields.map((f) => f.name);
  const csv = [columns.join(','), ...rows.map((r) => columns.map((c) => {
    const v = cell(r[c]);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))].join('\n');
  const file = saveFile(t, 'csv', csv);
  saveFile(t, 'sql', `-- ${title}\n${text.trim()}\n`);
  const shown = rows.slice(0, show).map((r) => columns.map((c) => {
    const v = cell(r[c]);
    return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  }));
  const extra = rows.length > show ? ` (first ${show} of ${rows.length} rows; complete result in ${file})` : ` (${rows.length} rows; ${file})`;
  if (!rows.length) shown.push(columns.map((c, i) => (i === 0 ? '(no rows)' : '')));
  return { proof: proof.table(`${title}${extra}`, columns, shown, `SQL: ${text.trim().replace(/\s+/g, ' ')}`), rows, file };
}

// ---------------------------------------------------------------------------
// Browser (Playwright)
// ---------------------------------------------------------------------------
let browserPromise;
function browser() {
  if (!browserPromise) {
    const { chromium } = require('@playwright/test');
    browserPromise = chromium.launch(fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
  }
  return browserPromise;
}

/**
 * Open a page. role: sign in through the API and inject the session (fast), or
 * `uiLogin: true` to use the real login form. phone: 390x844 viewport.
 * video: directory to record a .webm.
 */
async function openPage({ role = null, phone = false, video = null, uiLogin = false } = {}) {
  const b = await browser();
  const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await b.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
    recordVideo: video ? { dir: video, size: viewport } : undefined,
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  if (role && !uiLogin) {
    const tk = await login(role);
    const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json();
    await context.addInitScript(([token, user]) => {
      localStorage.setItem('sg_token', token);
      localStorage.setItem('sg_user', JSON.stringify(user));
    }, [tk, { id: me.id, email: me.email, role: me.role, full_name: me.full_name, organization_id: me.organization_id }]);
  }
  if (role && uiLogin) await uiSignIn(page, role);
  return { context, page };
}

async function uiSignIn(page, role) {
  await page.goto(`${BASE}/`);
  await page.fill('#email', USERS[role][0]);
  await page.fill('#password', USERS[role][1]);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/') || u.pathname.length > 1), page.click('#login-btn')]);
}

async function goto(page, url, waitFor = null) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 });
  await page.waitForTimeout(500);
}

/** Screenshot → attachment + image proof. */
async function shot(t, page, caption, { fullPage = true, selector = null } = {}) {
  const name = attachName(t, 'png');
  const file = path.join(dirOf(t), name);
  if (selector) await page.locator(selector).first().screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage });
  return proof.img(name, caption);
}

/** Finish a video context and move the .webm to the task folder. */
async function saveVideo(t, context, page) {
  const video = page.video();
  await context.close();
  const src = await video.path();
  const name = attachName(t, 'webm');
  fs.renameSync(src, path.join(dirOf(t), name));
  return name;
}

// ---------------------------------------------------------------------------
// Diagrams (Mermaid) and charts (Chart.js), rendered in the local Chromium
// ---------------------------------------------------------------------------
async function renderMermaid(t, name, source, caption, width = 1400) {
  const dir = path.join(__dirname, 'diagrams');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.mmd`), source);
  const b = await browser();
  const page = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0;background:#fff;font-family:Arial"><div id="out"></div></body></html>`);
  await page.addScriptTag({ path: path.join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js') });
  const ok = await page.evaluate(async (src) => {
    window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', fontFamily: 'Arial', flowchart: { htmlLabels: true } });
    const { svg } = await window.mermaid.render('d', src);
    document.getElementById('out').innerHTML = svg;
    return true;
  }, source);
  if (!ok) throw new Error(`mermaid ${name} failed`);
  const png = attachName(t, 'png');
  await page.locator('#out svg').screenshot({ path: path.join(dirOf(t), png) });
  fs.copyFileSync(path.join(dirOf(t), png), path.join(dir, `${name}.png`));
  await page.close();
  return proof.img(png, caption);
}

async function renderChart(t, config, caption, { width = 1100, height = 480 } = {}) {
  const b = await browser();
  const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0;background:#fff"><canvas id="c" width="${width}" height="${height}"></canvas></body></html>`);
  await page.addScriptTag({ path: path.join(ROOT, 'public/vendor/chart.umd.min.js') });
  await page.evaluate((cfg) => {
    cfg.options = { ...(cfg.options || {}), animation: false, responsive: false };
    // eslint-disable-next-line no-new
    new window.Chart(document.getElementById('c'), cfg);
  }, config);
  await page.waitForTimeout(300);
  const png = attachName(t, 'png');
  await page.locator('#c').screenshot({ path: path.join(dirOf(t), png) });
  await page.close();
  return proof.img(png, caption);
}

// ---------------------------------------------------------------------------
// Processes (simulator, test suites)
// ---------------------------------------------------------------------------
function run(cmd, args, { env = {}, timeout = 600000 } = {}) {
  return new Promise((resolve) => {
    // On Windows npm/npx are .cmd files and need a shell; quote every argument
    // with spaces or special characters (folder names such as "01 Auth (US-01-C)").
    const shell = process.platform === 'win32';
    const quoted = shell ? args.map((a) => (/[\s()&|<>^"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
    const child = spawn(cmd, quoted, { cwd: ROOT, env: { ...process.env, ...env }, shell });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/\x1b\[[0-9;]*m/g, '') }); });
  });
}

// ---------------------------------------------------------------------------
// Device emulator: keeps dev-node-01 alive between scenarios like the firmware
// ---------------------------------------------------------------------------
const device = {
  paused: 0,
  timer: null,
  running: new Map(), // actuator -> off timeout
  async cycle({ hold = true } = {}) {
    // Heartbeat with the current states of the actuators.
    const acts = (await call('GET', '/api/actuators', { as: 'admin' })).body;
    await call('POST', '/api/devices/heartbeat', {
      as: 'device',
      body: { firmware: 'esp32-smartgreen-1.0.0', actuators: acts.filter((a) => a.device_id === 'dev-node-01').map((a) => ({ id: a.id, state: a.reported_state === 'ON' ? 'ON' : 'OFF' })) },
    });
    if (hold) {
      // Repeat the latest value of every sensor with a tiny noise: the node keeps
      // reporting without changing the situation built by the scenario.
      const latest = (await call('GET', '/api/measurements/latest', { as: 'admin' })).body.filter((m) => m.device_id === 'dev-node-01' && m.is_active);
      const now = new Date().toISOString();
      const batch = latest.map((m) => {
        const noise = (Math.random() - 0.5) * (m.sensor_type === 'light' ? 200 : m.sensor_type === 'co2' ? 6 : m.sensor_type === 'ph' ? 0.02 : 0.3);
        const v = Number(m.value) + noise;
        const clamped = Math.min(Number(m.physical_max), Math.max(Number(m.physical_min), v));
        return { sensor_id: m.sensor_id, value: Math.round(clamped * 100) / 100, unit: m.unit, recorded_at: now };
      }).filter((r) => !Number.isNaN(r.value));
      if (batch.length) await call('POST', '/api/measurements', { as: 'device', body: batch });
    }
  },
  /** Execute pending commands like the firmware (poll → switch → report, auto-off). */
  async execute() {
    const res = await call('GET', '/api/devices/me/commands', { as: 'device' });
    for (const c of res.body.commands || []) {
      await call('POST', `/api/actuators/${c.actuator_id}/state`, { as: 'device', body: { state: c.action, duration_min: c.duration_min ? Number(c.duration_min) : undefined } });
      if (c.action === 'ON' && c.duration_min) {
        clearTimeout(this.running.get(c.actuator_id));
        this.running.set(c.actuator_id, setTimeout(() => {
          call('POST', `/api/actuators/${c.actuator_id}/state`, { as: 'device', body: { state: 'OFF' } }).catch(() => {});
        }, Number(c.duration_min) * 60000));
      }
    }
    return res.body.commands || [];
  },
  start(intervalMs = 30000) {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      if (this.paused) return;
      try { await this.execute(); await this.cycle(); } catch (e) { console.error('[device]', e.message); }
    }, intervalMs);
  },
  stop() { clearInterval(this.timer); this.timer = null; for (const t of this.running.values()) clearTimeout(t); },
  /** Run fn with the emulator paused (scenarios that control the readings or the commands). */
  async exclusive(fn) {
    this.paused += 1;
    try { return await fn(); } finally { this.paused -= 1; }
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An expected observation is missing: fail the task instead of writing an unsupported ✓. */
function must(value, message) {
  if (!value) throw new Error(`Expected observation missing: ${message}`);
  return value;
}

/**
 * Convert a Markdown document of the repository into proofs (headings,
 * paragraphs, lists, tables, code blocks; Mermaid blocks rendered as images).
 */
async function markdownProofs(t, relPath, { shiftHeadings = 0, skipTitle = true } = {}) {
  const md = fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r/g, '');
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  let para = [];
  let n = 0;
  const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const flush = () => { if (para.length) { out.push(proof.text(clean(para.join(' ')))); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^(#{1,4}) (.+)/);
    if (h) {
      flush();
      if (!(skipTitle && h[1].length === 1)) out.push(proof.heading(clean(h[2]), Math.min(3, Math.max(2, h[1].length + shiftHeadings))));
      i += 1; continue;
    }
    if (line.startsWith('```')) {
      flush();
      const lang = line.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i += 1; }
      i += 1;
      if (lang === 'mermaid') {
        n += 1;
        out.push(await renderMermaid(t, `${path.basename(relPath, '.md').toLowerCase()}_${n}`, body.join('\n'), `Diagram ${n} of ${relPath}`));
      } else out.push(proof.block(lang ? `${lang}` : '', body.join('\n')));
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i += 1; }
      const cells = rows.filter((r) => !/^\|[\s:-|]+\|$/.test(r)).map((r) => r.slice(1, -1).split(' | ').map((c) => clean(c.trim())));
      if (cells.length) out.push(proof.table('', cells[0], cells.slice(1)));
      continue;
    }
    if (/^\s*([-*]|\d+\.) /.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) { items.push(clean(lines[i].replace(/^\s*([-*]|\d+\.) /, ''))); i += 1; }
      out.push(proof.list(items));
      continue;
    }
    if (line.startsWith('>')) { para.push(line.replace(/^>\s?/, '')); i += 1; continue; }
    if (!line.trim()) { flush(); i += 1; continue; }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return out;
}

async function close() {
  device.stop();
  if (browserPromise) await (await browserPromise).close();
  if (pg) await pg.end();
}

module.exports = {
  ROOT, EVIDENCE, BASE, DEVICE_KEY, catalog, task, dirOf, begin, attachName, saveFile, copyFile,
  proof, condition, approval, meta, section, testCases, note, saveManifest,
  login, call, formatCall, saveCalls, mask, sql, sqlProof,
  openPage, uiSignIn, goto, shot, saveVideo, renderMermaid, renderChart, run, device, sleep, must, close, markdownProofs,
};
