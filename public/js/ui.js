// Small DOM and formatting helpers shared by every page (no framework, no build step).

/** Create an element: h('div', { class: 'card', onclick: fn }, child, 'text', ...). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) { el.innerHTML = ''; append(el, children); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Formatting ----------
export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function fmtDay(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, { month: 'short', day: '2-digit', timeZone: 'UTC' });
}
export function fmtAgo(v) {
  if (!v) return 'never';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
export function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export const SENSOR_LABELS = {
  soil_moisture: 'Soil moisture', temperature: 'Air temperature', air_humidity: 'Relative humidity',
  light: 'Light intensity', co2: 'CO₂', water_level: 'Water tank level', ph: 'Soil pH',
};
export const SENSOR_ICONS = {
  soil_moisture: '💧', temperature: '🌡', air_humidity: '☁', light: '☀', co2: '🫧', water_level: '🛢', ph: '⚗',
};
export const ACTUATOR_LABELS = {
  irrigation_pump: 'Irrigation pump', ventilation_fan: 'Ventilation fan', shade: 'Shade system', lighting: 'Auxiliary lighting',
};
export const ACTUATOR_ICONS = { irrigation_pump: '🚿', ventilation_fan: '🌀', shade: '⛱', lighting: '💡' };
export function unitLabel(u) { return u === 'C' ? '°C' : u; }

// ---------- Status badges: colour + icon + text ----------
const ICON = { ok: '✔', warn: '⚠', danger: '✖', info: 'ℹ', neutral: '●' };
export function badge(kind, text, icon) {
  return h('span', { class: `badge ${kind}` }, h('span', { 'aria-hidden': 'true' }, icon || ICON[kind] || '●'), text);
}

/** Classify a value against its threshold: returns { kind, text }. */
export function rangeStatus(value, min, max) {
  if (value === null || value === undefined || min === null || min === undefined) return { kind: 'neutral', text: 'No threshold' };
  if (value < min) return { kind: 'warn', text: 'Below range' };
  if (value > max) return { kind: 'warn', text: 'Above range' };
  return { kind: 'ok', text: 'In range' };
}
export function severityBadge(sev) {
  if (sev === 'HIGH') return badge('danger', 'High', '▲');
  if (sev === 'MEDIUM') return badge('warn', 'Medium', '■');
  return badge('info', 'Low', '▼');
}
export function alertStatusBadge(st) {
  if (st === 'OPEN') return badge('danger', 'Open', '!');
  if (st === 'ACKNOWLEDGED') return badge('warn', 'Acknowledged', '👁');
  return badge('ok', 'Resolved');
}
export function stateBadge(state) {
  if (state === 'ON') return badge('ok', 'ON', '⏻');
  if (state === 'OFF') return badge('neutral', 'OFF', '○');
  return badge('danger', 'OFFLINE', '⚡');
}
export function activeBadge(active) { return active ? badge('ok', 'Active') : badge('neutral', 'Inactive', '○'); }
export function connectivityBadge(c) { return c === 'ONLINE' ? badge('ok', 'Online', '📶') : badge('danger', 'Offline', '⚡'); }

// ---------- Toasts ----------
function toastHost() {
  let host = document.querySelector('.toasts');
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
  return host;
}
export function toast(message, type = 'ok') {
  const t = h('div', { class: `toast ${type}` }, message);
  toastHost().appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 4000);
}
export function showError(err) {
  const details = (err.details || []).map((d) => d.message || d.issue || JSON.stringify(d)).filter(Boolean);
  toast(details.length ? `${err.message} ${details.join(' ')}` : err.message, 'error');
}

// ---------- Modal dialogs ----------
function openModal(title, bodyNodes, buttons) {
  return new Promise((resolve) => {
    const close = (value) => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const footer = h('footer', {}, buttons.map((b) => h('button', {
      class: b.class || '', type: b.type || 'button', onclick: () => b.onClick(close),
    }, b.label)));
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title)), h('div', { class: 'body' }, bodyNodes), footer);
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(null); } }, modal);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    const first = modal.querySelector('input, select, textarea, button.primary');
    if (first) first.focus();
  });
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return openModal(title, [h('p', {}, message)], [
    { label: 'Cancel', onClick: (close) => close(false) },
    { label: confirmText, class: danger ? 'danger' : 'primary', onClick: (close) => close(true) },
  ]).then((v) => v === true);
}

export function infoDialog(title, nodes) {
  return openModal(title, nodes, [{ label: 'Close', class: 'primary', onClick: (close) => close(true) }]);
}

/**
 * Form dialog. fields: [{ name, label, type, options, required, step, help, value, min, max }]
 * `onSubmit(values)` may throw an ApiError; its message and field details are shown inline.
 */
export function formDialog({ title, fields, values = {}, submitText = 'Save', onSubmit }) {
  const inputs = {};
  const errorBox = h('div', { class: 'form-error', role: 'alert' });
  const form = h('form', { novalidate: true }, fields.map((f) => {
    const input = fieldInput(f, values[f.name] !== undefined ? values[f.name] : f.value);
    inputs[f.name] = { f, input };
    if (f.type === 'checkbox') {
      return h('div', { class: 'field' }, h('label', { class: 'check' }, input, f.label), f.help ? h('div', { class: 'help' }, f.help) : null);
    }
    return h('div', { class: 'field' }, h('label', { for: `f-${f.name}` }, f.label, f.required ? ' *' : ''), input,
      f.help ? h('div', { class: 'help' }, f.help) : null, h('div', { class: 'error', 'data-err': f.name }));
  }), errorBox);

  const collect = () => {
    const out = {};
    for (const [name, { f, input }] of Object.entries(inputs)) {
      if (f.type === 'checkbox') out[name] = input.checked;
      else if (f.type === 'number') { if (input.value !== '') out[name] = Number(input.value); else if (f.nullable) out[name] = null; }
      else if (f.type === 'json') { out[name] = input.value.trim() ? JSON.parse(input.value) : {}; }
      else if (input.value !== '' || f.keepEmpty) out[name] = input.value;
    }
    return out;
  };

  return openModal(title, [form], [
    { label: 'Cancel', onClick: (close) => close(null) },
    {
      label: submitText, class: 'primary', onClick: async (close) => {
        errorBox.textContent = '';
        form.querySelectorAll('[data-err]').forEach((e) => { e.textContent = ''; });
        const missing = fields.filter((f) => f.required && f.type !== 'checkbox' && !inputs[f.name].input.value.trim());
        if (missing.length) { errorBox.textContent = `Please complete: ${missing.map((m) => m.label).join(', ')}.`; return; }
        let data;
        try { data = collect(); } catch { errorBox.textContent = 'The JSON configuration is not valid.'; return; }
        try {
          const result = onSubmit ? await onSubmit(data) : data;
          close(result === undefined ? data : result);
        } catch (err) {
          errorBox.textContent = err.message;
          for (const d of err.details || []) {
            const slot = d.field && form.querySelector(`[data-err="${d.field}"]`);
            if (slot) slot.textContent = d.message || d.issue || '';
          }
        }
      },
    },
  ]);
}

export function fieldInput(f, value) {
  const id = `f-${f.name}`;
  if (f.type === 'select') {
    return h('select', { id, name: f.name }, (f.options || []).map((o) => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return h('option', { value: opt.value, selected: String(opt.value) === String(value ?? '') }, opt.label);
    }));
  }
  if (f.type === 'checkbox') return h('input', { id, type: 'checkbox', name: f.name, checked: Boolean(value) });
  if (f.type === 'textarea' || f.type === 'json') {
    const t = h('textarea', { id, name: f.name, rows: f.rows || 4 });
    t.value = f.type === 'json' ? JSON.stringify(value || {}, null, 2) : (value ?? '');
    return t;
  }
  const input = h('input', {
    id, name: f.name, type: f.type || 'text', step: f.step, min: f.min, max: f.max,
    placeholder: f.placeholder, autocomplete: f.type === 'password' ? 'new-password' : 'off',
  });
  input.value = value ?? '';
  return input;
}

// ---------- Tables ----------
/**
 * columns: [{ label, key, render(row) -> Node|string, class }]
 */
export function table(columns, rows, { empty = 'No records found.' } = {}) {
  if (!rows || !rows.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.class || '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.class || '' },
      c.render ? c.render(r) : (r[c.key] ?? '—'))))))));
}

export function loading(text = 'Loading…') { return h('div', { class: 'empty' }, text); }

/** Periodic refresh that pauses while the tab is hidden (dashboard auto-refresh, 30 s). */
export function every(ms, fn) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  return () => clearInterval(id);
}

export function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }
export function toIsoOrUndefined(dateInputValue, endOfDay = false) {
  if (!dateInputValue) return undefined;
  return new Date(`${dateInputValue}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();
}
