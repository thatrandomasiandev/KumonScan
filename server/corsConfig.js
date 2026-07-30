/** Explicit CORS allowlist for credentialed admin cookie requests. */

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

export function parseAllowedOrigins(env = process.env) {
  const raw = env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_ALLOWED_ORIGINS];
}

export function createCorsOptions(env = process.env) {
  const allowed = parseAllowedOrigins(env);

  return {
    origin(origin, callback) {
      // Non-browser clients (curl, health checks) omit Origin.
      if (!origin) {
        return callback(null, true);
      }
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  };
}
