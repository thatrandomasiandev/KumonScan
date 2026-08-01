import '../loadEnv.js';

process.env.NODE_ENV = 'test';
process.env.CENTER_TIMEZONE = 'America/Los_Angeles';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.GATEWAY_API_KEY = 'test-gateway-key';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:3001';

// Tests must run against the dedicated Neon "test-suite" branch, never the
// production branch. TEST_DATABASE_URL wins; otherwise refuse to run.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  throw new Error(
    'TEST_DATABASE_URL is required to run tests (Neon test-suite branch connection string). ' +
      'Refusing to run tests against DATABASE_URL directly.'
  );
}
