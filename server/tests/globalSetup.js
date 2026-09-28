'use strict';

/**
 * Jest global setup: creates an isolated `smartgreen_test` database (or uses
 * TEST_DATABASE_URL) and loads the complete schema and seed into it, so the
 * suite never touches development data.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function testUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL || 'postgresql://smartgreen:smartgreen@localhost:5432/smartgreen');
  url.pathname = '/smartgreen_test';
  return url.toString();
}

module.exports = async () => {
  const target = testUrl();
  process.env.TEST_DATABASE_URL = target;

  {
    // Create the database when it does not exist yet (needs CREATEDB, which the docker user has).
    const admin = new URL(target);
    admin.pathname = '/postgres';
    const client = new Client({ connectionString: admin.toString() });
    await client.connect();
    const dbName = new URL(target).pathname.slice(1);
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
    await client.end();
  }

  const client = new Client({ connectionString: target });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.query(fs.readFileSync(path.resolve(__dirname, '../../database/schema.sql'), 'utf8'));
  await client.query(fs.readFileSync(path.resolve(__dirname, '../../database/seed.sql'), 'utf8'));
  await client.end();
};
