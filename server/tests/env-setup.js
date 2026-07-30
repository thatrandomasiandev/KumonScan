import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.CENTER_TIMEZONE = 'America/Los_Angeles';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:3001';
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), `kumonscan-test-${process.pid}-`)
);
