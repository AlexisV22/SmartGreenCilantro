// Alert, severity and anomaly-detection parameters (US-12, US-19).

import { boot } from '../layout.js';
import { h } from '../ui.js';
import { paramsEditor } from '../params.js';

const { main } = await boot({
  roles: ['Administrator', 'SuperAdministrator'], active: 'alert-settings', title: 'Alert & severity parameters',
  subtitle: 'How deviations are classified and how unusual readings are detected.',
});

main.append(
  h('section', { class: 'card' }, h('h2', {}, 'ℹ How severity works'),
    h('p', {}, 'The deviation of a reading outside its threshold is measured as a percentage of the optimal range (max − min). '
      + 'Up to the LOW limit the alert is LOW, up to the MEDIUM limit it is MEDIUM, and above it HIGH. '
      + 'An open alert is upgraded automatically if the deviation keeps growing.'),
    h('p', { class: 'small muted' }, 'Example with soil moisture 60–80 % (range 20 points): 58 % deviates 10 % → LOW; 56 % → 20 % → MEDIUM; 54 % → 30 % → HIGH.')),
  paramsEditor({
    title: 'Severity classification', icon: '⚠',
    filter: (k) => k.startsWith('severity.'),
  }),
  paramsEditor({
    title: 'Anomaly detection', icon: '⚡',
    description: 'Limits used to flag readings as out of physical range, sudden jumps, statistical outliers, missing data or flatlines.',
    filter: (k) => k.startsWith('anomaly.'),
  }),
  paramsEditor({
    title: 'Connectivity & commands', icon: '📡',
    filter: (k) => k.startsWith('device.') || k.startsWith('actuator.') || k.startsWith('command.'),
  }));
