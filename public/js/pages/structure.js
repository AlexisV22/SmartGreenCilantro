// Greenhouses, cultivation areas and crop types. Selecting a crop for an area
// auto-configures the thresholds of that area from the crop parameters.

import { get, post, put, patch } from '../api.js';
import { boot } from '../layout.js';
import { h, badge, formDialog, toast, showError } from '../ui.js';
import { crudSection, activeColumn } from '../crud.js';

const { me, main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'structure', title: 'Greenhouses, areas & crops',
  subtitle: 'Physical structure of the operation and the crop types with their optimal parameters.',
});

let greenhouses = await get('/greenhouses');
let crops = await get('/crops');
const orgs = me.role === 'SuperAdministrator' ? await get('/organizations') : [];
const ghOptions = () => greenhouses.map((g) => ({ value: g.id, label: `${g.name} (${g.id})` }));
const cropOptions = () => [{ value: '', label: '— none —' }, ...crops.map((c) => ({ value: c.id, label: c.name }))];

const gh = crudSection({
  title: 'Greenhouses', icon: '🏠', createLabel: 'New greenhouse',
  load: async () => { greenhouses = await get('/greenhouses'); return greenhouses; },
  columns: [
    { label: 'ID', render: (g) => h('span', { class: 'mono' }, g.id) },
    { label: 'Name', key: 'name' },
    { label: 'Location', key: 'location' },
    { label: 'Areas', class: 'num', key: 'area_count' },
    activeColumn,
  ],
  createFields: [
    { name: 'id', label: 'Identifier', required: true, placeholder: 'GH-02' },
    { name: 'name', label: 'Name', required: true },
    { name: 'location', label: 'Location' },
    orgs.length ? { name: 'organization_id', label: 'Organization', type: 'select', options: orgs.map((o) => ({ value: o.id, label: o.name })), value: me.organization_id } : null,
  ].filter(Boolean),
  create: (v) => post('/greenhouses', v),
  editFields: () => [{ name: 'name', label: 'Name' }, { name: 'location', label: 'Location' }],
  update: (g, v) => put(`/greenhouses/${g.id}`, v),
  toggle: (g, active) => put(`/greenhouses/${g.id}`, { is_active: active }),
});

const areas = crudSection({
  title: 'Cultivation areas', icon: '🌱', createLabel: 'New area',
  description: 'Each area works in Manual or Automatic mode. Assigning a crop applies its optimal ranges as the area thresholds.',
  load: () => get('/areas'),
  columns: [
    { label: 'ID', render: (a) => h('span', { class: 'mono' }, a.id) },
    { label: 'Name', key: 'name' },
    { label: 'Greenhouse', key: 'greenhouse_name' },
    { label: 'Crop', render: (a) => `${a.crop_name || '—'} · ${a.crop_stage || ''}` },
    { label: 'Mode', render: (a) => (a.mode === 'AUTOMATIC' ? badge('info', 'Automatic', '⚙') : badge('neutral', 'Manual', '✋')) },
    activeColumn,
  ],
  createFields: [
    { name: 'id', label: 'Identifier', required: true, placeholder: 'AREA-3' },
    { name: 'name', label: 'Name', required: true },
    { name: 'greenhouse_id', label: 'Greenhouse', type: 'select', options: ghOptions() },
    { name: 'crop_type_id', label: 'Crop type', type: 'select', options: cropOptions(), help: 'The thresholds of the new area are configured from the crop.' },
    { name: 'crop_stage', label: 'Crop stage', placeholder: 'vegetative' },
    { name: 'mode', label: 'Mode', type: 'select', options: ['MANUAL', 'AUTOMATIC'], value: 'MANUAL' },
  ],
  create: (v) => post('/areas', v),
  editFields: () => [
    { name: 'name', label: 'Name' },
    { name: 'crop_type_id', label: 'Crop type', type: 'select', options: cropOptions() },
    { name: 'crop_stage', label: 'Crop stage' },
  ],
  update: (a, v) => put(`/areas/${a.id}`, v),
  toggle: (a, active) => put(`/areas/${a.id}`, { is_active: active }),
  actions: (a, reload) => [
    h('button', {
      class: 'sm',
      onclick: async () => {
        const mode = a.mode === 'AUTOMATIC' ? 'MANUAL' : 'AUTOMATIC';
        try { await patch(`/areas/${a.id}/mode`, { mode }); toast(`${a.name} switched to ${mode}.`); reload(); } catch (err) { showError(err); }
      },
    }, a.mode === 'AUTOMATIC' ? '✋ Set manual' : '⚙ Set automatic'),
  ],
});

const RANGES = [
  ['temperature', 'Air temperature (°C)'], ['air_humidity', 'Relative humidity (%)'], ['soil_moisture', 'Soil moisture (%)'],
  ['light', 'Light (lux)'], ['co2', 'CO₂ (ppm)'], ['ph', 'pH'], ['water_level', 'Water tank (%)'],
];
const rangeFields = RANGES.flatMap(([k, label]) => [
  { name: `${k}_min`, label: `${label} — minimum`, type: 'number', step: 'any' },
  { name: `${k}_max`, label: `${label} — maximum`, type: 'number', step: 'any' },
]);

const cropSection = crudSection({
  title: 'Crop types', icon: '🌿', createLabel: 'New crop type',
  load: async () => { crops = await get('/crops'); return crops; },
  columns: [
    { label: 'Crop', render: (c) => h('div', {}, h('strong', {}, c.name), h('div', { class: 'small muted' }, c.description || '')) },
    { label: 'Temperature', render: (c) => `${c.temperature_min}–${c.temperature_max} °C` },
    { label: 'Humidity', render: (c) => `${c.air_humidity_min}–${c.air_humidity_max} %` },
    { label: 'Soil moisture', render: (c) => `${c.soil_moisture_min}–${c.soil_moisture_max} %` },
    { label: 'Light', render: (c) => `${c.light_min}–${c.light_max} lux` },
    { label: 'CO₂', render: (c) => `${c.co2_min}–${c.co2_max} ppm` },
    { label: 'pH', render: (c) => `${c.ph_min}–${c.ph_max}` },
    activeColumn,
  ],
  createFields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
    { name: 'default_crop_stage', label: 'Default stage', value: 'vegetative' },
    ...rangeFields,
  ],
  create: (v) => post('/crops', v),
  editFields: () => [{ name: 'name', label: 'Name' }, { name: 'description', label: 'Description', type: 'textarea', rows: 2 }, ...rangeFields],
  update: (c, v) => put(`/crops/${c.id}`, v),
  toggle: (c, active) => put(`/crops/${c.id}`, { is_active: active }),
  actions: (c) => [h('button', {
    class: 'sm',
    onclick: async () => {
      const areaList = await get('/areas');
      const done = await formDialog({
        title: `Apply ${c.name} to an area`, submitText: 'Apply',
        fields: [{ name: 'area_id', label: 'Area', type: 'select', options: areaList.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` })), help: 'The thresholds of the area are replaced with the optimal ranges of this crop.' }],
        onSubmit: (v) => post(`/crops/${c.id}/apply`, v),
      });
      if (done) { toast(`Thresholds configured from ${c.name}.`); areas.reload(); }
    },
  }, '🎚 Apply to area')],
});

main.append(gh.section, areas.section, cropSection.section);
