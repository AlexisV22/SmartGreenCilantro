// US-09 / NFR-01: the integrated dashboard loads in under 3 seconds with 30 days of data.
const { test, expect } = require('@playwright/test');
const { login, deviceHeartbeat } = require('./helpers');

test('dashboard with 30 days of history loads in < 3 s', async ({ page, request }) => {
  await deviceHeartbeat(request);
  await login(page, 'producer');

  const started = Date.now();
  await page.goto('/producer/');
  await expect(page.locator('.sensor-card').first()).toBeVisible();
  await expect(page.locator('#history-chart')).toBeVisible();
  const firstLoad = Date.now() - started;

  const t30 = Date.now();
  await page.click('button[data-p="30d"]');
  await expect(page.locator('.chart-box + p')).toContainText('readings');
  const thirtyDays = Date.now() - t30;

  console.log(`dashboard ${firstLoad} ms · 30-day chart ${thirtyDays} ms`);
  expect(firstLoad).toBeLessThan(3000);
  expect(thirtyDays).toBeLessThan(3000);

  // status shown with colour + text + icon (NFR-06)
  await expect(page.locator('.sensor-card .badge').first()).toHaveText(/In range|Below range|Above range/);
  await expect(page.locator('#alerts-panel')).toBeVisible();
});
