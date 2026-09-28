// Irrigation parameters (US-16) and generic automation rules (FR-18).

import { get, put, post } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, badge, fieldInput, toast, showError, loading, SENSOR_LABELS, ACTUATOR_LABELS } from '../ui.js';
import { crudSection } from '../crud.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'automation', title: 'Irrigation & automation',
  subtitle: 'Conditions under which the system irrigates, ventilates, shades or lights the crop in Automatic mode.',
});

const areas = await get('/areas');
const areaSel = h('select', { id: 'irr-area', style: { width: 'auto' } }, areas.map((a) => h('option', { value: a.id }, `${a.name} (${a.id})`)));
const formSlot = h('div', {}, loading());

const FIELDS = [
  { name: 'enabled', label: 'Automatic irrigation enabled', type: 'checkbox' },
  { name: 'target_moisture', label: 'Target soil moisture (%)', type: 'number', step: 'any', help: 'Irrigation stops when the average soil moisture reaches this value.' },
  { name: 'max_duration_min', label: 'Maximum duration (minutes)', type: 'number', step: 'any', help: 'Safety limit for one irrigation, also applied to manual commands.' },
  { name: 'cooldown_min', label: 'Cooldown between irrigations (minutes)', type: 'number', step: 'any' },
  { name: 'consecutive_readings', label: 'Consecutive low readings required', type: 'number', step: 1, help: 'Avoids irrigating because of a single noisy reading.' },
  { name: 'min_tank_level', label: 'Minimum water tank level (%)', type: 'number', step: 'any', help: 'Below this level irrigation is blocked and a LOW_WATER alert is raised.' },
];

main.appendChild(h('section', { class: 'card' },
  h('div', { class: 'card-head' }, h('h2', {}, '🚿 Automatic irrigation parameters'), h('div', { class: 'row' }, h('label', { for: 'irr-area', style: { margin: 0 } }, 'Area'), areaSel)),
  formSlot));

async function loadConfig() {
  try {
    const cfg = await get(`/irrigation/config/${areaSel.value}`);
    const inputs = {};
    const err = h('div', { class: 'form-error', role: 'alert' });
    const form = h('form', {
      class: 'grid cols-3',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        const body = {};
        for (const f of FIELDS) {
          if (f.type === 'checkbox') body[f.name] = inputs[f.name].checked;
          else if (inputs[f.name].value !== '') body[f.name] = Number(inputs[f.name].value);
        }
        try { await put(`/irrigation/config/${areaSel.value}`, body); toast('Irrigation parameters saved.'); loadConfig(); } catch (e2) {
          err.textContent = [e2.message, ...(e2.details || []).map((d) => `${d.field}: ${d.issue}`)].join(' ');
        }
      },
    }, FIELDS.map((f) => {
      inputs[f.name] = fieldInput(f, cfg[f.name]);
      return f.type === 'checkbox'
        ? h('div', { class: 'field' }, h('label', { class: 'check' }, inputs[f.name], f.label))
        : h('div', { class: 'field' }, h('label', { for: `f-${f.name}` }, f.label), inputs[f.name], f.help ? h('div', { class: 'help' }, f.help) : null);
    }));
    clear(formSlot,
      h('p', {}, `Area mode: `, cfg.mode === 'AUTOMATIC' ? badge('info', 'Automatic', '⚙') : badge('neutral', 'Manual — the engine is paused', '✋'),
        h('span', { class: 'small muted' }, `  Last change ${cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : '—'}${cfg.updated_by_email ? ` by ${cfg.updated_by_email}` : ''}`)),
      form, err, h('button', { class: 'primary', onclick: () => form.requestSubmit() }, '💾 Save parameters'));
  } catch (err) { showError(err); }
}
areaSel.addEventListener('change', loadConfig);
loadConfig();

const SENSOR_TYPES = Object.keys(SENSOR_LABELS);
const ACT_TYPES = Object.keys(ACTUATOR_LABELS);
const rules = crudSection({
  title: 'Automation rules (fans, shade, lighting)', icon: '⚙', createLabel: 'New rule',
  description: 'Each rule compares a variable with the threshold of its area. The actuator returns to its previous state when the value comes back past the hysteresis margin.',
  load: () => get('/automation-rules'),
  columns: [
    { label: 'Rule', render: (r) => h('div', {}, h('strong', {}, r.name), h('div', { class: 'small muted' }, r.area_name || r.area_id)) },
    { label: 'Condition', render: (r) => `${SENSOR_LABELS[r.sensor_type] || r.sensor_type} ${r.condition === 'ABOVE_MAX' ? 'above maximum' : 'below minimum'}` },
    { label: 'Action', render: (r) => `${ACTUATOR_LABELS[r.actuator_type] || r.actuator_type} → ${r.action}` },
    { label: 'Hysteresis', class: 'num', key: 'hysteresis' },
    { label: 'Hours', render: (r) => (r.active_from_hour !== null && r.active_from_hour !== undefined ? `${r.active_from_hour}:00–${r.active_to_hour}:00` : 'All day') },
    { label: 'Status', render: (r) => (r.enabled ? badge('ok', 'Enabled') : badge('neutral', 'Disabled', '○')) },
  ],
  createFields: [
    { name: 'area_id', label: 'Area', type: 'select', options: areas.map((a) => ({ value: a.id, label: a.name })) },
    { name: 'name', label: 'Name', required: true },
    { name: 'sensor_type', label: 'Variable', type: 'select', options: SENSOR_TYPES.map((t) => ({ value: t, label: SENSOR_LABELS[t] })) },
    { name: 'condition', label: 'Condition', type: 'select', options: [{ value: 'ABOVE_MAX', label: 'Above maximum' }, { value: 'BELOW_MIN', label: 'Below minimum' }] },
    { name: 'actuator_type', label: 'Actuator', type: 'select', options: ACT_TYPES.map((t) => ({ value: t, label: ACTUATOR_LABELS[t] })) },
    { name: 'action', label: 'Action', type: 'select', options: ['ON', 'OFF'] },
    { name: 'hysteresis', label: 'Hysteresis', type: 'number', step: 'any', value: 1 },
    { name: 'active_from_hour', label: 'Active from hour (0–23, empty = all day)', type: 'number', step: 1, min: 0, max: 23 },
    { name: 'active_to_hour', label: 'Active until hour (1–24)', type: 'number', step: 1, min: 1, max: 24 },
    { name: 'enabled', label: 'Enabled', type: 'checkbox', value: true },
  ],
  create: (v) => post('/automation-rules', v),
  editFields: () => [
    { name: 'name', label: 'Name' },
    { name: 'condition', label: 'Condition', type: 'select', options: [{ value: 'ABOVE_MAX', label: 'Above maximum' }, { value: 'BELOW_MIN', label: 'Below minimum' }] },
    { name: 'action', label: 'Action', type: 'select', options: ['ON', 'OFF'] },
    { name: 'hysteresis', label: 'Hysteresis', type: 'number', step: 'any' },
    { name: 'active_from_hour', label: 'Active from hour (empty = all day)', type: 'number', step: 1, nullable: true },
    { name: 'active_to_hour', label: 'Active until hour', type: 'number', step: 1, nullable: true },
    { name: 'enabled', label: 'Enabled', type: 'checkbox' },
  ],
  update: (r, v) => put(`/automation-rules/${r.id}`, v),
});
main.appendChild(rules.section);
