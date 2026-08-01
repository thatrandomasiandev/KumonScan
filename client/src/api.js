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
  scan: (qr_code_value, { force = false, subjects } = {}) =>
    request('/scan', {
      method: 'POST',
      body: JSON.stringify({ qr_code_value, force, subjects }),
    }),

  checkIn: (student_id, subjects) =>
    request('/check-in', {
      method: 'POST',
      body: JSON.stringify({ student_id, subjects }),
    }),

  checkOut: ({ student_id, session_id } = {}) =>
    request('/check-out', {
      method: 'POST',
      body: JSON.stringify({ student_id, session_id }),
    }),

  register: (first_name, last_name) =>
    request('/register', {
      method: 'POST',
      body: JSON.stringify({ first_name, last_name }),
    }),

  getStudents: () => request('/students'),

  getPresent: () => request('/present'),

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
    const response = await fetch(`${API_BASE}/reports/attendance?${params.toString()}`, {
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
    const response = await fetch(`${API_BASE}/reports/attendance?${params.toString()}`, {
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

  getDigests: ({ student_id } = {}) => {
    const qs = student_id ? `?student_id=${encodeURIComponent(student_id)}` : '';
    return request(`/admin/digests${qs}`);
  },

  sendDigestsNow: ({ student_id } = {}) =>
    request('/admin/digests/send-now', {
      method: 'POST',
      body: JSON.stringify(student_id ? { student_id } : {}),
    }),

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
