// Roles & permissions matrix editor (US-24, FR-02, FR-03).

import { get, post, put } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, formDialog, confirmDialog, toast, showError, loading, badge } from '../ui.js';

const { main, head } = await boot({
  roles: ['SuperAdministrator'], active: 'roles', title: 'Roles & permissions',
  subtitle: 'Tick the permissions of each role and save the column. Changes apply at the next request of each user.',
});

const slot = h('section', { class: 'card' }, loading());
main.appendChild(slot);
head.appendChild(h('button', {
  class: 'primary',
  onclick: async () => {
    const created = await formDialog({
      title: 'New role', submitText: 'Create role',
      fields: [{ name: 'name', label: 'Role name', required: true }, { name: 'description', label: 'Description', type: 'textarea', rows: 2 }],
      onSubmit: (v) => post('/roles', { ...v, permissions: [] }),
    });
    if (created) { toast('Role created. Assign its permissions in the matrix.'); load(); }
  },
}, '＋ New role'));

async function load() {
  try {
    const [roles, perms] = await Promise.all([get('/roles'), get('/roles/permissions')]);
    const checks = new Map(roles.map((r) => [r.id, new Map()]));
    const categories = [...new Set(perms.map((p) => p.category))];

    const tbody = h('tbody');
    for (const cat of categories) {
      tbody.appendChild(h('tr', {}, h('th', { colspan: roles.length + 1, style: { textAlign: 'left' } }, cat)));
      for (const p of perms.filter((x) => x.category === cat)) {
        tbody.appendChild(h('tr', {},
          h('td', {}, h('span', { class: 'mono small' }, p.code), h('div', { class: 'small muted' }, p.description)),
          roles.map((r) => {
            const cb = h('input', { type: 'checkbox', 'aria-label': `${r.name}: ${p.code}`, checked: r.permissions.includes(p.code) });
            checks.get(r.id).set(p.code, cb);
            return h('td', {}, cb);
          })));
      }
    }

    const saveRole = async (r) => {
      const selected = [...checks.get(r.id)].filter(([, cb]) => cb.checked).map(([code]) => code);
      const removed = r.permissions.filter((c) => !selected.includes(c));
      if (r.name === 'SuperAdministrator' && removed.some((c) => c.startsWith('roles.'))) {
        const ok = await confirmDialog({ title: 'Remove role management?', message: 'The Super Administrator could lose access to this screen.', confirmText: 'Save anyway', danger: true });
        if (!ok) return;
      }
      try { await put(`/roles/${r.id}/permissions`, { permissions: selected }); toast(`Permissions of ${r.name} saved (${selected.length}).`); load(); } catch (err) { showError(err); }
    };

    clear(slot, h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
      h('thead', {},
        h('tr', {}, h('th', {}, 'Permission'), roles.map((r) => h('th', {}, r.name, h('div', { class: 'small muted', style: { textTransform: 'none' } }, `${r.user_count} users`), r.is_system ? badge('neutral', 'system', '🔒') : null))),
        h('tr', {}, h('th', {}), roles.map((r) => h('th', {}, h('button', { class: 'sm primary', onclick: () => saveRole(r) }, '💾 Save'))))),
      tbody)));
  } catch (err) { showError(err); }
}
load();
