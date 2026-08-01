/**
 * Point the Neon serverless driver at a local HTTP-to-Postgres proxy.
 *
 * `server/db.js` uses `neon()` from `@neondatabase/serverless`, which speaks
 * Neon's HTTP SQL protocol, not the Postgres wire protocol. A plain Postgres
 * container therefore cannot serve it directly. In CI we run
 * `ghcr.io/timowilhelm/local-neon-http-proxy` next to `postgres:16` and route
 * the driver's fetch calls to it via `neonConfig.fetchEndpoint`.
 *
 * Import this module (or list it as a vitest setup file) before the first
 * query. No-op unless NEON_FETCH_ENDPOINT is set, so it is inert outside CI.
 */
import { neonConfig } from '@neondatabase/serverless';

const endpoint = process.env.NEON_FETCH_ENDPOINT;

if (endpoint) {
  neonConfig.fetchEndpoint = endpoint;
  neonConfig.poolQueryViaFetch = true;
}
