// Irrigation history (US-17): actuator activation events and daily irrigation minutes.

import { get } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, table, fmtDate, fmtDay, fmtNum, badge, stateBadge, showError, loading, toIsoOrUndefined } from '../ui.js';
import { barChart } from '../charts.js';

const { main } = await boot({ active: 'irrigation', title: 'Irrigation & actuator history', subtitle: 'Who or what activated each actuator, when, and for how long.' });

const [areas, actuators] = await Promise.all([get('/areas'), get('/actuators')]);
const PAGE = 50;
let offset = 0;

const areaSel = h('select', { id: 'f-area' }, areas.map((a) => h('option', { value: a.id }, `${a.name} (${a.id})`)));
const f = {
  actuator_id: h('select', { id: 'f-act' }, h('option', { value: '' }, 'All actuators'), actuators.map((a) => h('option', { value: a.id }, `${a.id} · ${a.name}`))),
  source: h('select', { id: 'f-source' }, ['', 'MANUAL', 'AUTOMATIC', 'AI', 'SYSTEM'].map((v) => h('option', { value: v }, v || 'All sources'))),
  from: h('input', { id: 'f-from', type: 'date' }),
  to: h('input', { id: 'f-to', type: 'date' }),
};
const field = (label, input) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input);
const canvas = h('canvas', { 'aria-label': 'Daily irrigation minutes' });
const totals = h('p', { class: 'small muted' });
const listSlot = h('div', {}, loading());
const pager = h('div', { class: 'pager' });

main.append(
  h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, '🚿 Irrigation minutes per day (last 30 days)'), field('Area', areaSel)),
    h('div', { class: 'chart-box sm' }, canvas), totals),
  h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, '📋 Activation events')),
    h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); offset = 0; loadEvents(); } },
      field('Actuator', f.actuator_id), field('Source', f.source), field('From', f.from), field('To', f.to),
      h('button', { class: 'primary', type: 'submit' }, '🔍 Apply filters')),
    listSlot, pager));

const SOURCE = {
  MANUAL: () => badge('info', 'Manual', '✋'), AUTOMATIC: () => badge('ok', 'Automatic', '⚙'),
  AI: () => badge('info', 'AI recommendation', '🤖'), SYSTEM: () => badge('neutral', 'System', '🖥'),
};

async function loadDaily() {
  try {
    const rows = (await get('/irrigation/daily-minutes', { area_id: areaSel.value, days: 30 })).slice().sort((a, b) => new Date(a.day) - new Date(b.day));
    barChart(canvas, { labels: rows.map((r) => fmtDay(r.day)), datasets: [{ label: 'Minutes of irrigation', data: rows.map((r) => r.minutes), color: '#1f5fa8' }], unit: 'min' });
    const total = rows.reduce((s, r) => s + Number(r.minutes), 0);
    totals.textContent = `${fmtNum(total, 0)} minutes in ${rows.length} days · average ${fmtNum(total / Math.max(rows.length, 1))} min/day`;
  } catch (err) { showError(err); }
}

async function loadEvents() {
  try {
    const rows = await get('/actuators/events', {
      area_id: areaSel.value, actuator_id: f.actuator_id.value, source: f.source.value,
      from: toIsoOrUndefined(f.from.value), to: toIsoOrUndefined(f.to.value, true), limit: PAGE, offset,
    });
    clear(listSlot, table([
      { label: 'Date', render: (e) => fmtDate(e.created_at) },
      { label: 'Actuator', render: (e) => `${e.actuator_name || ''} (${e.actuator_id})` },
      { label: 'Action', render: (e) => stateBadge(e.action) },
      { label: 'Source', render: (e) => (SOURCE[e.source] || (() => e.source))() },
      { label: 'User', render: (e) => e.user_email || '—' },
      { label: 'Duration', class: 'num', render: (e) => (e.duration_min ? `${fmtNum(e.duration_min)} min` : '—') },
      { label: 'Reason', render: (e) => e.reason || '—' },
    ], rows, { empty: 'No actuator events match these filters.' }));
    clear(pager,
      h('button', { class: 'sm', disabled: offset === 0, onclick: () => { offset -= PAGE; loadEvents(); } }, '← Newer'),
      h('button', { class: 'sm', disabled: rows.length < PAGE, onclick: () => { offset += PAGE; loadEvents(); } }, 'Older →'));
  } catch (err) { showError(err); }
}

areaSel.addEventListener('change', () => { offset = 0; loadDaily(); loadEvents(); });
loadDaily();
loadEvents();
