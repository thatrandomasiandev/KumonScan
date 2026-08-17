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
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

export const curriculumApi = {
  /** Level catalog. subject: 'math' | 'reading' | undefined for both. */
  getLevels: (subject) => {
    const qs = subject ? `?subject=${encodeURIComponent(subject)}` : '';
    return request(`/curriculum/levels${qs}`);
  },

  /** Current level/page per subject plus recent completion history. */
  getStudentProgress: (studentId) => request(`/students/${studentId}/progress`),

  /**
   * Log a completed worksheet. level_code is only needed to set the starting
   * level or to advance/correct the level — an explicit staff action.
   */
  logCompletion: (studentId, { subject, page_number, accuracy_pct, session_id, level_code } = {}) =>
    request(`/students/${studentId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ subject, page_number, accuracy_pct, session_id, level_code }),
    }),

  /** Pages/week per active student over a trailing window (default 4 weeks). */
  getProgressPace: ({ weeks } = {}) => {
    const qs = weeks ? `?weeks=${encodeURIComponent(weeks)}` : '';
    return request(`/reports/progress-pace${qs}`);
  },
};
