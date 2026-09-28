// Playwright end-to-end tests (npm run test:e2e).
// Starts the API on port 3100 with the background jobs disabled, against the
// development database (load the seed and `npm run seed:history` first so the
// dashboard has 30 days of data for the NFR-01 check).
// PLAYWRIGHT_CHROMIUM_PATH lets you use an already installed Chromium when the
// Playwright CDN cannot be reached.

const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 3100);

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node server/src/server.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 60000,
    env: { PORT: String(PORT), JOBS_ENABLED: 'false', NODE_ENV: 'development' },
  },
});
