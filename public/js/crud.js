// Generic "list + create + edit + activate/deactivate" section used by the
// administration screens. Records are never deleted, only deactivated (US-25).

import { h, clear, table, formDialog, confirmDialog, toast, showError, loading, activeBadge } from './ui.js';

/**
 * opts: {
 *   title, icon, description,
 *   load: async () => rows,
 *   columns: [...table columns],
 *   createFields: [...] | null, create: async (values) => created,
 *   editFields: (row) => [...] | null, update: async (row, values) => updated,
 *   toggle: async (row, active) => void   (optional activate/deactivate)
 *   actions: (row, reload) => [Node]      (optional extra row buttons)
 *   afterCreate: (created) => void        (optional, e.g. show an API key once)
 *   createLabel
 * }
 */
export function crudSection(opts) {
  const body = h('div', {}, loading());
  const createBtn = opts.createFields
    ? h('button', { class: 'primary', onclick: () => createRecord() }, `＋ ${opts.createLabel || 'Add'}`)
    : null;
  const section = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, `${opts.icon || ''} ${opts.title}`), createBtn),
    opts.description ? h('p', { class: 'small muted' }, opts.description) : null,
    body);

  let rows = [];

  async function reload() {
    try {
      rows = await opts.load();
      const columns = [...opts.columns];
      if (opts.editFields || opts.toggle || opts.actions) {
        columns.push({
          label: 'Actions',
          render: (row) => h('div', { class: 'row' },
            opts.editFields ? h('button', { class: 'sm', onclick: () => editRecord(row) }, '✎ Edit') : null,
            opts.toggle ? (row.is_active
              ? h('button', { class: 'sm', onclick: () => toggleRecord(row, false) }, '⏸ Deactivate')
              : h('button', { class: 'sm success', onclick: () => toggleRecord(row, true) }, '▶ Activate')) : null,
            opts.actions ? opts.actions(row, reload) : null),
        });
      }
      clear(body, table(columns, rows, { empty: opts.empty || 'No records yet.' }));
    } catch (err) {
      clear(body, h('div', { class: 'empty' }, err.message));
    }
  }

  async function createRecord() {
    const created = await formDialog({
      title: `${opts.createLabel || 'Add'}`, fields: opts.createFields, submitText: 'Create', onSubmit: opts.create,
    });
    if (created) {
      toast('Record created.');
      if (opts.afterCreate) await opts.afterCreate(created);
      reload();
    }
  }

  async function editRecord(row) {
    const updated = await formDialog({
      title: `Edit ${row.name || row.email || row.id}`, fields: opts.editFields(row), values: row, submitText: 'Save changes',
      onSubmit: (values) => opts.update(row, values),
    });
    if (updated) { toast('Changes saved.'); reload(); }
  }

  async function toggleRecord(row, active) {
    const ok = await confirmDialog({
      title: active ? 'Activate record?' : 'Deactivate record?',
      message: active
        ? `${row.name || row.email || row.id} will be active again.`
        : `${row.name || row.email || row.id} will be deactivated. Its history is kept; nothing is deleted.`,
      confirmText: active ? 'Activate' : 'Deactivate', danger: !active,
    });
    if (!ok) return;
    try { await opts.toggle(row, active); toast(active ? 'Record activated.' : 'Record deactivated.'); reload(); } catch (err) { showError(err); }
  }

  reload();
  return { section, reload };
}

export const activeColumn = { label: 'Status', render: (r) => activeBadge(r.is_active) };
