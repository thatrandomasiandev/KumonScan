import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request tenancy context. The center-resolution middleware runs each
 * request inside this store so deep call sites (currently timeService's
 * timezone lookup) can read the active center without threading it through
 * every function signature.
 *
 * This is convenience only, never authorization: every SQL query still
 * carries an explicit `center_id = ?` filter.
 */
const requestContext = new AsyncLocalStorage();

export function runWithCenter(center, fn) {
  return requestContext.run({ center }, fn);
}

/** The center resolved for the current request, or null outside a request. */
export function getRequestCenter() {
  return requestContext.getStore()?.center ?? null;
}
