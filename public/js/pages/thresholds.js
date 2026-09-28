// Threshold configuration (US-10): one row per variable, inline edit / save /
// cancel, and the API validation messages (min < max, inside the physical range).

import { get, put } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, fmtDate, SENSOR_LABELS, SENSOR_ICONS, unitLabel, toast, showError, loading } from '../ui.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'thresholds', title: 'Sensor thresholds',
  subtitle: 'Optimal range of every variable. Readings outside it raise an alert; the severity grows with the deviation.',
});

const areas = await get('/areas');
const areaSel = h('select', { id: 'th-area', style: { width: 'auto' } }, areas.map((a) => h('option', { value: a.id }, `${a.name} (${a.id}) · ${a.crop_name || 'no crop'}`)));
const body = h('div', {}, loading());
main.appendChild(h('section', { class: 'card' },
  h('div', { class: 'card-head' }, h('h2', {}, '🎚 Thresholds'), h('div', { class: 'row' }, h('label', { for: 'th-area', style: { margin: 0 } }, 'Area'), areaSel)),
  body));

async function load() {
  try {
    const rows = await get('/thresholds', { area_id: areaSel.value });
    if (!rows.length) { clear(body, h('div', { class: 'empty' }, 'This area has no thresholds. Assign a crop type to configure them automatically.')); return; }
    const tbody = h('tbody');
    rows.forEach((t) => tbody.appendChild(renderRow(t)));
    clear(body, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Variable', 'Minimum', 'Maximum', 'Unit', 'Stage', 'Last change', ''].map((c) => h('th', {}, c)))),
      tbody)));
  } catch (err) { showError(err); }
}

function renderRow(t) {
  const tr = h('tr', { 'data-type': t.sensor_type });
  const view = () => clear(tr,
    h('td', {}, h('strong', {}, `${SENSOR_ICONS[t.sensor_type] || ''} ${SENSOR_LABELS[t.sensor_type] || t.sensor_type}`)),
    h('td', { class: 'num' }, String(t.min_value)),
    h('td', { class: 'num' }, String(t.max_value)),
    h('td', {}, unitLabel(t.unit)),
    h('td', {}, t.crop_stage || '—'),
    h('td', { class: 'small' }, `${fmtDate(t.updated_at)}${t.updated_by_email ? ` · ${t.updated_by_email}` : ''}`),
    h('td', {}, h('button', { class: 'sm', onclick: edit }, '✎ Edit')));

  const edit = () => {
    const min = h('input', { type: 'number', step: 'any', 'aria-label': 'Minimum', value: t.min_value });
    const max = h('input', { type: 'number', step: 'any', 'aria-label': 'Maximum', value: t.max_value });
    min.value = t.min_value;
    max.value = t.max_value;
    const err = h('div', { class: 'error', role: 'alert' });
    const save = async () => {
      err.textContent = '';
      if (min.value === '' || max.value === '') { err.textContent = 'Both values are required.'; return; }
      if (Number(min.value) >= Number(max.value)) { err.textContent = 'The minimum must be lower than the maximum.'; return; }
      try {
        Object.assign(t, await put(`/thresholds/${t.id}`, { min_value: Number(min.value), max_value: Number(max.value) }));
        toast(`${SENSOR_LABELS[t.sensor_type]} threshold saved.`);
        view();
      } catch (e) {
        err.textContent = [e.message, ...(e.details || []).map((d) => d.issue)].filter(Boolean).join(' ');
      }
    };
    clear(tr,
      h('td', {}, h('strong', {}, SENSOR_LABELS[t.sensor_type] || t.sensor_type), err),
      h('td', {}, min), h('td', {}, max), h('td', {}, unitLabel(t.unit)), h('td', {}, t.crop_stage || '—'), h('td'),
      h('td', {}, h('div', { class: 'row' }, h('button', { class: 'sm primary', onclick: save }, '💾 Save'), h('button', { class: 'sm', onclick: view }, 'Cancel'))));
    min.focus();
  };

  view();
  return tr;
}

areaSel.addEventListener('change', load);
load();
