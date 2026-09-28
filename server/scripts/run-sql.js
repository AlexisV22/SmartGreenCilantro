#!/usr/bin/env node
'use strict';

/**
 * Loads a .sql file into the configured database.
 *
 * Used by `npm run db:schema` and `npm run db:seed` so the project does not
 * depend on psql being installed on the developer machine (on a server the
 * same files are loaded with psql, see database/README.md).
 *
 *   node server/scripts/run-sql.js database/schema.sql
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node server/scripts/run-sql.js <file.sql>');
    process.exit(1);
  }

  const file = path.resolve(process.cwd(), target);
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(file, 'utf8');
  const started = Date.now();

  // The whole file runs as one implicit batch; every script in database/ is
  // idempotent, so re-running it is safe.
  await db.query(sql);

  console.log(`OK  ${path.relative(process.cwd(), file)} applied in ${Date.now() - started} ms`);
  await db.close();
}

main().catch(async (err) => {
  console.error(`FAILED  ${err.message}`);
  if (err.position) console.error(`  at character position ${err.position}`);
  if (err.detail) console.error(`  detail: ${err.detail}`);
  await db.close().catch(() => {});
  process.exit(1);
});
