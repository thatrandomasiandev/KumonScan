const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

export const api = {
  scan: (qr_code_value, { force = false } = {}) =>
    request('/scan', {
      method: 'POST',
      body: JSON.stringify({ qr_code_value, force }),
    }),

  register: (first_name, last_name) =>
    request('/register', {
      method: 'POST',
      body: JSON.stringify({ first_name, last_name }),
    }),

  getStudents: () => request('/students'),

  getPresent: () => request('/present'),

  getStudentSessions: (id) => request(`/students/${id}/sessions`),

  createStudent: (first_name, last_name) =>
    request('/students', {
      method: 'POST',
      body: JSON.stringify({ first_name, last_name }),
    }),

  deactivateStudent: (id) =>
    request(`/students/${id}/deactivate`, { method: 'PATCH' }),

  getDashboard: () => request('/dashboard'),

  getTime: () => request('/time'),

  getAuthStatus: () => request('/auth/status'),

  login: (password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: () => request('/auth/logout', { method: 'POST' }),
};

export function formatTime(isoString, timezone) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatDate(isoString, timezone) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-US', {
    timeZone: timezone || 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDuration(minutes) {
  if (minutes == null) return '—';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}
