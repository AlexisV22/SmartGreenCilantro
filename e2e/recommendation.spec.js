// US-26: the producer accepts an AI recommendation from the dashboard.
const { test, expect } = require('@playwright/test');
const { login, apiToken } = require('./helpers');

test('the producer reads the explanation and accepts the recommendation', async ({ page, request }) => {
  const token = await apiToken(request, 'admin');
  const auth = { Authorization: `Bearer ${token}` };
  // Fresh pending recommendation for AREA-1 (a forced run replaces any stale one).
  const gen = await (await request.post('/api/recommendations/generate', { headers: auth, data: { area_id: 'AREA-1', force: true } })).json();
  const rec = gen[0].recommendation;

  await login(page, 'producer');
  const card = page.locator('article.rec').first();
  await expect(card).toBeVisible();
  for (const label of ['Recommendation', 'Reason', 'Relevant measurements', 'Confidence', 'Timestamp']) {
    await expect(card.locator('dt', { hasText: label })).toBeVisible();
  }
  await card.locator('summary').click();
  await expect(card.locator('details.why')).toContainText('score');

  await card.locator('button:has-text("Accept")').click();
  await page.fill('.modal textarea[name="comment"]', 'Accepted from the e2e test');
  await page.click('.modal button.primary');
  await expect(page.locator('.toast').last()).toContainText('accepted');

  const after = await (await request.get(`/api/recommendations/${rec.id}`, { headers: auth })).json();
  expect(after.status).toBe('ACCEPTED');
  expect(after.decision_comment).toBe('Accepted from the e2e test');
});
