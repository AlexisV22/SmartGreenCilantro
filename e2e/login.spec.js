// US-01-C: login per role, generic error, route guards and logout.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

for (const role of ['producer', 'admin', 'superadmin']) {
  test(`${role} signs in and lands on its home page`, async ({ page }) => {
    await login(page, role);
    await expect(page.locator('h1')).toBeVisible();
  });
}

test('wrong credentials show a generic error and stay on the login page', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'producer@smartgreen.ai');
  await page.fill('#password', 'wrong-password');
  await page.click('#login-btn');
  await expect(page.locator('#login-msg')).toContainText(/invalid|incorrect/i);
  await expect(page).toHaveURL(/\/$/);
});

test('direct URL without a session redirects to the login page', async ({ page }) => {
  await page.goto('/producer/', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/\?next=/);
});

test('a producer opening an administrator page is sent back to its home', async ({ page }) => {
  await login(page, 'producer');
  await page.goto('/admin/users.html');
  await expect(page).toHaveURL(/\/producer\/\?denied=1/);
  await expect(page.locator('.banner.warn')).toContainText('do not have permission');
});

test('logout ends the session', async ({ page }) => {
  await login(page, 'admin');
  await page.click('text=Logout');
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('#login-form')).toBeVisible();
  // The guard redirects while the page loads, so wait for the commit only.
  await page.goto('/admin/', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/\?next=/);
});
