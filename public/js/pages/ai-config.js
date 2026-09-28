// AI configuration (US-20, US-21): weights, decision threshold, schedule and
// the optional LLM rewording of explanations.

import { get, put, post } from '../api.js';
import { boot } from '../layout.js';
import { h, clear, fieldInput, toast, showError, loading, fmtDate } from '../ui.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'ai', title: 'AI configuration',
  subtitle: 'The recommender is explainable: a weighted score of simple factors, never a black box.',
});

const GROUPS = [
  ['Weights of the irrigation-need score (points out of 100)', [
    { name: 'weight_moisture_deficit', label: 'Soil moisture deficit' },
    { name: 'weight_temperature', label: 'Temperature above the optimum' },
    { name: 'weight_humidity', label: 'Low relative humidity' },
    { name: 'weight_trend', label: 'Falling moisture trend' },
    { name: 'weight_time_since_irrigation', label: 'Time since the last irrigation' },
    { name: 'penalty_recent_irrigation', label: 'Penalty for a recent irrigation' },
  ]],
  ['Decision rules', [
    { name: 'irrigate_score_threshold', label: 'Score needed to recommend irrigating', help: 'Default 60.' },
    { name: 'sensor_disagreement_pct', label: 'Soil sensor disagreement that triggers CHECK_SENSOR (%)' },
    { name: 'duration_factor', label: 'Duration factor (minutes per % of deficit)' },
    { name: 'schedule_minutes', label: 'Run every (minutes)' },
  ]],
  ['Language model (optional)', [
    { name: 'llm_enabled', label: 'Reword explanations with Claude when ANTHROPIC_API_KEY is configured', type: 'checkbox' },
    { name: 'llm_model', label: 'Model', type: 'text', help: 'Without a key, or on any error, the deterministic template is used.' },
  ]],
];

const slot = h('div', {}, loading());
main.appendChild(slot);

async function load() {
  try {
    const cfg = await get('/ai/config');
    const inputs = {};
    const err = h('div', { class: 'form-error', role: 'alert' });
    const sections = GROUPS.map(([title, fields]) => h('section', { class: 'card' }, h('h2', {}, title),
      h('div', { class: 'grid cols-3' }, fields.map((f) => {
        const field = { type: 'number', step: 'any', ...f };
        inputs[f.name] = { f: field, input: fieldInput(field, cfg[f.name]) };
        return field.type === 'checkbox'
          ? h('div', { class: 'field' }, h('label', { class: 'check' }, inputs[f.name].input, f.label))
          : h('div', { class: 'field' }, h('label', { for: `f-${f.name}` }, f.label), inputs[f.name].input, f.help ? h('div', { class: 'help' }, f.help) : null);
      }))));

    const save = async () => {
      err.textContent = '';
      const body = {};
      for (const [name, { f, input }] of Object.entries(inputs)) {
        if (f.type === 'checkbox') body[name] = input.checked;
        else if (f.type === 'text') body[name] = input.value.trim();
        else if (input.value !== '') body[name] = Number(input.value);
      }
      try { await put('/ai/config', body); toast('AI configuration saved.'); load(); } catch (e) {
        err.textContent = [e.message, ...(e.details || []).map((d) => `${d.field}: ${d.issue}`)].join(' ');
      }
    };

    clear(slot, sections, h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: save }, '💾 Save configuration'),
        h('button', { onclick: load }, 'Cancel'),
        h('button', {
          onclick: async () => {
            try { const out = await post('/recommendations/generate', { force: true }); toast(`${out.filter((o) => o.created).length} recommendation(s) generated with the current configuration.`); } catch (e) { showError(e); }
          },
        }, '🤖 Run now'),
        h('span', { class: 'small muted' }, `Last change ${fmtDate(cfg.updated_at)}`)),
      err));
  } catch (err) { showError(err); }
}
load();
