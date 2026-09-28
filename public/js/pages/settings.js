// Global parameters and security parameters (Super Administrator).

import { get, put } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, fieldInput, toast, loading, fmtDate } from '../ui.js';
import { paramsEditor } from '../params.js';

const { main } = await boot({
  roles: ['SuperAdministrator'], active: 'settings', title: 'Global & security parameters',
  subtitle: 'Platform-wide configuration. Every change is recorded in the activity log.',
});

const SECURITY = [
  { name: 'session_hours', label: 'Session length (hours)', type: 'number', step: 1, min: 1, max: 72 },
  { name: 'password_min_length', label: 'Minimum password length', type: 'number', step: 1, min: 6, max: 128 },
  { name: 'password_require_upper', label: 'Require an uppercase letter', type: 'checkbox' },
  { name: 'password_require_digit', label: 'Require a digit', type: 'checkbox' },
  { name: 'password_require_symbol', label: 'Require a symbol', type: 'checkbox' },
  { name: 'max_login_attempts', label: 'Failed login attempts before blocking', type: 'number', step: 1, min: 1 },
  { name: 'login_window_minutes', label: 'Login attempt window (minutes)', type: 'number', step: 1, min: 1 },
];

const secSlot = h('section', { class: 'card' }, loading());
main.append(secSlot, paramsEditor({ title: 'Global parameters', icon: '🧩', description: 'All key/value parameters of the platform.' }));

async function loadSecurity() {
  const cfg = await get('/settings/security');
  const inputs = {};
  const err = h('div', { class: 'form-error', role: 'alert' });
  const fields = SECURITY.map((f) => {
    inputs[f.name] = fieldInput(f, cfg[f.name]);
    return f.type === 'checkbox'
      ? h('div', { class: 'field' }, h('label', { class: 'check' }, inputs[f.name], f.label))
      : h('div', { class: 'field' }, h('label', { for: `f-${f.name}` }, f.label), inputs[f.name]);
  });
  const save = async () => {
    err.textContent = '';
    const body = {};
    for (const f of SECURITY) body[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : Number(inputs[f.name].value);
    try { await put('/settings/security', body); toast('Security parameters saved.'); loadSecurity(); } catch (e) {
      err.textContent = [e.message, ...(e.details || []).map((d) => `${d.field}: ${d.issue}`)].join(' ');
    }
  };
  clear(secSlot, h('div', { class: 'card-head' }, h('h2', {}, '🔒 Security parameters'), h('span', { class: 'small muted' }, `Last change ${fmtDate(cfg.updated_at)}`)),
    h('div', { class: 'grid cols-3' }, fields), err, h('button', { class: 'primary', onclick: save }, '💾 Save security parameters'));
}
loadSecurity();
