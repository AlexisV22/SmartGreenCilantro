// Administrator overview: system statistics and device connectivity (FR-11, US-27).

import { get, post } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, table, fmtAgo, fmtDate, fmtDay, fmtNum, connectivityBadge, activeBadge, showError, toast, every } from '../ui.js';
import { barChart } from '../charts.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'admin-home', title: 'Overview & connectivity',
  subtitle: 'Operational statistics of the platform and the connection status of every IoT device.',
});

const kpis = h('div', { class: 'grid cols-4' });
const devicesSlot = h('div');
const perDay = h('canvas', { 'aria-label': 'Measurements per day' });
const bySeverity = h('div');
main.append(
  kpis,
  h('section', { class: 'card', style: { marginTop: '1rem' } }, h('div', { class: 'card-head' }, h('h2', {}, '📡 Device connectivity'),
    h('span', { class: 'small muted' }, 'A device is offline after 5 minutes without contact.')), devicesSlot),
  h('div', { class: 'grid cols-2', style: { marginTop: '1rem' } },
    h('section', { class: 'card' }, h('h2', {}, '📊 Measurements received per day'), h('div', { class: 'chart-box sm' }, perDay)),
    h('section', { class: 'card' }, h('h2', {}, '🔔 Alerts and recommendations'), bySeverity)));

async function load() {
  try {
    const [stats, devices] = await Promise.all([get('/stats'), get('/devices')]);
    const c = stats.counts;
    const kpi = (label, value, note) => h('div', { class: 'card kpi' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value), note ? h('span', { class: 'small muted' }, note) : null);
    clear(kpis,
      kpi('Devices online', `${c.online_devices} / ${c.active_devices}`, `${c.active_sensors} sensors · ${c.active_actuators} actuators`),
      kpi('Measurements stored', fmtNum(c.measurements, 0), `${c.anomalies_24h} anomalies in the last 24 h`),
      kpi('Open alerts', String(c.open_alerts), `${c.pending_recommendations} recommendations pending`),
      kpi('Structure', `${c.greenhouses} GH · ${c.areas} areas`, `${c.active_users} active users · uptime ${fmtNum(stats.uptime_seconds / 3600)} h`));

    clear(devicesSlot, table([
      { label: 'Device', render: (d) => h('div', {}, h('strong', {}, d.name), h('div', { class: 'small muted mono' }, d.id)) },
      { label: 'Connectivity', render: (d) => (d.is_active ? connectivityBadge(d.connectivity) : activeBadge(false)) },
      { label: 'Last seen', render: (d) => h('span', { title: fmtDate(d.last_seen) }, fmtAgo(d.last_seen)) },
      { label: 'Location', render: (d) => `${d.greenhouse_id || '—'} / ${d.area_id || '—'} · ${d.location || ''}` },
      { label: 'Sensors', class: 'num', key: 'sensor_count' },
      { label: 'Actuators', class: 'num', key: 'actuator_count' },
      { label: 'Firmware', key: 'firmware' },
    ], devices, { empty: 'No devices registered.' }));

    const days = stats.measurements_per_day.slice(-30);
    barChart(perDay, { labels: days.map((d) => fmtDay(d.day)), datasets: [{ label: 'Measurements', data: days.map((d) => d.measurements), color: '#2e7d32' }] });

    clear(bySeverity,
      h('h3', {}, 'Alerts by severity'),
      table([{ label: 'Severity', key: 'severity' }, { label: 'Status', key: 'status' }, { label: 'Count', class: 'num', key: 'n' }], stats.alerts_by_severity, { empty: 'No alerts recorded.' }),
      h('h3', { style: { marginTop: '1rem' } }, 'Recommendations by type'),
      table([{ label: 'Type', key: 'type' }, { label: 'Status', key: 'status' }, { label: 'Count', class: 'num', key: 'n' }], stats.recommendations_by_type, { empty: 'No recommendations yet.' }),
      h('button', {
        style: { marginTop: '.8rem' },
        onclick: async () => {
          try { const out = await post('/recommendations/generate', { force: true }); toast(`${out.filter((o) => o.created).length} recommendation(s) generated.`); load(); } catch (err) { showError(err); }
        },
      }, '🤖 Run the AI analysis now'));
  } catch (err) { showError(err); }
}
load();
every(30000, load);
