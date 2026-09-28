'use strict';

/**
 * Central configuration, read once from the environment.
 * Secrets never live in the repository (NFR-03); see .env.example.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || value === '1';
};

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const nodeEnv = process.env.NODE_ENV || 'development';

const config = {
  env: nodeEnv,
  isTest: nodeEnv === 'test',
  isProduction: nodeEnv === 'production',
  port: toInt(process.env.PORT, 3000),
  version: process.env.APP_VERSION || '1.0.0',

  db: {
    url: process.env.DATABASE_URL || 'postgresql://smartgreen:smartgreen@localhost:5432/smartgreen',
    // Managed providers (Supabase, Render, Railway) terminate TLS with a
    // certificate this pool does not need to verify locally.
    ssl: String(process.env.PGSSLMODE || 'disable').toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : false,
    maxClients: toInt(process.env.PGPOOL_MAX, 10),
  },

  auth: {
    // The server refuses to start in production without a real secret.
    jwtSecret: process.env.JWT_SECRET || 'smartgreen-development-secret-change-me',
    // Fallback only: the live session length comes from security_settings.
    jwtExpiresHours: toInt(process.env.JWT_EXPIRES_HOURS, 8),
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),
  },

  // Background engines are disabled during tests so each suite controls time.
  jobsEnabled: toBool(process.env.JOBS_ENABLED, nodeEnv !== 'test'),

  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  },

  simulator: {
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000/api',
    deviceApiKey: process.env.DEVICE_API_KEY || 'sec_iot_dev_node_01_smartgreen_team3',
  },
};

if (config.isProduction && config.auth.jwtSecret.includes('development')) {
  throw new Error('JWT_SECRET must be set to a strong random value in production.');
}

module.exports = config;
