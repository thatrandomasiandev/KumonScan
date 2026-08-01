/**
 * Point the Neon serverless driver at a local HTTP/WebSocket-to-Postgres proxy.
 *
 * `server/db.js` uses `neon()` (HTTP) and `Pool` (WebSocket session) from
 * `@neondatabase/serverless`. A plain Postgres container cannot serve either
 * protocol directly. In CI we run `ghcr.io/timowilhelm/local-neon-http-proxy`
 * next to `postgres:16` and route both paths through it.
 *
 * Import this module (or list it as a vitest setup file) before the first
 * query. No-op unless NEON_FETCH_ENDPOINT is set, so it is inert outside CI.
 *
 * Do not set `poolQueryViaFetch`: `withRealTransaction` needs a real WebSocket
 * session so BEGIN/COMMIT share one connection (roster import, bookings lock).
 */
import { neonConfig } from '@neondatabase/serverless';

const endpoint = process.env.NEON_FETCH_ENDPOINT;

if (endpoint) {
  neonConfig.fetchEndpoint = endpoint;
  // local-neon-http-proxy terminates TLS at Caddy and speaks plain WS on :4444.
  neonConfig.useSecureWebSocket = false;
  neonConfig.wsProxy = (host) => `${host}:4444/v1`;
  // Required for non-Neon Postgres behind the local proxy (pipeline auth fails).
  neonConfig.pipelineConnect = false;
}
