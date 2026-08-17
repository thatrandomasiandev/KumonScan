const API_BASE = '/api';

async function request(path, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data;
}

export const parentApi = {
  requestLink: (phone) =>
    request('/parent-auth/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  verifyToken: (token) =>
    request(`/parent-auth/verify?token=${encodeURIComponent(token)}`),

  getSession: () => request('/parent-auth/session'),

  logout: () => request('/parent-auth/logout', { method: 'POST' }),

  getAttendance: () => request('/parent/attendance'),

  /**
   * Optional sections (bookings, messages, progress) exist only when the
   * matching feature has landed server-side. Resolves { available, data }
   * so screens can hide sections whose data source is absent.
   */
  getSection: async (section) => {
    try {
      const data = await request(`/parent/${section}`);
      return { available: true, data };
    } catch (err) {
      if (err.status === 404 || err.code === 'NOT_AVAILABLE') {
        return { available: false, data: null };
      }
      throw err;
    }
  },
};
