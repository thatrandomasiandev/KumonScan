import { DEFAULT_CENTER_SLUG } from './centerPath';

/**
 * API base is rebuilt whenever the active center slug changes (see
 * setCenterSlug). Every request goes through `/api/c/:centerSlug/...` so the
 * server resolves tenancy from the path, not from a cookie or header.
 */
let activeCenterSlug = DEFAULT_CENTER_SLUG;

export function setCenterSlug(slug) {
  activeCenterSlug = slug || DEFAULT_CENTER_SLUG;
}

export function getCenterSlug() {
  return activeCenterSlug;
}

function apiBase() {
  return `/api/c/${activeCenterSlug}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
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
  scan: (qr_code_value, { force = false, subjects } = {}) =>
    request('/scan', {
      method: 'POST',
      body: JSON.stringify({ qr_code_value, force, subjects }),
    }),

  checkIn: (student_id, subjects, { mode = 'in_person' } = {}) =>
    request('/check-in', {
      method: 'POST',
      body: JSON.stringify({ student_id, subjects, mode }),
    }),

  checkOut: ({ student_id, session_id } = {}) =>
    request('/check-out', {
      method: 'POST',
      body: JSON.stringify({ student_id, session_id }),
    }),

  register: (first_name, last_name, preferred_language) =>
    request('/register', {
      method: 'POST',
      body: JSON.stringify({ first_name, last_name, preferred_language }),
    }),

  getSystemStatus: () => request('/status'),

  getStudents: () => request('/students'),

  getPresent: () => request('/present'),

  getOpenRemoteSessions: () => request('/remote-attendance/open-sessions'),

  getCompletedToday: () => request('/completed-today'),

  getAbsent: (date) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return request(`/absent${qs}`);
  },

  getAttendanceReport: ({ period = 'monthly', month } = {}) => {
    const params = new URLSearchParams({ period });
    if (month) params.set('month', month);
    return request(`/reports/attendance?${params.toString()}`);
  },

  downloadAttendanceCsv: async ({ period = 'monthly', month } = {}) => {
    const params = new URLSearchParams({ period, format: 'csv' });
    if (month) params.set('month', month);
    const response = await fetch(`${apiBase()}/reports/attendance?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    const filename =
      response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
      `kumonscan-attendance-${period}.csv`;
    return { blob, filename };
  },

  downloadAttendancePdf: async ({ period = 'monthly', month } = {}) => {
    const params = new URLSearchParams({ period, format: 'pdf' });
    if (month) params.set('month', month);
    const response = await fetch(`${apiBase()}/reports/attendance?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    const filename =
      response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
      `kumonscan-attendance-${period}.pdf`;
    return { blob, filename };
  },

  getStudentSessions: (id) => request(`/students/${id}/sessions`),

  createStudent: (first_name, last_name, { enrolled_subjects } = {}) =>
    request('/students', {
      method: 'POST',
      body: JSON.stringify({ first_name, last_name, enrolled_subjects }),
    }),

  updateStudent: (id, fields) =>
    request(`/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),

  deactivateStudent: (id) =>
    request(`/students/${id}/deactivate`, { method: 'PATCH' }),


  importRoster: ({ filename, content }) =>
    request('/admin/roster-import', {
      method: 'POST',
      body: JSON.stringify({ filename, content }),
    }),

  applyScheduleBulk: ({ days, scope = 'missing' }) =>
    request('/admin/schedule-bulk', {
      method: 'POST',
      body: JSON.stringify({ days, scope }),
    }),

  getStaff: () => request('/staff'),

  createStaff: ({ first_name, last_name, role, hourly_rate } = {}) =>
    request('/staff', {
      method: 'POST',
      body: JSON.stringify({ first_name, last_name, role, hourly_rate }),
    }),

  updateStaff: (id, fields) =>
    request(`/staff/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),

  clockInStaff: (id) => request(`/staff/${id}/clock-in`, { method: 'POST' }),

  clockOutStaff: (id) => request(`/staff/${id}/clock-out`, { method: 'POST' }),

  getPayrollReport: ({ start, end } = {}) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    return request(`/reports/payroll${qs ? `?${qs}` : ''}`);
  },

  downloadPayrollCsv: async ({ start, end } = {}) => {
    const params = new URLSearchParams({ format: 'csv' });
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const response = await fetch(`${apiBase()}/reports/payroll?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    const filename =
      response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
      'kumonscan-payroll.csv';
    return { blob, filename };
  },

  getCapacity: () => request('/admin/capacity'),

  updateCapacity: (capacity) =>
    request('/admin/capacity', {
      method: 'PUT',
      body: JSON.stringify({ capacity }),
    }),

  getUtilization: () => request('/reports/utilization'),

  // agent-7-insights
  getInsightsSummary: ({ windowDays, atRiskThreshold } = {}) => {
    const params = new URLSearchParams();
    if (windowDays != null) params.set('window_days', windowDays);
    if (atRiskThreshold != null) params.set('at_risk_threshold', atRiskThreshold);
    const qs = params.toString();
    return request(`/insights/summary${qs ? `?${qs}` : ''}`);
  },

  // agent-7-insights
  getAtRiskStudents: ({ page, pageSize, threshold } = {}) => {
    const params = new URLSearchParams();
    if (page != null) params.set('page', page);
    if (pageSize != null) params.set('page_size', pageSize);
    if (threshold != null) params.set('threshold', threshold);
    const qs = params.toString();
    return request(`/insights/at-risk${qs ? `?${qs}` : ''}`);
  },

  getDashboard: () => request('/dashboard'),

  getTime: () => request('/time'),

  getAuthStatus: () => request('/auth/status'),

  login: (password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: () => request('/auth/logout', { method: 'POST' }),

  // agent-10-data-portability
  downloadFullExport: async () => {
    const response = await fetch(`${apiBase()}/export/full`, { credentials: 'include' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    const filename =
      response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
      'kumonscan-export.zip';
    return { blob, filename };
  },

  // agent-10-data-portability
  listWebhooks: () => request('/webhooks'),

  createWebhook: ({ url, event_types }) =>
    request('/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url, event_types }),
    }),

  deleteWebhook: (id) => request(`/webhooks/${id}`, { method: 'DELETE' }),
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
