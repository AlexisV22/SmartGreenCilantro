// Login page (US-01-C, FR-01): authenticates and sends each role to its home.
import { api, setSession, getToken, getStoredUser } from '../api.js';
import { HOME } from '../layout.js';

const form = document.getElementById('login-form');
const msg = document.getElementById('login-msg');
const btn = document.getElementById('login-btn');
const params = new URLSearchParams(location.search);

function show(kind, text) {
  msg.className = `banner ${kind}`;
  msg.textContent = text;
}

if (params.get('expired')) show('warn', '⚠ Your session has ended. Please sign in again.');

// Already signed in: go straight to the role home page.
const stored = getStoredUser();
if (getToken() && stored && HOME[stored.role] && !params.get('expired')) {
  location.replace(HOME[stored.role]);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) { show('danger', '✖ Enter your email (or username) and your password.'); return; }

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const result = await api('/auth/login', { method: 'POST', body: { email, password } });
    setSession(result.access_token, result.user);
    const next = params.get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : (HOME[result.user.role] || '/');
  } catch (err) {
    // The API answers with a generic message: it never reveals whether the account exists.
    show('danger', `✖ ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});
