// Organizations (tenants), managed by the Super Administrator.

import { get, post, put } from '../api.js';
import { boot } from '../layout.js';
import { h } from '../ui.js';
import { crudSection, activeColumn } from '../crud.js';

const { main } = await boot({
  roles: ['SuperAdministrator'], active: 'organizations', title: 'Organizations (tenants)',
  subtitle: 'Each organization owns its greenhouses, devices and users. Administrators only see their own organization.',
});

const { section } = crudSection({
  title: 'Organizations', icon: '🏢', createLabel: 'New organization',
  load: () => get('/organizations'),
  columns: [
    { label: 'Organization', render: (o) => h('div', {}, h('strong', {}, o.name), h('div', { class: 'small muted mono' }, o.id)) },
    { label: 'Contact', key: 'contact_email' },
    { label: 'Greenhouses', class: 'num', key: 'greenhouse_count' },
    { label: 'Users', class: 'num', key: 'user_count' },
    activeColumn,
  ],
  createFields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'contact_email', label: 'Contact email', type: 'email' },
  ],
  create: (v) => post('/organizations', v),
  editFields: () => [{ name: 'name', label: 'Name' }, { name: 'contact_email', label: 'Contact email', type: 'email' }],
  update: (o, v) => put(`/organizations/${o.id}`, v),
  toggle: (o, active) => put(`/organizations/${o.id}`, { is_active: active }),
});
main.appendChild(section);
