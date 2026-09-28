// Platform availability for the Super Administrator (NFR-02): health, uptime,
// database status and active devices, refreshed every 30 s.

import { get } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, badge, fmtNum, fmtDay, fmtDate, showError, every } from '../ui.js';
import { barChart } from '../charts.js';

const { main } = await boot({
  roles: ['SuperAdministrator'], active: 'sa-home', title: 'Platform availability',
  subtitle: 'Health of the API, the database and the connected IoT devices.',
});

const kpis = h('div', { class: 'grid cols-4' });
const canvas = h('canvas', { 'aria-label': 'Measurements per day' });
const latency = h('p', { class: 'small muted' });
main.append(kpis,
  h('section', { class: 'card', style: { marginTop: '1rem' } }, h('h2', {}, '📊 Data ingestion (last 30 days)'), h('div', { class: 'chart-box sm' }, canvas), latency));

async function load() {
  try {
    const t0 = performance.now();
    const health = await get('/health');
    const apiMs = Math.round(performance.now() - t0);
    const stats = await get('/stats');
    const kpi = (label, value, note) => h('div', { class: 'card kpi' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value), note ? h('span', { class: 'small muted' }, note) : null);
    clear(kpis,
      kpi('API status', health.status === 'ok' ? badge('ok', 'Operational') : badge('danger', 'Degraded'), `v${health.version} · ${health.environment} · ${apiMs} ms response`),
      kpi('Database', health.database.connected ? badge('ok', 'Connected') : badge('danger', 'Disconnected'), `${fmtNum(stats.counts.measurements, 0)} measurements stored`),
      kpi('Uptime', `${fmtNum(health.uptime_seconds / 3600)} h`, `since ${fmtDate(Date.now() - health.uptime_seconds * 1000)}`),
      kpi('Active devices', `${health.devices.online} / ${health.devices.active} online`, `${stats.counts.organizations} organizations · ${stats.counts.active_users} active users`));
    const days = stats.measurements_per_day.slice(-30);
    barChart(canvas, { labels: days.map((d) => fmtDay(d.day)), datasets: [{ label: 'Measurements', data: days.map((d) => d.measurements), color: '#9e1b32' }] });
    latency.textContent = `Checked ${new Date().toLocaleTimeString()} · health endpoint answered in ${apiMs} ms (target for dashboard operations: 3 s, NFR-01).`;
  } catch (err) { showError(err); }
}
load();
every(30000, load);
