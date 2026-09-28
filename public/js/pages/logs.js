// System logs and user activity (FR-21). Administrators see their organization;
// the Super Administrator sees the whole platform.

import { get } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, table, fmtDate, badge, showError, loading, toIsoOrUndefined } from '../ui.js';

const { me, main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'logs', title: 'System & activity logs',
  subtitle: ' ',
});
main.querySelector('.page-head p').textContent = me.role === 'SuperAdministrator'
  ? 'Global logs of the whole platform.' : 'Logs of your organization.';

const PAGE = 50;
let tab = 'audit';
let offset = 0;
const tabs = h('div', { class: 'tabs', role: 'tablist' },
  h('button', { 'data-tab': 'audit', onclick: () => switchTab('audit') }, '👤 User activity'),
  h('button', { 'data-tab': 'system', onclick: () => switchTab('system') }, '🖥 System log'));
const filters = h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); offset = 0; load(); } });
const slot = h('div', {}, loading());
const pager = h('div', { class: 'pager' });
main.appendChild(h('section', { class: 'card' }, tabs, filters, slot, pager));

const inputs = {
  level: h('select', { id: 'l-level' }, ['', 'ERROR', 'WARN', 'INFO', 'DEBUG'].map((v) => h('option', { value: v }, v || 'All levels'))),
  source: h('input', { id: 'l-source', placeholder: 'api, alerts, irrigation…' }),
  entity: h('input', { id: 'l-entity', placeholder: 'users, thresholds…' }),
  action: h('input', { id: 'l-action', placeholder: 'LOGIN, UPDATE…' }),
  from: h('input', { id: 'l-from', type: 'date' }),
  to: h('input', { id: 'l-to', type: 'date' }),
};
const field = (label, input) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input);

function switchTab(t) {
  tab = t;
  offset = 0;
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  clear(filters,
    t === 'system' ? [field('Level', inputs.level), field('Source', inputs.source)] : [field('Entity', inputs.entity), field('Action', inputs.action)],
    field('From', inputs.from), field('To', inputs.to), h('button', { class: 'primary', type: 'submit' }, '🔍 Filter'));
  load();
}

const LEVEL = { ERROR: 'danger', WARN: 'warn', INFO: 'info', DEBUG: 'neutral' };
const summarize = (obj) => (obj ? JSON.stringify(obj).slice(0, 160) : '—');

async function load() {
  try {
    const common = { from: toIsoOrUndefined(inputs.from.value), to: toIsoOrUndefined(inputs.to.value, true), limit: PAGE, offset };
    let rows;
    if (tab === 'system') {
      rows = await get('/logs/system', { ...common, level: inputs.level.value, source: inputs.source.value.trim() });
      clear(slot, table([
        { label: 'Date', render: (r) => fmtDate(r.created_at) },
        { label: 'Level', render: (r) => badge(LEVEL[r.level] || 'neutral', r.level) },
        { label: 'Source', key: 'source' },
        { label: 'Message', render: (r) => h('span', { class: 'small' }, r.message) },
      ], rows, { empty: 'No log entries.' }));
    } else {
      rows = await get('/logs/audit', { ...common, entity: inputs.entity.value.trim(), action: inputs.action.value.trim() });
      clear(slot, table([
        { label: 'Date', render: (r) => fmtDate(r.created_at) },
        { label: 'User', render: (r) => r.user_email || 'system' },
        { label: 'Action', render: (r) => badge('info', r.action, '•') },
        { label: 'Entity', render: (r) => `${r.entity}${r.entity_id ? ` · ${r.entity_id}` : ''}` },
        { label: 'Before', render: (r) => h('span', { class: 'small mono' }, summarize(r.before_data)) },
        { label: 'After', render: (r) => h('span', { class: 'small mono' }, summarize(r.after_data)) },
        { label: 'IP', key: 'ip' },
      ], rows, { empty: 'No activity recorded.' }));
    }
    clear(pager,
      h('button', { class: 'sm', disabled: offset === 0, onclick: () => { offset -= PAGE; load(); } }, '← Newer'),
      h('button', { class: 'sm', disabled: rows.length < PAGE, onclick: () => { offset += PAGE; load(); } }, 'Older →'));
  } catch (err) { showError(err); }
}

switchTab('audit');
