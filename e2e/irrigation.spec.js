// US-15: manual irrigation from the dashboard (mode switch + confirmation + duration).
const { test, expect } = require('@playwright/test');
const { login, apiToken, deviceHeartbeat, drainCommands } = require('./helpers');

test('the producer switches to Manual and starts an irrigation', async ({ page, request }) => {
  const token = await apiToken(request, 'admin');
  const auth = { Authorization: `Bearer ${token}` };
  await request.patch('/api/areas/AREA-1/mode', { headers: auth, data: { mode: 'AUTOMATIC' } });
  await drainCommands(request);
  await deviceHeartbeat(request);

  await login(page, 'producer');
  await page.click('button:has-text("Manual")');
  await page.click('.modal button:has-text("Switch mode")');
  await expect(page.locator('.toast')).toContainText('Manual mode');

  await page.click('button:has-text("Start irrigation")');
  await page.fill('.modal input[name="duration_min"]', '2');
  await page.click('.modal button.primary');
  await expect(page.locator('.toast').last()).toContainText('Command sent');

  // The command is waiting for the device.
  const cmds = await (await request.get('/api/actuators/ACT-PUMP-01/commands', { headers: auth })).json();
  const latest = (cmds.data || cmds)[0];
  expect(latest).toMatchObject({ action: 'ON', source: 'MANUAL', status: 'PENDING' });
  expect(Number(latest.duration_min)).toBe(2);

  // The device executes it, then the pump is left OFF and the area as we found it.
  const executed = await drainCommands(request);
  expect(executed.map((c) => c.id)).toContain(latest.id);
  await deviceHeartbeat(request);
  await request.patch('/api/areas/AREA-1/mode', { headers: auth, data: { mode: 'AUTOMATIC' } });
});
