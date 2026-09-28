// Crop observations: the producer records field notes per cultivation area.

import { get, post } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, fmtDate, toast, showError, loading } from '../ui.js';

const { me, main } = await boot({ active: 'observations', title: 'Crop observations', subtitle: 'Notes about the crop: pests, leaf colour, harvest, manual work…' });

const areas = await get('/areas');
const areaSel = h('select', { id: 'o-area' }, areas.map((a) => h('option', { value: a.id }, `${a.name} (${a.id})`)));
const note = h('textarea', { id: 'o-note', rows: 4, placeholder: 'Example: yellow leaves on the north bed; applied organic fertiliser.' });
const errorBox = h('div', { class: 'form-error', role: 'alert' });
const listSlot = h('div', {}, loading());

if (me.can('observations.write')) {
  main.appendChild(h('section', { class: 'card' },
    h('h2', {}, '📝 New observation'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.textContent = '';
        try {
          await post('/observations', { area_id: areaSel.value, note: note.value.trim() });
          note.value = '';
          toast('Observation saved.');
          load();
        } catch (err) { errorBox.textContent = err.message + (err.details || []).map((d) => ` ${d.issue || ''}`).join(''); }
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'o-area' }, 'Area'), areaSel),
    h('div', { class: 'field' }, h('label', { for: 'o-note' }, 'Observation'), note),
    errorBox,
    h('button', { class: 'primary', type: 'submit' }, '💾 Save observation'))));
}
main.appendChild(h('section', { class: 'card' }, h('h2', {}, 'Recent observations'), listSlot));

async function load() {
  try {
    const rows = await get('/observations', { limit: 100 });
    clear(listSlot, rows.length ? rows.map((o) => h('div', { style: { padding: '.7rem 0', borderBottom: '1px solid var(--line)' } },
      h('div', { class: 'small muted' }, `${fmtDate(o.created_at)} · ${o.area_name || o.area_id} · ${o.user_name || o.user_email || ''}`),
      h('div', { style: { whiteSpace: 'pre-wrap' } }, o.note)))
      : h('div', { class: 'empty' }, 'No observations recorded yet.'));
  } catch (err) { showError(err); }
}
load();
