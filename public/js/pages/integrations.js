// External integrations (email/SMTP, webhooks, weather API…), Super Administrator only.

import { get, post, put } from '../api.js';
import { boot } from '../layout.js';
import { h, badge, fmtDate } from '../ui.js';
import { crudSection } from '../crud.js';

const { main } = await boot({
  roles: ['SuperAdministrator'], active: 'integrations', title: 'Integrations',
  subtitle: 'Connections with external services. Store secrets as environment variables, not here.',
});

const { section } = crudSection({
  title: 'Integrations', icon: '🔌', createLabel: 'New integration',
  load: () => get('/integrations'),
  columns: [
    { label: 'Name', render: (i) => h('strong', {}, i.name) },
    { label: 'Type', key: 'type' },
    { label: 'Configuration', render: (i) => h('span', { class: 'mono small' }, JSON.stringify(i.config || {}).slice(0, 120)) },
    { label: 'Status', render: (i) => (i.enabled ? badge('ok', 'Enabled') : badge('neutral', 'Disabled', '○')) },
    { label: 'Updated', render: (i) => fmtDate(i.updated_at) },
  ],
  createFields: [
    { name: 'name', label: 'Name', required: true, placeholder: 'weather-api' },
    { name: 'type', label: 'Type', required: true, placeholder: 'email · webhook · weather' },
    { name: 'config', label: 'Configuration (JSON)', type: 'json', rows: 5, value: { url: 'https://example.org/hook' } },
    { name: 'enabled', label: 'Enabled', type: 'checkbox' },
  ],
  create: (v) => post('/integrations', v),
  editFields: () => [
    { name: 'type', label: 'Type' },
    { name: 'config', label: 'Configuration (JSON)', type: 'json', rows: 5 },
    { name: 'enabled', label: 'Enabled', type: 'checkbox' },
  ],
  update: (i, v) => put(`/integrations/${i.id}`, v),
});
main.appendChild(section);
