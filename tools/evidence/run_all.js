#!/usr/bin/env node
'use strict';

/**
 * Collects the evidence of Sprints 2-4 from the running system and builds the
 * documents.
 *
 *   node tools/evidence/run_all.js                 # clean DB, all sprints, build, check
 *   node tools/evidence/run_all.js 3               # only Sprint 3 (keeps the DB)
 *   node tools/evidence/run_all.js 2 --reset       # clean DB, only Sprint 2
 *   node tools/evidence/run_all.js --only 2:US01C-T1   # one task (debugging)
 *   node tools/evidence/run_all.js --only 3:US11-T6,3:US11-T8   # several tasks, in this order
 *
 * Steps: (1) clean database + schema + seed + 30 days of history, output kept
 * for US07-T2; (2) API server with its background jobs, log kept; (3) device
 * emulator; (4) the collectors of each sprint; (5) build_docs + check_evidence.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const L = require('./lib');

const args = process.argv.slice(2);
const sprints = args.filter((a) => /^[234]$/.test(a)).map(Number);
const onlyKeys = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').filter(Boolean) : null;
const only = onlyKeys ? onlyKeys[0] : null;
const all = !sprints.length && !only;
const reset = all || args.includes('--reset');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = [...new Set(out.split('\n').filter((l) => /LISTENING/.test(l)).map((l) => l.trim().split(/\s+/).pop()))];
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`);
  } catch { /* nothing listening */ }
}

async function prepareDatabase() {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const env = {};
  for (const [name, script] of [['schema', 'db:schema'], ['seed', 'db:seed'], ['history', 'seed:history']]) {
    const r = await L.run('npm', ['run', script]);
    env[name] = r;
    fs.writeFileSync(path.join(OUT, `db_${name}.txt`), `$ npm run ${script}\n(${new Date().toISOString()}, clean database)\n\n${r.out}\nexit code ${r.code}\n`);
    if (r.code !== 0) throw new Error(`${script} failed:\n${r.out}`);
    console.log(`  ${script}: ${r.out.trim().split('\n').pop()}`);
  }
  return env;
}

let server;
async function startServer() {
  killPort(3000);
  const log = fs.createWriteStream(path.join(OUT, 'server.log'), { flags: 'a' });
  server = spawn('node', ['server/src/server.js'], { cwd: L.ROOT, env: { ...process.env, PORT: '3000', JOBS_ENABLED: 'true', NODE_ENV: 'development' } });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${L.BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await L.sleep(500);
  }
  throw new Error('the API server did not start');
}

async function main() {
  const started = Date.now();
  if (reset) {
    console.log('» preparing a clean database');
    await prepareDatabase();
  }
  console.log('» starting the API server (background jobs enabled)');
  await startServer();
  await L.device.cycle({ hold: true });
  L.device.start(30000);

  const todo = onlyKeys ? [...new Set(onlyKeys.map((k) => Number(k.split(':')[0])))] : (sprints.length ? sprints : [2, 3, 4]);
  for (const s of todo) {
    console.log(`» Sprint ${s}`);
    const collector = require(`./collect_sprint${s}`);
    if (onlyKeys) {
      for (const key of onlyKeys.filter((k) => k.startsWith(`${s}:`))) await collector({ only: key, OUT });
    } else {
      await collector({ only, OUT });
    }
    L.saveManifest(`sprint${s}`);
  }

  await L.close();
  server.kill();
  console.log('» building documents');
  console.log((await L.run('node', ['tools/evidence/build_docs.js', ...(onlyKeys || [])])).out.trim());
  if (!only) console.log((await L.run('node', ['tools/evidence/check_evidence.js'])).out.trim());
  console.log(`done in ${Math.round((Date.now() - started) / 60000)} min`);
}

main().catch(async (e) => {
  console.error(e);
  try { await L.close(); } catch { /* ignore */ }
  if (server) server.kill();
  process.exit(1);
});
