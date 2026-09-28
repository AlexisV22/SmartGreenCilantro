// IoT registry (US-25): devices, sensors and actuators. The device API key is
// shown only once, at creation or rotation; the server stores only its hash.

import { get, post, put } from '../api.js';
import { boot } from '../layout.js';
import {
  h, fmtAgo, connectivityBadge, stateBadge, infoDialog, confirmDialog, showError, SENSOR_LABELS, ACTUATOR_LABELS,
} from '../ui.js';
import { crudSection, activeColumn } from '../crud.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'devices', title: 'IoT devices, sensors & actuators',
  subtitle: 'Register the hardware of the greenhouse. Records are deactivated, never deleted.',
});

const [greenhouses, areas] = await Promise.all([get('/greenhouses'), get('/areas')]);
let devices = await get('/devices');
const areaOptions = () => areas.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` }));
const deviceOptions = () => devices.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }));

function showKey(result, title) {
  return infoDialog(title, [
    h('p', {}, h('strong', {}, '⚠ Copy this API key now.'), ' It is shown only once and cannot be recovered; the server keeps only a SHA-256 hash.'),
    h('div', { class: 'keybox', id: 'api-key-value' }, result.api_key),
    h('p', { class: 'small muted', style: { marginTop: '.6rem' } }, `Configure it in the device firmware (secrets.h, DEVICE_API_KEY) for ${result.id || result.device_id}. It is sent in the "apikey" header.`),
  ]);
}

const devSection = crudSection({
  title: 'Devices', icon: '📡', createLabel: 'Register device',
  load: async () => { devices = await get('/devices'); return devices; },
  columns: [
    { label: 'Device', render: (d) => h('div', {}, h('strong', {}, d.name), h('div', { class: 'small muted mono' }, `${d.id} · ${d.mac_address || 'no MAC'}`)) },
    { label: 'Location', render: (d) => `${d.greenhouse_id || '—'} / ${d.area_id || '—'}` },
    { label: 'Connectivity', render: (d) => connectivityBadge(d.connectivity) },
    { label: 'Last seen', render: (d) => fmtAgo(d.last_seen) },
    { label: 'Firmware', key: 'firmware' },
    activeColumn,
  ],
  createFields: [
    { name: 'id', label: 'Identifier', placeholder: 'dev-node-02', help: 'Optional; generated when empty.' },
    { name: 'name', label: 'Name', required: true },
    { name: 'mac_address', label: 'MAC address', placeholder: 'A4:CF:12:89:56:B2' },
    { name: 'location', label: 'Location' },
    { name: 'greenhouse_id', label: 'Greenhouse', type: 'select', options: greenhouses.map((g) => ({ value: g.id, label: g.name })) },
    { name: 'area_id', label: 'Area', type: 'select', options: areaOptions() },
    { name: 'firmware', label: 'Firmware version', placeholder: 'esp32-smartgreen-1.0.0' },
  ],
  create: (v) => post('/devices', v),
  afterCreate: (created) => showKey(created, 'Device registered'),
  editFields: () => [
    { name: 'name', label: 'Name' }, { name: 'location', label: 'Location' },
    { name: 'area_id', label: 'Area', type: 'select', options: areaOptions() }, { name: 'firmware', label: 'Firmware version' },
  ],
  update: (d, v) => put(`/devices/${d.id}`, v),
  toggle: (d, active) => put(`/devices/${d.id}`, { is_active: active }),
  actions: (d) => [h('button', {
    class: 'sm',
    onclick: async () => {
      const ok = await confirmDialog({ title: 'Rotate API key?', message: `The current key of ${d.name} stops working immediately. The device must be reconfigured with the new key.`, confirmText: 'Rotate key', danger: true });
      if (!ok) return;
      try { showKey(await post(`/devices/${d.id}/rotate-key`), 'New API key'); } catch (err) { showError(err); }
    },
  }, '🔑 Rotate key')],
});

const SENSOR_TYPES = Object.keys(SENSOR_LABELS);
const sensorSection = crudSection({
  title: 'Sensors', icon: '🌡', createLabel: 'Register sensor',
  load: () => get('/sensors'),
  columns: [
    { label: 'Sensor', render: (s) => h('div', {}, h('strong', {}, s.name), h('div', { class: 'small muted mono' }, s.id)) },
    { label: 'Type', render: (s) => SENSOR_LABELS[s.type] || s.type },
    { label: 'Device', key: 'device_id' },
    { label: 'Area', key: 'area_id' },
    { label: 'Physical range', render: (s) => `${s.physical_min} – ${s.physical_max} ${s.unit}` },
    activeColumn,
  ],
  createFields: [
    { name: 'id', label: 'Identifier', required: true, placeholder: 'SM-03' },
    { name: 'name', label: 'Name', required: true },
    { name: 'type', label: 'Type', type: 'select', options: SENSOR_TYPES.map((t) => ({ value: t, label: SENSOR_LABELS[t] })) },
    { name: 'unit', label: 'Unit', required: true, placeholder: '% · C · lux · ppm · pH' },
    { name: 'device_id', label: 'Device', type: 'select', options: deviceOptions() },
    { name: 'area_id', label: 'Area', type: 'select', options: areaOptions() },
    { name: 'physical_min', label: 'Physical minimum', type: 'number', step: 'any', required: true },
    { name: 'physical_max', label: 'Physical maximum', type: 'number', step: 'any', required: true },
  ],
  create: (v) => post('/sensors', v),
  editFields: () => [
    { name: 'name', label: 'Name' }, { name: 'unit', label: 'Unit' },
    { name: 'area_id', label: 'Area', type: 'select', options: areaOptions() },
    { name: 'physical_min', label: 'Physical minimum', type: 'number', step: 'any' },
    { name: 'physical_max', label: 'Physical maximum', type: 'number', step: 'any' },
  ],
  update: (s, v) => put(`/sensors/${s.id}`, v),
  toggle: (s, active) => put(`/sensors/${s.id}`, { is_active: active }),
});

const ACT_TYPES = Object.keys(ACTUATOR_LABELS);
const actSection = crudSection({
  title: 'Actuators', icon: '⚙', createLabel: 'Register actuator',
  load: () => get('/actuators'),
  columns: [
    { label: 'Actuator', render: (a) => h('div', {}, h('strong', {}, a.name), h('div', { class: 'small muted mono' }, a.id)) },
    { label: 'Type', render: (a) => ACTUATOR_LABELS[a.type] || a.type },
    { label: 'Device', key: 'device_id' },
    { label: 'Area', key: 'area_id' },
    { label: 'State', render: (a) => stateBadge(a.state) },
    activeColumn,
  ],
  createFields: [
    { name: 'id', label: 'Identifier', required: true, placeholder: 'ACT-FAN-02' },
    { name: 'name', label: 'Name', required: true },
    { name: 'type', label: 'Type', type: 'select', options: ACT_TYPES.map((t) => ({ value: t, label: ACTUATOR_LABELS[t] })) },
    { name: 'device_id', label: 'Device', type: 'select', options: deviceOptions() },
    { name: 'area_id', label: 'Area', type: 'select', options: areaOptions() },
  ],
  create: (v) => post('/actuators', v),
  editFields: () => [{ name: 'name', label: 'Name' }, { name: 'area_id', label: 'Area', type: 'select', options: areaOptions() }],
  update: (a, v) => put(`/actuators/${a.id}`, v),
  toggle: (a, active) => put(`/actuators/${a.id}`, { is_active: active }),
});

main.append(devSection.section, sensorSection.section, actSection.section);
