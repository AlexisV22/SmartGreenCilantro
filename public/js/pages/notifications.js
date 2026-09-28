// Notification settings of the organization.

import { get, put } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, fieldInput, toast, loading, showError } from '../ui.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'notifications', title: 'Notification settings',
  subtitle: 'Which events are notified and to whom.',
});

const FIELDS = [
  { name: 'dashboard_enabled', label: 'Show alerts on the dashboard (banner and panel)', type: 'checkbox' },
  { name: 'notify_on_recommendation', label: 'Notify when a new AI recommendation is created', type: 'checkbox' },
  { name: 'min_severity', label: 'Minimum severity to notify', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
  { name: 'email_enabled', label: 'Send email notifications (requires an email integration)', type: 'checkbox' },
  { name: 'email_recipients', label: 'Email recipients (comma separated)', type: 'text', keepEmpty: true },
];

const slot = h('section', { class: 'card' }, loading());
main.appendChild(slot);

async function load() {
  try {
    const cfg = await get('/settings/notifications');
    const inputs = {};
    const nodes = FIELDS.map((f) => {
      inputs[f.name] = fieldInput(f, cfg[f.name]);
      return f.type === 'checkbox'
        ? h('div', { class: 'field' }, h('label', { class: 'check' }, inputs[f.name], f.label))
        : h('div', { class: 'field', style: { maxWidth: '480px' } }, h('label', { for: `f-${f.name}` }, f.label), inputs[f.name]);
    });
    const save = async () => {
      const body = {};
      for (const f of FIELDS) {
        body[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : (inputs[f.name].value.trim() || (f.name === 'email_recipients' ? null : inputs[f.name].value));
      }
      try { await put('/settings/notifications', body); toast('Notification settings saved.'); } catch (e) { showError(e); }
    };
    clear(slot, h('h2', {}, '✉ Notifications'), nodes, h('button', { class: 'primary', onclick: save }, '💾 Save'));
  } catch (err) { showError(err); }
}
load();
