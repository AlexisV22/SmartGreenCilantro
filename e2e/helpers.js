// Shared steps for the end-to-end tests.
const { expect } = require('@playwright/test');

const USERS = {
  producer: { email: 'producer@smartgreen.ai', password: 'Producer123!', name: 'Cilantro Producer', home: /\/producer\/$/ },
  admin: { email: 'admin@smartgreen.ai', password: 'Admin123!', name: 'Greenhouse Administrator', home: /\/admin\/$/ },
  superadmin: { email: 'superadmin@smartgreen.ai', password: 'SuperAdmin123!', name: 'Platform Super Administrator', home: /\/superadmin\/$/ },
};
const DEVICE_KEY = 'sec_iot_dev_node_01_smartgreen_team3';

async function login(page, role) {
  const u = USERS[role];
  await page.goto('/');
  await page.fill('#email', u.email);
  await page.fill('#password', u.password);
  await page.click('#login-btn');
  await expect(page).toHaveURL(u.home);
  await expect(page.locator('.topbar .who')).toContainText(u.name);
}

async function apiToken(request, role) {
  const u = USERS[role];
  const res = await request.post('/api/auth/login', { data: { email: u.email, password: u.password } });
  return (await res.json()).access_token;
}

/** The device reports in, so its actuators are not OFFLINE. */
async function deviceHeartbeat(request) {
  await request.post('/api/devices/heartbeat', {
    headers: { apikey: DEVICE_KEY },
    data: { firmware: 'e2e', actuators: ['ACT-PUMP-01', 'ACT-FAN-01', 'ACT-SHADE-01', 'ACT-LIGHT-01'].map((id) => ({ id, state: 'OFF' })) },
  });
}

/** Act as the firmware: collect pending commands and confirm them. */
async function drainCommands(request) {
  const res = await request.get('/api/devices/me/commands', { headers: { apikey: DEVICE_KEY } });
  const { commands } = await res.json();
  for (const c of commands) {
    await request.post(`/api/actuators/${c.actuator_id}/state`, { headers: { apikey: DEVICE_KEY }, data: { state: c.action } });
  }
  return commands;
}

module.exports = { USERS, DEVICE_KEY, login, apiToken, deviceHeartbeat, drainCommands };
