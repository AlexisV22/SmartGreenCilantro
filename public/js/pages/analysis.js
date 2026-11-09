// Historical analysis (US-18): daily min/avg/max per variable with the optimal
// band, a period selector (24 h / 7 days / 30 days), % of time in the optimal
// range, irrigation minutes per day and trends with arrows (24 h / 7 d).

import { get } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, table, fmtDay, fmtNum, badge, SENSOR_LABELS, unitLabel, showError, loading, toIsoOrUndefined } from '../ui.js';
import { lineChart } from '../charts.js';

const { main } = await boot({ active: 'analysis', title: 'Historical analysis', subtitle: 'Behaviour of every variable over time. Readings flagged as sensor faults are excluded.' });

const areas = await get('/areas');
const areaSel = h('select', { id: 'f-area' }, areas.map((a) => h('option', { value: a.id }, `${a.name} (${a.id})`)));
const fromIn = h('input', { id: 'f-from', type: 'date' });
const toIn = h('input', { id: 'f-to', type: 'date' });
const varSel = h('select', { id: 'f-var' });
const PERIODS = { '24h': 1, '7d': 7, '30d': 30 };
let period = '30d';
const periodBtns = Object.keys(PERIODS).map((p) => h('button', { type: 'button', 'data-period': p, onclick: () => setPeriod(p) }, p === '24h' ? '24 h' : p === '7d' ? '7 days' : '30 days'));
const windowBtns = ['24h', '7d'].map((w) => h('button', { 'data-w': w, onclick: () => loadTrends(w) }, w === '24h' ? 'Last 24 h' : 'Last 7 days'));
const field = (label, input) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input);

const rangeSlot = h('div', { class: 'grid cols-4' }, loading());
const trendSlot = h('div', {}, loading());
const canvas = h('canvas', { 'aria-label': 'Averages with the optimal band' });
const chartTitle = h('h2', {}, '📈 Daily averages');
const chartNote = h('p', { class: 'small muted' });
const dailySlot = h('div');
let summary = null;
let thresholds = [];

main.append(
  h('section', { class: 'card' }, h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); period = null; markPeriod(); loadSummary(); } },
    field('Area', areaSel),
    h('div', { class: 'field' }, h('label', {}, 'Period'), h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' }, periodBtns)),
    field('From', fromIn), field('To', toIn), h('button', { class: 'primary', type: 'submit' }, '📊 Analyse'))),
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '🎯 Time inside the optimal range')), rangeSlot),
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '↗ Trends'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Trend window' }, windowBtns)), trendSlot),
  h('section', { class: 'card' }, h('div', { class: 'card-head' }, chartTitle, field('Variable', varSel)),
    h('div', { class: 'chart-box' }, canvas), chartNote, dailySlot));

function markPeriod() { periodBtns.forEach((b) => b.classList.toggle('active', b.dataset.period === period)); }

function setPeriod(p) {
  period = p;
  const to = new Date();
  const from = new Date(to.getTime() - PERIODS[p] * 86400000);
  fromIn.value = from.toISOString().slice(0, 10);
  toIn.value = to.toISOString().slice(0, 10);
  markPeriod();
  loadSummary();
}

function pctBadge(p) {
  if (p >= 80) return badge('ok', `${fmtNum(p)} %`);
  if (p >= 50) return badge('warn', `${fmtNum(p)} %`);
  return badge('danger', `${fmtNum(p)} %`);
}

function rangeParams() {
  if (period) {
    const to = new Date();
    return { from: new Date(to.getTime() - PERIODS[period] * 86400000).toISOString(), to: to.toISOString() };
  }
  return { from: toIsoOrUndefined(fromIn.value), to: toIsoOrUndefined(toIn.value, true) };
}

async function loadSummary() {
  try {
    const range = rangeParams();
    [summary, thresholds] = await Promise.all([
      get('/analysis/summary', { area_id: areaSel.value, ...range }),
      get('/thresholds', { area_id: areaSel.value }),
    ]);
    clear(rangeSlot, summary.optimal_range.length ? summary.optimal_range.map((r) => h('div', { class: 'card kpi' },
      h('span', { class: 'label' }, SENSOR_LABELS[r.sensor_type] || r.sensor_type),
      h('span', { class: 'value' }, pctBadge(Number(r.pct_time_in_optimal_range))),
      h('span', { class: 'small muted' }, `${r.readings_in_range} of ${r.total_readings} readings in range`)))
      : h('div', { class: 'empty' }, 'No data in this period.'));

    const irrigation = summary.irrigation_minutes_per_day.reduce((s, d) => s + Number(d.minutes), 0);
    rangeSlot.appendChild(h('div', { class: 'card kpi' }, h('span', { class: 'label' }, 'Irrigation'),
      h('span', { class: 'value' }, fmtNum(irrigation / Math.max(summary.irrigation_minutes_per_day.length, 1)), h('span', { class: 'unit' }, 'min/day')),
      h('span', { class: 'small muted' }, `${summary.anomalies_excluded} faulty readings excluded`)));

    const types = [...new Set(summary.daily.map((d) => d.sensor_type))];
    const prev = varSel.value;
    clear(varSel, types.map((t) => h('option', { value: t, selected: t === (prev || 'soil_moisture') }, SENSOR_LABELS[t] || t)));
    await drawChart();
  } catch (err) { showError(err); }
}

/** Constant datasets that draw the optimal range as a green band. */
function bandDatasets(type, count, unit) {
  const th = thresholds.find((t) => t.sensor_type === type);
  if (!th) return [];
  return [
    { label: `Optimal minimum (${th.min_value} ${unit})`, data: Array(count).fill(Number(th.min_value)), borderColor: 'rgba(46,125,50,.7)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false, color: 'rgba(46,125,50,.7)' },
    { label: `Optimal maximum (${th.max_value} ${unit})`, data: Array(count).fill(Number(th.max_value)), borderColor: 'rgba(46,125,50,.7)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(46,125,50,.10)', color: 'rgba(46,125,50,.7)' },
  ];
}

async function drawChart() {
  if (!summary) return;
  const type = varSel.value;
  const rows = summary.daily.filter((d) => d.sensor_type === type);
  const unit = rows[0] ? unitLabel(rows[0].unit) : '';

  if (period === '24h') {
    // Hourly averages of the last 24 hours (faulty readings excluded).
    chartTitle.textContent = '📈 Hourly averages (last 24 h)';
    const sensors = [...new Set(rows.map((r) => r.sensor_id))];
    const from = new Date(Date.now() - 86400000);
    const hours = Array.from({ length: 24 }, (_, i) => new Date(Math.floor(from.getTime() / 3600000) * 3600000 + (i + 1) * 3600000));
    const datasets = [];
    for (const sid of sensors) {
      const hist = await get(`/sensors/${sid}/measurements`, { from: from.toISOString(), limit: 10000, include_anomalies: false });
      const buckets = new Map();
      for (const m of hist.data) {
        const k = Math.floor(new Date(m.recorded_at).getTime() / 3600000) * 3600000;
        const b = buckets.get(k) || { s: 0, n: 0 };
        b.s += Number(m.value); b.n += 1; buckets.set(k, b);
      }
      datasets.push({ label: `Hourly average ${sid}`, data: hours.map((t) => { const b = buckets.get(t.getTime()); return b ? Math.round((b.s / b.n) * 100) / 100 : null; }) });
    }
    lineChart(canvas, { labels: hours.map((t) => t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })), datasets: [...bandDatasets(type, hours.length, unit), ...datasets], unit });
    chartNote.textContent = 'Green band = optimal range for cilantro. Each point is the average of one hour.';
  } else {
    chartTitle.textContent = '📈 Daily averages';
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
    lineChart(canvas, { labels: days.map(fmtDay), datasets: [...bandDatasets(type, days.length, unit), ...datasets], unit });
    chartNote.textContent = 'Green band = optimal range for cilantro. Each point is the daily average (dashed lines: daily minimum and maximum).';
  }

  clear(dailySlot, h('details', { class: 'why', style: { marginTop: '.8rem' } }, h('summary', {}, `Show the daily table (${rows.length} rows)`), table([
    { label: 'Day', render: (r) => fmtDay(r.day) },
    { label: 'Sensor', key: 'sensor_id' },
    { label: 'Minimum', class: 'num', render: (r) => fmtNum(r.min_value, 2) },
    { label: 'Average', class: 'num', render: (r) => fmtNum(r.avg_value, 2) },
    { label: 'Maximum', class: 'num', render: (r) => fmtNum(r.max_value, 2) },
    { label: 'Readings', class: 'num', key: 'samples' },
  ], rows.slice().reverse())));
}
varSel.addEventListener('change', drawChart);

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
setPeriod('30d');
loadTrends();
