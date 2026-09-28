// Alert history (US-13): filters by status, severity, sensor and dates,
// pagination, acknowledge and CSV export.

import { get, patch, download } from '../api.js';
import { boot } from '../layout.js';
import {
  h, clear, table, fmtDate, fmtNum, severityBadge, alertStatusBadge, toast, showError, loading, toIsoOrUndefined,
} from '../ui.js';

const { me, main } = await boot({ active: 'alerts', title: 'Alert history', subtitle: 'Every alert raised by the system, with its severity and current status.' });

const PAGE = 25;
let offset = 0;
const sensors = await get('/sensors');

const f = {
  status: h('select', { id: 'f-status' }, ['', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'].map((v) => h('option', { value: v }, v || 'All statuses'))),
  severity: h('select', { id: 'f-severity' }, ['', 'HIGH', 'MEDIUM', 'LOW'].map((v) => h('option', { value: v }, v || 'All severities'))),
  type: h('select', { id: 'f-type' }, ['', 'LOW', 'HIGH', 'DEVICE_OFFLINE', 'LOW_WATER', 'ANOMALY'].map((v) => h('option', { value: v }, v || 'All types'))),
  sensor_id: h('select', { id: 'f-sensor' }, h('option', { value: '' }, 'All sensors'), sensors.map((s) => h('option', { value: s.id }, `${s.id} · ${s.name}`))),
  from: h('input', { id: 'f-from', type: 'date' }),
  to: h('input', { id: 'f-to', type: 'date' }),
};
const field = (label, input) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input);

const listSlot = h('div', {}, loading());
const pager = h('div', { class: 'pager' });

function query() {
  return {
    status: f.status.value, severity: f.severity.value, type: f.type.value, sensor_id: f.sensor_id.value,
    from: toIsoOrUndefined(f.from.value), to: toIsoOrUndefined(f.to.value, true),
  };
}

main.appendChild(h('section', { class: 'card' },
  h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); offset = 0; load(); } },
    field('Status', f.status), field('Severity', f.severity), field('Type', f.type), field('Sensor', f.sensor_id),
    field('From', f.from), field('To', f.to),
    h('button', { class: 'primary', type: 'submit' }, '🔍 Apply filters'),
    h('button', { type: 'button', onclick: () => { Object.values(f).forEach((i) => { i.value = ''; }); offset = 0; load(); } }, 'Clear'),
    h('button', { type: 'button', onclick: exportCsv }, '⬇ Export CSV')),
  listSlot, pager));

async function load() {
  try {
    const res = await get('/alerts', { ...query(), limit: PAGE, offset });
    clear(listSlot, table([
      { label: 'Date', render: (a) => fmtDate(a.created_at) },
      { label: 'Severity', render: (a) => severityBadge(a.severity) },
      { label: 'Status', render: (a) => alertStatusBadge(a.status) },
      { label: 'Type', key: 'type' },
      { label: 'Sensor / device', render: (a) => a.sensor_id || a.device_id || '—' },
      { label: 'Value', class: 'num', render: (a) => (a.value === null ? '—' : fmtNum(a.value, 2)) },
      { label: 'Message', key: 'message' },
      { label: 'Acknowledged', render: (a) => (a.acknowledged_at ? `${fmtDate(a.acknowledged_at)}${a.acknowledged_by_email ? ` · ${a.acknowledged_by_email}` : ''}` : '—') },
      { label: 'Resolved', render: (a) => fmtDate(a.resolved_at) },
      { label: '', render: (a) => (a.status === 'OPEN' && me.can('alerts.ack') ? h('button', { class: 'sm', onclick: () => ack(a) }, '👁 Acknowledge') : '') },
    ], res.data, { empty: 'No alerts match these filters.' }));
    const page = Math.floor(offset / PAGE) + 1;
    const pages = Math.max(1, Math.ceil(res.total / PAGE));
    clear(pager,
      h('span', {}, `${res.total} alerts · page ${page} of ${pages}`),
      h('button', { class: 'sm', disabled: offset === 0, onclick: () => { offset -= PAGE; load(); } }, '← Previous'),
      h('button', { class: 'sm', disabled: offset + PAGE >= res.total, onclick: () => { offset += PAGE; load(); } }, 'Next →'));
  } catch (err) { showError(err); }
}

async function ack(a) {
  try { await patch(`/alerts/${a.id}/ack`); toast('Alert acknowledged.'); load(); } catch (err) { showError(err); }
}

async function exportCsv() {
  try {
    await download('/alerts/export.csv', query(), `smartgreen-alerts-${new Date().toISOString().slice(0, 10)}.csv`);
    toast('CSV file downloaded.');
  } catch (err) { showError(err); }
}

load();
