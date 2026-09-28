// Integrated producer dashboard (US-09, US-27): status summary, sensor cards,
// historical charts with threshold band (FR-10), alerts (US-11..13), actuators
// and irrigation control (US-14, US-15), AI recommendations (US-20, US-21, US-26)
// and device connectivity (FR-11). Auto-refresh every 30 s.

import { get, post, patch } from '../api.js';
import { boot } from '../layout.js';
import {
  h, clear, badge, fmtAgo, fmtDate, fmtNum, unitLabel, rangeStatus, severityBadge, alertStatusBadge,
  stateBadge, connectivityBadge, SENSOR_LABELS, SENSOR_ICONS, ACTUATOR_LABELS, ACTUATOR_ICONS,
  confirmDialog, formDialog, toast, showError, every, loading,
} from '../ui.js';
import { timeSeriesChart, downsample } from '../charts.js';
import { recommendationCard } from '../recs.js';

const { me, main, head } = await boot({
  active: 'dashboard', title: 'Greenhouse dashboard',
  subtitle: 'Live status of your cilantro crop. Data refreshes automatically every 30 seconds.',
});

const state = { areas: [], areaId: null, period: '24h', sensorId: null, sensors: [] };

// ---------- Layout ----------
const areaSelect = h('select', { id: 'area-select', 'aria-label': 'Cultivation area', style: { width: 'auto' } });
const refreshInfo = h('span', { class: 'small muted' });
head.appendChild(h('div', { class: 'row' }, h('label', { for: 'area-select', style: { margin: 0 } }, 'Area'), areaSelect,
  h('button', { onclick: () => refresh(), title: 'Refresh now' }, '⟳ Refresh'), refreshInfo));

const bannerSlot = h('div');
const summarySlot = h('div', { class: 'grid cols-4' });
const sensorsSlot = h('div', { class: 'grid cols-4' });
const actuatorsSlot = h('div');
const recsSlot = h('div', { class: 'stack' });
const alertsSlot = h('div');
const devicesSlot = h('div');
const chartCanvas = h('canvas', { id: 'history-chart', 'aria-label': 'Historical chart' });
const chartSensor = h('select', { id: 'chart-sensor', 'aria-label': 'Variable', style: { width: 'auto' } });
const periodButtons = ['24h', '7d', '30d'].map((p) => h('button', { 'data-p': p, onclick: () => { state.period = p; loadChart(); } }, p === '24h' ? '24 h' : p === '7d' ? '7 days' : '30 days'));
const chartNote = h('p', { class: 'small muted' });

main.append(
  bannerSlot,
  summarySlot,
  h('h2', { style: { margin: '1.2rem 0 .6rem' } }, 'Sensors'),
  sensorsSlot,
  h('div', { class: 'grid cols-2', style: { marginTop: '1rem' } },
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '🚿 Actuators & irrigation control')),
      actuatorsSlot),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '🤖 AI recommendations'),
        h('a', { href: '/producer/recommendations.html', class: 'small' }, 'History →')),
      recsSlot)),
  h('section', { class: 'card', style: { marginTop: '1rem' } },
    h('div', { class: 'card-head' }, h('h2', {}, '📈 Historical data'),
      h('div', { class: 'row' }, chartSensor, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' }, periodButtons))),
    h('div', { class: 'chart-box' }, chartCanvas), chartNote),
  h('div', { class: 'grid cols-2', style: { marginTop: '1rem' } },
    h('section', { class: 'card', id: 'alerts-panel' },
      h('div', { class: 'card-head' }, h('h2', {}, '🔔 Active alerts'), h('a', { href: '/producer/alerts.html', class: 'small' }, 'Alert history →')),
      alertsSlot),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '📡 Device connectivity')), devicesSlot)),
);
sensorsSlot.appendChild(loading());

// ---------- Data ----------
async function loadAreas() {
  state.areas = (await get('/areas')).filter((a) => a.is_active);
  const saved = localStorage.getItem('sg_area');
  state.areaId = state.areas.some((a) => a.id === saved) ? saved : (state.areas[0] && state.areas[0].id);
  clear(areaSelect, state.areas.map((a) => h('option', { value: a.id, selected: a.id === state.areaId }, `${a.name} (${a.id})`)));
}
areaSelect.addEventListener('change', async () => {
  state.areaId = areaSelect.value;
  localStorage.setItem('sg_area', state.areaId);
  state.sensorId = null;
  await refresh();
});

const area = () => state.areas.find((a) => a.id === state.areaId) || {};

async function refresh() {
  if (!state.areaId) { clear(sensorsSlot, h('div', { class: 'empty' }, 'No cultivation area is configured yet.')); return; }
  try {
    const [areas, latest, actuators, open, acked, devices, irrigation, recs, sensors] = await Promise.all([
      get('/areas'),
      get('/measurements/latest'),
      get('/actuators/status'),
      get('/alerts', { status: 'OPEN', limit: 50 }),
      get('/alerts', { status: 'ACKNOWLEDGED', limit: 50 }),
      get('/devices'),
      get(`/irrigation/status/${state.areaId}`).catch(() => null),
      get('/recommendations', { status: 'PENDING', area_id: state.areaId, limit: 5 }),
      get('/sensors', { area_id: state.areaId }),
    ]);
    state.areas = areas.filter((a) => a.is_active);
    const readings = latest.filter((m) => m.area_id === state.areaId);
    const acts = actuators.actuators.filter((a) => a.area_id === state.areaId);
    const alerts = [...open.data, ...acked.data].filter((a) => !a.area_id || a.area_id === state.areaId);
    const areaDevices = devices.filter((d) => d.is_active && (!d.area_id || d.area_id === state.areaId || d.greenhouse_id === area().greenhouse_id));

    renderBanner(alerts);
    renderSummary(readings, alerts, areaDevices, acts);
    renderSensors(readings);
    renderActuators(acts, readings, irrigation);
    renderRecs(recs);
    renderAlerts(alerts);
    renderDevices(areaDevices);

    const sensorsChanged = sensors.map((s) => s.id).join() !== state.sensors.map((s) => s.id).join();
    state.sensors = sensors.filter((s) => s.is_active);
    if (sensorsChanged || !state.sensorId) fillChartSensors();
    if (state.period === '24h') loadChart();
    refreshInfo.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    showError(err);
  }
}

// ---------- Renderers ----------
function renderBanner(alerts) {
  const active = alerts.filter((a) => a.status === 'OPEN');
  if (!active.length) {
    clear(bannerSlot, h('div', { class: 'banner ok', role: 'status' }, '✔ No active alerts. All monitored conditions are under control.'));
    return;
  }
  const high = active.filter((a) => a.severity === 'HIGH').length;
  const kind = high ? 'danger' : 'warn';
  clear(bannerSlot, h('div', { class: `banner ${kind}`, role: 'alert' },
    h('span', { 'aria-hidden': 'true' }, high ? '✖' : '⚠'),
    h('span', { class: 'grow' }, `${active.length} active alert${active.length > 1 ? 's' : ''}${high ? ` · ${high} of HIGH severity` : ''}: ${active[0].message}`),
    h('a', { href: '#alerts-panel', class: 'btn' }, 'Review alerts')));
}

function renderSummary(readings, alerts, devices, acts) {
  const out = readings.filter((r) => rangeStatus(r.value, r.threshold_min, r.threshold_max).kind === 'warn').length;
  const offline = devices.filter((d) => d.connectivity !== 'ONLINE').length;
  const openAlerts = alerts.filter((a) => a.status === 'OPEN');
  const high = openAlerts.some((a) => a.severity === 'HIGH');
  let overall = badge('ok', 'Normal');
  if (high || offline) overall = badge('danger', 'Critical — action needed');
  else if (openAlerts.length || out) overall = badge('warn', 'Attention');
  const lastReading = readings.reduce((m, r) => (!m || new Date(r.recorded_at) > new Date(m) ? r.recorded_at : m), null);
  const pump = acts.find((a) => a.type === 'irrigation_pump');
  const a = area();

  const kpi = (label, value, extra) => h('div', { class: 'card kpi' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value), extra || null);
  clear(summarySlot,
    kpi('Overall status', overall, h('span', { class: 'small muted' }, `${a.name || ''} · ${a.crop_name || 'no crop'}`)),
    kpi('Variables out of range', String(out), h('span', { class: 'small muted' }, `${readings.length} sensors reporting`)),
    kpi('Active alerts', String(openAlerts.length), h('span', { class: 'small muted' }, `${alerts.length - openAlerts.length} acknowledged`)),
    kpi('Last update', lastReading ? fmtAgo(lastReading) : '—', h('span', { class: 'small muted' },
      `Mode ${a.mode === 'AUTOMATIC' ? '⚙ Automatic' : '✋ Manual'} · pump ${pump ? pump.state : '—'}`)));
}

function renderSensors(readings) {
  if (!readings.length) { clear(sensorsSlot, h('div', { class: 'empty card' }, 'No measurements have been received for this area yet.')); return; }
  clear(sensorsSlot, readings.map((r) => {
    const st = rangeStatus(Number(r.value), r.threshold_min, r.threshold_max);
    const stale = Date.now() - new Date(r.recorded_at).getTime() > 10 * 60000;
    const cls = r.is_anomaly ? 'danger' : st.kind === 'warn' ? 'warn' : st.kind === 'ok' ? 'ok' : '';
    return h('div', { class: `card sensor-card ${cls}`, 'data-sensor': r.sensor_id },
      h('div', { class: 'kpi' },
        h('span', { class: 'label' }, `${SENSOR_ICONS[r.sensor_type] || ''} ${SENSOR_LABELS[r.sensor_type] || r.sensor_type}`),
        h('span', { class: 'value' }, fmtNum(r.value, r.sensor_type === 'ph' ? 2 : 1), h('span', { class: 'unit' }, unitLabel(r.unit)))),
      h('div', { class: 'row', style: { margin: '.35rem 0' } },
        badge(st.kind, st.text),
        r.is_anomaly ? badge('danger', 'Anomaly', '⚡') : null,
        stale ? badge('neutral', 'Stale data', '⌛') : null),
      h('div', { class: 'meta' },
        h('span', {}, `${r.sensor_id} · optimal ${r.threshold_min ?? '—'}–${r.threshold_max ?? '—'} ${unitLabel(r.unit)}`),
        h('span', { title: fmtDate(r.recorded_at) }, fmtAgo(r.recorded_at))));
  }));
}

function renderActuators(acts, readings, irrigation) {
  const a = area();
  const manual = a.mode === 'MANUAL';
  const canCommand = me.can('actuators.command');
  const tank = readings.find((r) => r.sensor_type === 'water_level');
  const maxDuration = irrigation && irrigation.config ? Number(irrigation.config.max_duration_min) : 10;

  const modeSwitch = h('div', { class: 'row', style: { marginBottom: '.8rem' } },
    h('strong', {}, 'Operation mode:'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Operation mode' },
      ['MANUAL', 'AUTOMATIC'].map((m) => h('button', {
        class: a.mode === m ? 'active' : '', disabled: !me.can('areas.mode'), 'aria-pressed': String(a.mode === m),
        onclick: () => changeMode(m),
      }, m === 'MANUAL' ? '✋ Manual' : '⚙ Automatic'))));

  const decision = irrigation && irrigation.decision;
  const decisionNote = decision ? h('div', { class: `banner ${decision.blocked ? 'warn' : 'info'}`, style: { fontWeight: 500 } },
    decision.blocked ? '⚠' : 'ℹ', ` Automatic irrigation: ${decision.reason}`) : null;

  const rows = acts.map((act) => {
    const isPump = act.type === 'irrigation_pump';
    const controls = canCommand && manual && !act.is_offline
      ? h('div', { class: 'row' },
        h('button', { class: 'success sm', onclick: () => sendCommand(act, 'ON', maxDuration), disabled: act.state === 'ON' }, isPump ? '▶ Start irrigation' : '⏻ Turn ON'),
        h('button', { class: 'sm', onclick: () => sendCommand(act, 'OFF'), disabled: act.state === 'OFF' }, isPump ? '■ Stop' : '○ Turn OFF'))
      : h('span', { class: 'small muted' }, act.is_offline ? 'Device offline — commands unavailable'
        : !manual ? 'Controlled automatically' : 'You cannot send commands');

    return h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '.6rem 0', borderBottom: '1px solid var(--line)' } },
      h('div', { class: 'row' },
        h('span', { style: { fontSize: '1.5rem' }, 'aria-hidden': 'true' }, ACTUATOR_ICONS[act.type] || '⚙'),
        h('div', {}, h('strong', {}, act.name || ACTUATOR_LABELS[act.type]),
          h('div', { class: 'small muted' }, `${act.id} · last change ${fmtAgo(act.last_change)}`)),
        stateBadge(act.state),
        isPump && tank ? h('div', { class: 'row', title: `Water tank ${tank.value} %` },
          h('div', { class: 'tank', 'aria-hidden': 'true' }, h('span', { style: { height: `${Math.max(0, Math.min(100, tank.value))}%` } })),
          h('div', { class: 'small' }, h('strong', {}, `${fmtNum(tank.value)} %`), h('div', { class: 'muted' }, 'water tank'),
            tank.value < (irrigation && irrigation.config ? irrigation.config.min_tank_level : 20) ? badge('danger', 'Low water') : null)) : null),
      controls);
  });

  clear(actuatorsSlot, modeSwitch,
    !manual ? h('p', { class: 'small muted' }, 'In Automatic mode the system irrigates and ventilates by itself. Switch to Manual to control the actuators yourself.') : null,
    decisionNote,
    rows.length ? rows : h('div', { class: 'empty' }, 'No actuators registered for this area.'));
}

async function changeMode(mode) {
  const a = area();
  if (a.mode === mode) return;
  const ok = await confirmDialog({
    title: `Switch to ${mode === 'MANUAL' ? 'Manual' : 'Automatic'} mode?`,
    message: mode === 'MANUAL'
      ? 'The automatic irrigation and ventilation engines will stop controlling this area. You will operate the actuators yourself.'
      : 'The system will irrigate and ventilate automatically according to the configured conditions. Manual commands will be disabled.',
    confirmText: 'Switch mode',
  });
  if (!ok) return;
  try {
    await patch(`/areas/${a.id}/mode`, { mode });
    toast(`${a.name} is now in ${mode === 'MANUAL' ? 'Manual' : 'Automatic'} mode.`);
    await refresh();
  } catch (err) { showError(err); }
}

async function sendCommand(act, action, maxDuration) {
  const isPump = act.type === 'irrigation_pump';
  if (action === 'ON') {
    const result = await formDialog({
      title: isPump ? 'Start irrigation' : `Turn ON ${act.name}`,
      submitText: isPump ? '▶ Start irrigation' : '⏻ Turn ON',
      fields: [{
        name: 'duration_min', label: 'Duration (minutes)', type: 'number', min: 1, max: maxDuration, step: 1, required: true,
        value: isPump ? Math.min(5, maxDuration) : 10,
        help: isPump ? `The pump turns off automatically after this time (maximum ${maxDuration} min).` : 'The actuator turns off automatically after this time.',
      }],
      onSubmit: (v) => post(`/actuators/${act.id}/command`, { action: 'ON', duration_min: v.duration_min, reason: 'Manual control from the dashboard.' }),
    });
    if (result) { toast(`Command sent to ${act.name}. Waiting for the device to confirm…`, 'info'); setTimeout(refresh, 6000); }
    return;
  }
  const ok = await confirmDialog({ title: `Turn OFF ${act.name}?`, message: 'The device will stop this actuator on its next check (about 5 seconds).', confirmText: 'Turn OFF' });
  if (!ok) return;
  try {
    await post(`/actuators/${act.id}/command`, { action: 'OFF', reason: 'Manual control from the dashboard.' });
    toast(`OFF command sent to ${act.name}.`, 'info');
    setTimeout(refresh, 6000);
  } catch (err) { showError(err); }
}

function renderRecs(recs) {
  if (!recs.length) {
    clear(recsSlot, h('div', { class: 'empty' }, '✔ No pending recommendations. The AI reviews the crop every 15 minutes and after every new alert.'),
      me.can('recommendations.generate') ? h('button', { onclick: generateNow }, '🤖 Analyse now') : null);
    return;
  }
  clear(recsSlot, recs.map((r) => recommendationCard(r, { canDecide: me.can('recommendations.decide'), onDecided: refresh })));
}

async function generateNow() {
  try {
    const out = await post('/recommendations/generate', { area_id: state.areaId, force: true });
    const created = out.filter((o) => o.created).length;
    toast(created ? 'A new recommendation was generated.' : (out[0] && out[0].reason) || 'No new recommendation.', created ? 'ok' : 'info');
    await refresh();
  } catch (err) { showError(err); }
}

function renderAlerts(alerts) {
  if (!alerts.length) { clear(alertsSlot, h('div', { class: 'empty' }, '✔ There are no active alerts.')); return; }
  clear(alertsSlot, alerts.slice(0, 8).map((a) => h('div', { style: { padding: '.6rem 0', borderBottom: '1px solid var(--line)' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('div', { class: 'row' }, severityBadge(a.severity), alertStatusBadge(a.status), h('strong', {}, `${a.type} · ${a.sensor_id || a.device_id || ''}`)),
      a.status === 'OPEN' && me.can('alerts.ack') ? h('button', { class: 'sm', onclick: () => ack(a) }, '👁 Acknowledge') : null),
    h('div', {}, a.message),
    h('div', { class: 'small muted' }, `${fmtDate(a.created_at)} (${fmtAgo(a.created_at)})`))));
}

async function ack(a) {
  try {
    await patch(`/alerts/${a.id}/ack`);
    toast('Alert acknowledged.');
    await refresh();
  } catch (err) { showError(err); }
}

function renderDevices(devices) {
  if (!devices.length) { clear(devicesSlot, h('div', { class: 'empty' }, 'No devices registered.')); return; }
  clear(devicesSlot, devices.map((d) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '.5rem 0', borderBottom: '1px solid var(--line)' } },
    h('div', {}, h('strong', {}, d.name), h('div', { class: 'small muted' }, `${d.id} · ${d.sensor_count} sensors · ${d.actuator_count} actuators`)),
    h('div', { class: 'row' }, connectivityBadge(d.connectivity), h('span', { class: 'small muted' }, `last seen ${fmtAgo(d.last_seen)}`)))));
}

// ---------- Historical chart (FR-10) ----------
function fillChartSensors() {
  const current = state.sensorId && state.sensors.some((s) => s.id === state.sensorId) ? state.sensorId : null;
  state.sensorId = current || (state.sensors.find((s) => s.type === 'soil_moisture') || state.sensors[0] || {}).id;
  clear(chartSensor, state.sensors.map((s) => h('option', { value: s.id, selected: s.id === state.sensorId },
    `${SENSOR_LABELS[s.type] || s.type} (${s.id})`)));
  loadChart();
}
chartSensor.addEventListener('change', () => { state.sensorId = chartSensor.value; loadChart(); });

let thresholdsCache = null;
async function loadChart() {
  periodButtons.forEach((b) => b.classList.toggle('active', b.dataset.p === state.period));
  if (!state.sensorId) return;
  const hours = { '24h': 24, '7d': 168, '30d': 720 }[state.period];
  const to = Date.now();
  const from = to - hours * 3600000;
  try {
    const started = performance.now();
    if (!thresholdsCache) thresholdsCache = await get('/thresholds');
    const hist = await get(`/sensors/${state.sensorId}/measurements`, { from: new Date(from).toISOString(), limit: 10000 });
    const rows = hist.data.slice().reverse();
    const normal = rows.filter((r) => !r.is_anomaly).map((r) => ({ x: new Date(r.recorded_at).getTime(), y: Number(r.value) }));
    const anomalies = rows.filter((r) => r.is_anomaly).map((r) => ({ x: new Date(r.recorded_at).getTime(), y: Number(r.value) }));
    const th = thresholdsCache.find((t) => t.area_id === hist.area_id && t.sensor_type === hist.type);
    const series = [{ label: `${SENSOR_LABELS[hist.type] || hist.type} (${hist.sensor_id})`, points: downsample(normal, 500) }];
    if (anomalies.length) series.push({ label: 'Anomalous readings', points: anomalies, scatter: true });
    timeSeriesChart(chartCanvas, {
      series, unit: unitLabel(hist.unit), from, to,
      band: th ? { min: Number(th.min_value), max: Number(th.max_value) } : null,
    });
    const values = normal.map((p) => p.y);
    chartNote.textContent = values.length
      ? `${rows.length} readings · min ${fmtNum(Math.min(...values))} · average ${fmtNum(values.reduce((s, v) => s + v, 0) / values.length)} · max ${fmtNum(Math.max(...values))} ${unitLabel(hist.unit)}`
        + `${anomalies.length ? ` · ${anomalies.length} anomalous readings marked ✖` : ''} · green band = optimal range · loaded in ${Math.round(performance.now() - started)} ms`
      : 'No readings in this period.';
  } catch (err) { showError(err); }
}

// ---------- Start ----------
await loadAreas();
await refresh();
every(30000, refresh);
