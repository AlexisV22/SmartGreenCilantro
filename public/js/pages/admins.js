// Administrator accounts, managed by the Super Administrator (US-23).

import { get, post, put, patch } from '../api.js';
import { boot } from '../layout.js';
import { h, fmtDate } from '../ui.js';
import { crudSection, activeColumn } from '../crud.js';

const { me, main } = await boot({
  roles: ['SuperAdministrator'], active: 'admins', title: 'Administrators',
  subtitle: 'Create administrators for each organization, edit them or deactivate their access.',
});

const orgs = await get('/organizations');
const orgName = (id) => (orgs.find((o) => o.id === id) || {}).name || id;
const PASSWORD_HELP = 'At least 8 characters with an uppercase letter, a digit and a symbol.';

const { section } = crudSection({
  title: 'Administrators', icon: '🛡', createLabel: 'New administrator',
  load: () => get('/admins'),
  columns: [
    { label: 'Name', render: (u) => h('div', {}, h('strong', {}, u.full_name || u.username), h('div', { class: 'small muted' }, u.username)) },
    { label: 'Email', key: 'email' },
    { label: 'Organization', render: (u) => orgName(u.organization_id) },
    activeColumn,
    { label: 'Last login', render: (u) => fmtDate(u.last_login) },
  ],
  createFields: [
    { name: 'full_name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'username', label: 'Username', required: true },
    { name: 'password', label: 'Initial password', type: 'password', required: true, help: PASSWORD_HELP },
    { name: 'organization_id', label: 'Organization', type: 'select', options: orgs.map((o) => ({ value: o.id, label: o.name })), value: me.organization_id },
  ],
  create: (v) => post('/admins', { ...v, role: 'Administrator' }),
  editFields: () => [
    { name: 'full_name', label: 'Full name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'password', label: 'New password (leave empty to keep it)', type: 'password', value: '', help: PASSWORD_HELP },
  ],
  update: (u, v) => put(`/admins/${u.id}`, v),
  toggle: (u, active) => patch(`/users/${u.id}/status`, { is_active: active }),
});
main.appendChild(section);
