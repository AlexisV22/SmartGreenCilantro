// HTTP client for the SmartGreenAI API.
// Stores the JWT from POST /api/auth/login and sends it as
// "Authorization: Bearer <token>" on every call (US-01-C, FR-01).

const TOKEN_KEY = 'sg_token';
const USER_KEY = 'sg_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Error carrying the standard API error body (status, code, message, details). */
export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || `Request failed (${status})`);
    this.status = status;
    this.code = body && body.code;
    this.details = (body && body.details) || [];
  }
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`/api${path}${buildQuery(query)}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { message: 'The server cannot be reached. Check your connection and try again.' });
  }

  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }

  // Expired or invalid session: go back to the login page (direct URL access is blocked).
  if (res.status === 401 && path !== '/auth/login') {
    clearSession();
    window.location.href = '/?expired=1';
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (path, query) => api(path, { query });
export const post = (path, body) => api(path, { method: 'POST', body: body || {} });
export const put = (path, body) => api(path, { method: 'PUT', body: body || {} });
export const patch = (path, body) => api(path, { method: 'PATCH', body: body || {} });

/** Download a protected file (e.g. the alert CSV export) with the bearer token. */
export async function download(path, query, filename) {
  const res = await fetch(`/api${path}${buildQuery(query)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
