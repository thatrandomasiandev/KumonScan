import { getCenterSlug } from './api';

/**
 * Client for caregiver/pickup endpoints. Kept out of api.js so the pickup-auth
 * workstream does not edit that shared module.
 */
function apiBase() {
  return `/api/c/${getCenterSlug()}`;
}

async function request(path, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

export const caregiversApi = {
  list: (studentId, { includeInactive = false } = {}) => {
    const qs = includeInactive ? '?include_inactive=1' : '';
    return request(`/students/${studentId}/caregivers${qs}`);
  },

  create: (studentId, body) =>
    request(`/students/${studentId}/caregivers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (studentId, caregiverId, body) =>
    request(`/students/${studentId}/caregivers/${caregiverId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  checkOut: ({ session_id, student_id, picked_up_by, idempotencyKey } = {}) =>
    request('/check-out', {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify({ session_id, student_id, picked_up_by }),
    }),

  getPickupLog: ({ start, end } = {}) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    return request(`/reports/pickup-log${qs ? `?${qs}` : ''}`);
  },
};
