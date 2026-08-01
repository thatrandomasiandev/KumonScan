import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

/**
 * CI-only vitest config: identical to the base config plus a setup file that
 * routes the Neon serverless driver to the local HTTP proxy in front of the
 * ephemeral Postgres service container. Setup files run once per worker, so
 * the proxy config applies to every forked test process.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      setupFiles: ['./scripts/ci-neon-proxy.js'],
    },
  })
);
