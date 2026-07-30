import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/env-setup.js'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
