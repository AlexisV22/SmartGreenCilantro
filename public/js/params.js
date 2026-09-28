// Editor for key/value system parameters (GET/PUT /api/settings/global).
// Administrators see the alert/severity/anomaly subset; the Super Administrator sees all.

import { get, put } from './api.js';
import { h, clear, table, fmtDate, toast, showError, loading } from './ui.js';

export function paramsEditor({ title, icon, description, filter = () => true }) {
  const body = h('div', {}, loading());
  const status = h('span', { class: 'small muted' });
  const inputs = new Map();
  let original = {};

  const saveBtn = h('button', { class: 'primary', onclick: save }, '💾 Save changes');
  const resetBtn = h('button', { onclick: load }, 'Cancel');
  const section = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, `${icon || ''} ${title}`), h('div', { class: 'row' }, status, resetBtn, saveBtn)),
    description ? h('p', { class: 'small muted' }, description) : null,
    body);

  async function load() {
    try {
      const rows = (await get('/settings/global')).filter((r) => filter(r.key));
      original = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      inputs.clear();
      clear(body, table([
        { label: 'Parameter', render: (r) => h('span', { class: 'mono' }, r.key) },
        { label: 'Description', key: 'description' },
        {
          label: 'Value',
          render: (r) => {
            const input = h('input', { 'aria-label': r.key, value: r.value, style: { maxWidth: '220px' } });
            input.value = r.value;
            inputs.set(r.key, input);
            return input;
          },
        },
        { label: 'Last change', render: (r) => fmtDate(r.updated_at) },
      ], rows));
      status.textContent = '';
    } catch (err) { showError(err); }
  }

  async function save() {
    const changed = {};
    for (const [key, input] of inputs) {
      const v = input.value.trim();
      if (v !== String(original[key])) {
        if (v === '') { showError({ message: `The value of ${key} cannot be empty.` }); return; }
        changed[key] = Number.isFinite(Number(v)) && key !== 'platform.name' ? Number(v) : v;
      }
    }
    if (!Object.keys(changed).length) { toast('There are no changes to save.', 'info'); return; }
    try {
      await put('/settings/global', { parameters: changed });
      toast(`${Object.keys(changed).length} parameter(s) updated.`);
      load();
    } catch (err) { showError(err); }
  }

  load();
  return section;
}
