// User management (US-22, FR-04). The Administrator manages producers of its
// organization; the Super Administrator manages every user (US-23).

import { get, post, put, patch } from '../api.js';
import { boot, ROLE_LABEL } from '../layout.js';
import { h, fmtDate, badge } from '../ui.js';
import { crudSection, activeColumn } from '../crud.js';

const { me, main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'users', title: 'Producers & users',
  subtitle: 'Create, edit and deactivate accounts. Accounts are never deleted, so their history is preserved.',
});

const isSA = me.role === 'SuperAdministrator';
const roles = isSA ? ['Producer', 'Administrator', 'SuperAdministrator'] : ['Producer'];
const orgs = isSA ? await get('/organizations') : [];
const PASSWORD_HELP = 'At least 8 characters with an uppercase letter, a digit and a symbol (for example Cilantro#2026).';

const { section } = crudSection({
  title: isSA ? 'All users' : 'Producers', icon: '👥', createLabel: isSA ? 'New user' : 'New producer',
  load: () => get('/users', isSA ? {} : { role: 'Producer' }),
  columns: [
    { label: 'Name', render: (u) => h('div', {}, h('strong', {}, u.full_name || u.username), h('div', { class: 'small muted' }, u.username)) },
    { label: 'Email', key: 'email' },
    { label: 'Role', render: (u) => badge(u.role_name === 'Producer' ? 'ok' : 'info', ROLE_LABEL[u.role_name] || u.role_name, '👤') },
    activeColumn,
    { label: 'Last login', render: (u) => fmtDate(u.last_login) },
  ],
  createFields: [
    { name: 'full_name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'username', label: 'Username', required: true, help: 'At least 3 characters.' },
    { name: 'password', label: 'Initial password', type: 'password', required: true, help: PASSWORD_HELP },
    { name: 'role', label: 'Role', type: 'select', options: roles.map((r) => ({ value: r, label: ROLE_LABEL[r] })), value: 'Producer' },
    isSA ? { name: 'organization_id', label: 'Organization', type: 'select', options: orgs.map((o) => ({ value: o.id, label: o.name })), value: me.organization_id } : null,
  ].filter(Boolean),
  create: (v) => post('/users', v),
  editFields: (u) => [
    { name: 'full_name', label: 'Full name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'username', label: 'Username' },
    { name: 'password', label: 'New password (leave empty to keep the current one)', type: 'password', value: '', help: PASSWORD_HELP },
    isSA ? { name: 'role', label: 'Role', type: 'select', options: roles.map((r) => ({ value: r, label: ROLE_LABEL[r] })), value: u.role_name } : null,
  ].filter(Boolean),
  update: (u, v) => put(`/users/${u.id}`, v),
  toggle: (u, active) => patch(`/users/${u.id}/status`, { is_active: active }),
});
main.appendChild(section);
