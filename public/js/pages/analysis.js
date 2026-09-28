// Historical analysis (US-18): daily min/avg/max per variable, % of time in the
// optimal range, irrigation minutes per day and trends (24 h / 7 d).

import { get } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, table, fmtDay, fmtNum, badge, SENSOR_LABELS, unitLabel, showError, loading, toIsoOrUndefined } from '../ui.js';
import { lineChart } from '../charts.js';

const { main } = await boot({ active: 'analysis', title: 'Historical analysis', subtitle: 'Daily behaviour of every variable. Readings flagged as anomalies are excluded.' });

const areas = await get('/areas');
const areaSel = h('select', { id: 'f-area' }, areas.map((a) => h('option', { value: a.id }, `${a.name} (${a.id})`)));
const fromIn = h('input', { id: 'f-from', type: 'date', value: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) });
const toIn = h('input', { id: 'f-to', type: 'date', value: new Date().toISOString().slice(0, 10) });
const varSel = h('select', { id: 'f-var' });
const windowBtns = ['24h', '7d'].map((w) => h('button', { 'data-w': w, onclick: () => loadTrends(w) }, w === '24h' ? 'Last 24 h' : 'Last 7 days'));
const field = (label, input) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input);

const rangeSlot = h('div', { class: 'grid cols-4' }, loading());
const trendSlot = h('div', {}, loading());
const canvas = h('canvas', { 'aria-label': 'Daily averages' });
const dailySlot = h('div');
let summary = null;

main.append(
  h('section', { class: 'card' }, h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); loadSummary(); } },
    field('Area', areaSel), field('From', fromIn), field('To', toIn), h('button', { class: 'primary', type: 'submit' }, '📊 Analyse'))),
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '🎯 Time inside the optimal range')), rangeSlot),
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '↗ Trends'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Trend window' }, windowBtns)), trendSlot),
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '📈 Daily averages'), field('Variable', varSel)),
    h('div', { class: 'chart-box' }, canvas), dailySlot));

function pctBadge(p) {
  if (p >= 80) return badge('ok', `${fmtNum(p)} %`);
  if (p >= 50) return badge('warn', `${fmtNum(p)} %`);
  return badge('danger', `${fmtNum(p)} %`);
}

async function loadSummary() {
  try {
    summary = await get('/analysis/summary', { area_id: areaSel.value, from: toIsoOrUndefined(fromIn.value), to: toIsoOrUndefined(toIn.value, true) });
    clear(rangeSlot, summary.optimal_range.length ? summary.optimal_range.map((r) => h('div', { class: 'card kpi' },
      h('span', { class: 'label' }, SENSOR_LABELS[r.sensor_type] || r.sensor_type),
      h('span', { class: 'value' }, pctBadge(Number(r.pct_time_in_optimal_range))),
      h('span', { class: 'small muted' }, `${r.readings_in_range} of ${r.total_readings} readings in range`)))
      : h('div', { class: 'empty' }, 'No data in this period.'));

    const irrigation = summary.irrigation_minutes_per_day.reduce((s, d) => s + Number(d.minutes), 0);
    rangeSlot.appendChild(h('div', { class: 'card kpi' }, h('span', { class: 'label' }, 'Irrigation'),
      h('span', { class: 'value' }, fmtNum(irrigation / Math.max(summary.irrigation_minutes_per_day.length, 1)), h('span', { class: 'unit' }, 'min/day')),
      h('span', { class: 'small muted' }, `${summary.anomalies_excluded} anomalous readings excluded`)));

    const types = [...new Set(summary.daily.map((d) => d.sensor_type))];
    const prev = varSel.value;
    clear(varSel, types.map((t) => h('option', { value: t, selected: t === (prev || 'soil_moisture') }, SENSOR_LABELS[t] || t)));
    drawDaily();
  } catch (err) { showError(err); }
}

function drawDaily() {
  if (!summary) return;
  const type = varSel.value;
  const rows = summary.daily.filter((d) => d.sensor_type === type);
  const sensors = [...new Set(rows.map((r) => r.sensor_id))];
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const datasets = [];
  sensors.forEach((sid) => {
    const by = Object.fromEntries(rows.filter((r) => r.sensor_id === sid).map((r) => [r.day, r]));
    datasets.push({ label: `Average ${sid}`, data: days.map((d) => (by[d] ? by[d].avg_value : null)) });
    if (sensors.length === 1) {
      datasets.push({ label: 'Daily minimum', data: days.map((d) => (by[d] ? by[d].min_value : null)), borderDash: [4, 4], pointRadius: 0, color: '#1f5fa8' });
      datasets.push({ label: 'Daily maximum', data: days.map((d) => (by[d] ? by[d].max_value : null)), borderDash: [4, 4], pointRadius: 0, color: '#b26a00' });
    }
  });
  const unit = rows[0] ? (rows[0].unit === 'C' ? '°C' : rows[0].unit) : '';
  lineChart(canvas, { labels: days.map(fmtDay), datasets, unit });
  clear(dailySlot, h('details', { class: 'why', style: { marginTop: '.8rem' } }, h('summary', {}, `Show the daily table (${rows.length} rows)`), table([
    { label: 'Day', render: (r) => fmtDay(r.day) },
    { label: 'Sensor', key: 'sensor_id' },
    { label: 'Minimum', class: 'num', render: (r) => fmtNum(r.min_value, 2) },
    { label: 'Average', class: 'num', render: (r) => fmtNum(r.avg_value, 2) },
    { label: 'Maximum', class: 'num', render: (r) => fmtNum(r.max_value, 2) },
    { label: 'Readings', class: 'num', key: 'samples' },
  ], rows.slice().reverse())));
}
varSel.addEventListener('change', drawDaily);

const ARROW = { RISING: ['↑', 'Rising', 'warn'], FALLING: ['↓', 'Falling', 'warn'], STABLE: ['→', 'Stable', 'ok'] };
async function loadTrends(win = '24h') {
  windowBtns.forEach((b) => b.classList.toggle('active', b.dataset.w === win));
  try {
    const res = await get('/analysis/trends', { area_id: areaSel.value, window: win });
    clear(trendSlot, table([
      { label: 'Variable', render: (t) => SENSOR_LABELS[t.sensor_type] || t.sensor_type },
      { label: 'Current', class: 'num', render: (t) => `${fmtNum(t.current, 2)} ${t.threshold ? unitLabel(t.threshold.unit) : ''}` },
      { label: 'Trend', render: (t) => { const [arrow, text, kind] = ARROW[t.direction] || ['?', t.direction, 'neutral']; return badge(kind, text, arrow); } },
      { label: 'Change per hour', class: 'num', render: (t) => fmtNum(t.slope_per_hour, 3) },
      { label: 'Optimal range', render: (t) => (t.threshold ? `${t.threshold.min}–${t.threshold.max} ${unitLabel(t.threshold.unit)}` : '—') },
      { label: 'Projection', render: (t) => (t.hours_to_threshold === null || t.hours_to_threshold === undefined ? 'Not approaching a limit'
        : t.hours_to_threshold > 168 ? 'More than 7 days to reach a limit' : `Reaches a limit in about ${fmtNum(t.hours_to_threshold)} h`) },
    ], res.trends, { empty: 'Not enough data to compute trends.' }));
  } catch (err) { showError(err); }
}

areaSel.addEventListener('change', () => { loadSummary(); loadTrends(); });
loadSummary();
loadTrends();
