'use strict';

// Runs in every test worker before the test file: point the application at
// the isolated test database created by globalSetup and disable the cron jobs.
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

process.env.NODE_ENV = 'test';
process.env.JOBS_ENABLED = 'false';
if (!process.env.TEST_DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://smartgreen:smartgreen@localhost:5432/smartgreen');
  url.pathname = '/smartgreen_test';
  process.env.TEST_DATABASE_URL = url.toString();
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
