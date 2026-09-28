// Recommendation history (US-20, US-21, US-26): every AI recommendation with
// its explanation and the decision taken by the producer.

import { get, post } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, showError, loading, toast } from '../ui.js';
import { recommendationCard } from '../recs.js';

const { me, main, head } = await boot({ active: 'recommendations', title: 'AI recommendations', subtitle: 'Decision support, explained. You always make the final decision.' });

const areas = await get('/areas');
const PAGE = 10;
let offset = 0;
const statusSel = h('select', { id: 'f-status' }, ['', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'].map((v) => h('option', { value: v }, v || 'All statuses')));
const areaSel = h('select', { id: 'f-area' }, h('option', { value: '' }, 'All areas'), areas.map((a) => h('option', { value: a.id }, a.name)));
const field = (label, input) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input);
const listSlot = h('div', { class: 'stack' }, loading());
const pager = h('div', { class: 'pager' });

if (me.can('recommendations.generate')) {
  head.appendChild(h('button', {
    class: 'primary',
    onclick: async () => {
      try {
        const out = await post('/recommendations/generate', { area_id: areaSel.value || undefined, force: true });
        toast(`${out.filter((o) => o.created).length} new recommendation(s) generated.`);
        load();
      } catch (err) { showError(err); }
    },
  }, '🤖 Generate now'));
}

main.append(
  h('section', { class: 'card' }, h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); offset = 0; load(); } },
    field('Status', statusSel), field('Area', areaSel), h('button', { class: 'primary', type: 'submit' }, '🔍 Filter'))),
  listSlot, pager);

async function load() {
  try {
    const rows = await get('/recommendations', { status: statusSel.value, area_id: areaSel.value, limit: PAGE, offset });
    clear(listSlot, rows.length
      ? rows.map((r) => recommendationCard(r, { canDecide: me.can('recommendations.decide'), onDecided: load }))
      : h('div', { class: 'card empty' }, 'No recommendations match these filters.'));
    clear(pager,
      h('button', { class: 'sm', disabled: offset === 0, onclick: () => { offset -= PAGE; load(); } }, '← Newer'),
      h('button', { class: 'sm', disabled: rows.length < PAGE, onclick: () => { offset += PAGE; load(); } }, 'Older →'));
  } catch (err) { showError(err); }
}
load();
