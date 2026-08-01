import { getCenterSlug } from './api';

/**
 * Client for the resource/consumables endpoints. Kept out of api.js so the
 * resources workstream does not edit that shared module; fold these into
 * api.js if desired once parallel branches have merged.
 */
function apiBase() {
  return `/api/c/${getCenterSlug()}`;
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

export const resourcesApi = {
  getResources: () => request('/resources'),

  getLowStock: () => request('/resources/low-stock'),

  createResource: ({ name, category, quantity_on_hand, low_stock_threshold }) =>
    request('/resources', {
      method: 'POST',
      body: JSON.stringify({ name, category, quantity_on_hand, low_stock_threshold }),
    }),

  restockResource: (id, quantity) =>
    request(`/resources/${id}/restock`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),

  useResource: (id, { student_id, session_id, quantity = 1 } = {}) =>
    request(`/resources/${id}/use`, {
      method: 'POST',
      body: JSON.stringify({ student_id, session_id, quantity }),
    }),

  getResourceUsageReport: ({ start, end } = {}) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    return request(`/reports/resource-usage${qs ? `?${qs}` : ''}`);
  },

  downloadResourceUsageCsv: async ({ start, end } = {}) => {
    const params = new URLSearchParams({ format: 'csv' });
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const response = await fetch(`${apiBase()}/reports/resource-usage?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const blob = await response.blob();
    const filename =
      response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
      'kumonscan-resource-usage.csv';
    return { blob, filename };
  },
};
