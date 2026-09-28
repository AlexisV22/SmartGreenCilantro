// Route guard + page shell (header, role-based navigation, logout).
// Every protected page calls `boot({ roles, active, title })` first: a visitor
// without a valid token, or with the wrong role, never sees the page (US-01-C).

import { get, post, getToken, clearSession, getStoredUser } from './api.js';
import { h, clear } from './ui.js';

export const HOME = {
  Producer: '/producer/',
  Administrator: '/admin/',
  SuperAdministrator: '/superadmin/',
};
export const ROLE_LABEL = {
  Producer: 'Agricultural User (Producer)',
  Administrator: 'Administrator',
  SuperAdministrator: 'Super Administrator',
};

const ALL = ['Producer', 'Administrator', 'SuperAdministrator'];
const ADMINS = ['Administrator', 'SuperAdministrator'];
const SA = ['SuperAdministrator'];

// Navigation: [section, [key, label, icon, href, roles]]
const NAV = [
  ['Crop monitoring', [
    ['dashboard', 'Dashboard', '🏠', '/producer/', ALL],
    ['alerts', 'Alert history', '🔔', '/producer/alerts.html', ALL],
    ['irrigation', 'Irrigation history', '🚿', '/producer/irrigation.html', ALL],
    ['analysis', 'Historical analysis', '📈', '/producer/analysis.html', ALL],
    ['recommendations', 'AI recommendations', '🤖', '/producer/recommendations.html', ALL],
    ['observations', 'Crop observations', '📝', '/producer/observations.html', ALL],
  ]],
  ['Administration', [
    ['admin-home', 'Overview & connectivity', '📊', '/admin/', ADMINS],
    ['users', 'Producers & users', '👥', '/admin/users.html', ADMINS],
    ['structure', 'Greenhouses, areas & crops', '🌱', '/admin/structure.html', ADMINS],
    ['devices', 'IoT devices, sensors & actuators', '📡', '/admin/devices.html', ADMINS],
    ['thresholds', 'Sensor thresholds', '🎚', '/admin/thresholds.html', ADMINS],
    ['alert-settings', 'Alert & severity parameters', '⚠', '/admin/alert-settings.html', ADMINS],
    ['automation', 'Irrigation & automation', '⚙', '/admin/automation.html', ADMINS],
    ['ai', 'AI configuration', '🧠', '/admin/ai.html', ADMINS],
    ['notifications', 'Notification settings', '✉', '/admin/notifications.html', ADMINS],
    ['logs', 'System & activity logs', '📜', '/admin/logs.html', ADMINS],
  ]],
  ['Platform (Super Admin)', [
    ['sa-home', 'Availability', '🩺', '/superadmin/', SA],
    ['admins', 'Administrators', '🛡', '/superadmin/admins.html', SA],
    ['roles', 'Roles & permissions', '🔐', '/superadmin/roles.html', SA],
    ['organizations', 'Organizations (tenants)', '🏢', '/superadmin/organizations.html', SA],
    ['settings', 'Global & security parameters', '🧩', '/superadmin/settings.html', SA],
    ['integrations', 'Integrations', '🔌', '/superadmin/integrations.html', SA],
  ]],
];

export async function logout() {
  try { await post('/auth/logout'); } catch { /* the token may already be invalid */ }
  clearSession();
  window.location.href = '/';
}

/**
 * Validate the session, enforce the allowed roles and render the shell.
 * Returns { me, main } where `main` is the element the page renders into.
 */
export async function boot({ roles = ALL, active, title, subtitle }) {
  if (!getToken()) { window.location.replace('/?next=' + encodeURIComponent(location.pathname)); return new Promise(() => {}); }

  let me;
  try {
    me = await get('/auth/me');
  } catch {
    clearSession();
    window.location.replace('/?expired=1');
    return new Promise(() => {});
  }

  if (!roles.includes(me.role)) {
    window.location.replace(`${HOME[me.role] || '/'}?denied=1`);
    return new Promise(() => {});
  }

  document.title = `${title} · SmartGreenAI`;
  const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Main navigation' });
  for (const [section, items] of NAV) {
    const visible = items.filter((i) => i[4].includes(me.role));
    if (!visible.length) continue;
    sidebar.appendChild(h('div', { class: 'section' }, section));
    for (const [key, label, icon, href] of visible) {
      sidebar.appendChild(h('a', { href, class: key === active ? 'active' : '' },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, icon), label));
    }
  }

  const main = h('main', { id: 'main' });
  const header = h('header', { class: 'topbar' },
    h('button', { class: 'menu-toggle', 'aria-label': 'Open menu', onclick: () => sidebar.classList.toggle('open') }, '☰'),
    h('div', { class: 'brand' }, h('span', { class: 'leaf', 'aria-hidden': 'true' }, '🌿'), 'SmartGreenAI · Cilantro Crop'),
    h('div', { class: 'spacer' }),
    h('div', { class: 'who' }, me.full_name || me.username, h('small', {}, ROLE_LABEL[me.role] || me.role)),
    h('button', { onclick: logout, title: 'Sign out' }, '⎋ Logout'));

  clear(document.body, header, h('div', { class: 'layout' }, sidebar, main));

  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null));
  main.appendChild(head);

  if (new URLSearchParams(location.search).get('denied')) {
    main.appendChild(h('div', { class: 'banner warn', role: 'alert' }, '⚠ You do not have permission to open that page. You were redirected to your home page.'));
  }

  me.can = (perm) => (me.permissions || []).includes(perm);
  return { me, main, head };
}

export function cachedUser() { return getStoredUser(); }
