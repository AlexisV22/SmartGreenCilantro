// AI recommendation card (US-20, US-21, US-26).
// Always shows the five elements required by section 11 of the project:
// Recommendation, Reason, Relevant sensor measurements, Confidence, Timestamp.

import { post } from './api.js';
import { h, badge, fmtDate, fmtNum, formDialog, toast, showError } from './ui.js';

export const REC_TYPES = {
  IRRIGATE: { label: 'Irrigate', icon: '🚿', kind: 'info' },
  WAIT: { label: 'Wait', icon: '⏳', kind: 'ok' },
  CHECK_SENSOR: { label: 'Check sensor', icon: '🔧', kind: 'warn' },
  CHECK_WATER: { label: 'Check water', icon: '🛢', kind: 'warn' },
  VENTILATE: { label: 'Ventilate', icon: '🌀', kind: 'info' },
};

export function recStatusBadge(status) {
  if (status === 'PENDING') return badge('info', 'Pending decision', '⏳');
  if (status === 'ACCEPTED') return badge('ok', 'Accepted');
  if (status === 'REJECTED') return badge('danger', 'Rejected');
  return badge('neutral', 'Expired', '⌛');
}

function measurementList(rec) {
  const items = rec.relevant_measurements || [];
  if (!items.length) return '—';
  return h('ul', { style: { margin: 0, paddingLeft: '1.1rem' } }, items.map((m) => {
    const parts = [`${m.label}: ${fmtNum(m.value)} ${m.unit || ''}`];
    if (m.range) parts.push(`(optimal ${m.range.min}–${m.range.max} ${m.unit || ''})`);
    if (m.target !== undefined) parts.push(`target ${m.target} ${m.unit || ''}`);
    return h('li', {}, parts.join(' '));
  }));
}

function confidence(rec) {
  const pct = Math.round(Number(rec.confidence) * 100);
  const text = rec.confidence_text || 'Medium';
  const icon = text === 'High' ? '✔' : text === 'Medium' ? '■' : '⚠';
  return h('div', {},
    h('div', { class: 'row' }, h('strong', {}, `${icon} ${text}`), h('span', { class: 'muted small' }, `${pct} % data confidence`)),
    h('div', { class: `confbar ${text}`, role: 'meter', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Confidence' },
      h('span', { style: { width: `${pct}%` } })));
}

function whyList(rec) {
  const factors = rec.factors || [];
  const inputs = rec.inputs || {};
  return h('details', { class: 'why' },
    h('summary', {}, 'Why? Show the factors behind this recommendation'),
    factors.length
      ? h('ul', {}, factors.map((f) => h('li', {}, `${f.label}: contributes ${fmtNum(f.contribution)} points`
        + (f.value !== undefined ? ` (value ${fmtNum(f.value)} ${f.unit || ''})` : '')
        + (f.hours !== undefined ? ` (${fmtNum(f.hours)} h)` : ''))))
      : h('p', { class: 'small muted' }, 'No factor pushed the irrigation-need score up.'),
    h('p', { class: 'small muted' },
      `Irrigation-need score ${fmtNum(rec.score)} / 100 · sensor agreement ${fmtNum((inputs.sensor_agreement ?? 0) * 100, 0)} % · `
      + `data completeness ${fmtNum((inputs.data_completeness ?? 0) * 100, 0)} % · anomalies in the last hour: ${inputs.anomaly_count_last_hour ?? 0}`));
}

/** Render one recommendation. `onDecided` is called after Accept/Reject succeeds. */
export function recommendationCard(rec, { canDecide = false, onDecided } = {}) {
  const t = REC_TYPES[rec.type] || { label: rec.type, icon: '🤖', kind: 'info' };

  const decide = async (decision) => {
    const accepting = decision === 'ACCEPTED';
    const extra = accepting && rec.type === 'IRRIGATE' && rec.recommended_duration_min
      ? ` An irrigation command of ${rec.recommended_duration_min} min will be sent to the pump.` : '';
    const result = await formDialog({
      title: accepting ? 'Accept recommendation' : 'Reject recommendation',
      submitText: accepting ? '✔ Accept' : '✖ Reject',
      fields: [{
        name: 'comment', label: accepting ? 'Comment (optional)' : 'Reason for rejecting (optional)', type: 'textarea', rows: 3,
        help: `${rec.recommendation}${extra}`,
      }],
      onSubmit: (values) => post(`/recommendations/${rec.id}/decision`, { decision, comment: values.comment || undefined }),
    });
    if (result) {
      toast(accepting ? `Recommendation accepted.${result.command ? ' Irrigation command sent.' : ''}` : 'Recommendation rejected.');
      if (onDecided) onDecided(result);
    }
  };

  const actions = canDecide && rec.status === 'PENDING'
    ? h('div', { class: 'row' },
      h('button', { class: 'success', onclick: () => decide('ACCEPTED').catch(showError) }, '✔ Accept'),
      h('button', { class: 'danger', onclick: () => decide('REJECTED').catch(showError) }, '✖ Reject'))
    : null;

  return h('article', { class: `card rec ${rec.type}` },
    h('div', { class: 'card-head' },
      h('h3', {}, `${t.icon} ${t.label}`),
      h('div', { class: 'row' },
        rec.recommended_duration_min ? badge('info', `${rec.recommended_duration_min} min`, '⏱') : null,
        recStatusBadge(rec.status))),
    h('dl', {},
      h('dt', {}, 'Recommendation'), h('dd', {}, h('strong', {}, rec.recommendation)),
      h('dt', {}, 'Reason'), h('dd', {}, rec.reason),
      h('dt', {}, 'Relevant measurements'), h('dd', {}, measurementList(rec)),
      h('dt', {}, 'Confidence'), h('dd', {}, confidence(rec)),
      h('dt', {}, 'Timestamp'), h('dd', {}, fmtDate(rec.created_at)),
      rec.decided_at ? [h('dt', {}, 'Decision'), h('dd', {}, `${rec.status} · ${fmtDate(rec.decided_at)}${rec.decision_comment ? ` · “${rec.decision_comment}”` : ''}`)] : null),
    whyList(rec),
    actions ? h('div', { style: { marginTop: '.8rem' } }, actions) : null);
}
