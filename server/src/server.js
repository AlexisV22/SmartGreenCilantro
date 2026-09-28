'use strict';

/**
 * Process entry point: starts the HTTP server and the background engines.
 *
 *   npm run dev     development, with file watching
 *   npm start       production
 */

const app = require('./app');
const config = require('./config');
const db = require('./db');
const { logSystem } = require('./utils/logger');

const DEFAULT_SECRETS = ['smartgreen-development-secret-change-me', 'change-me-in-production-use-a-long-random-string'];

async function main() {
  // NFR-03: never sign production sessions with a known or weak secret.
  if (config.isProduction && (DEFAULT_SECRETS.includes(config.auth.jwtSecret) || config.auth.jwtSecret.length < 32)) {
    // eslint-disable-next-line no-console
    console.error('[server] JWT_SECRET must be a random string of at least 32 characters in production (see docs/DEPLOYMENT.md).');
    process.exit(1);
  }

  const connected = await db.isHealthy();
  if (!connected) {
    // eslint-disable-next-line no-console
    console.error('[server] cannot reach the database. Check DATABASE_URL, or run: npm run db:up');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`SmartGreenAI: Cilantro Crop v${config.version}`);
    // eslint-disable-next-line no-console
    console.log(`  API       http://localhost:${config.port}/api`);
    // eslint-disable-next-line no-console
    console.log(`  Dashboard http://localhost:${config.port}/`);
    // eslint-disable-next-line no-console
    console.log(`  Jobs      ${config.jobsEnabled ? 'enabled' : 'disabled'}`);
    logSystem('INFO', 'server', `Server started on port ${config.port} (${config.env}).`);
  });

  if (config.jobsEnabled) {
    require('./jobs').start();
  }

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`\n[server] ${signal} received, shutting down.`);
    if (config.jobsEnabled) require('./jobs').stop();
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    // Do not wait forever for lingering connections.
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
