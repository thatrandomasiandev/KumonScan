/**
 * Client-side center routing. Every page lives under `/:centerSlug/...` so
 * the API client can build `/api/c/:centerSlug/...` without a separate
 * configuration step. The default slug ('main') matches the row seeded by
 * the multi-center migration for the pre-existing live center.
 */

export const DEFAULT_CENTER_SLUG = 'main';

/** Build an in-app path scoped to a center. `path` is relative (e.g. '/desk'). */
export function centerPath(slug, path = '/') {
  const cleanSlug = slug || DEFAULT_CENTER_SLUG;
  if (!path || path === '/') return `/${cleanSlug}`;
  const relative = path.startsWith('/') ? path : `/${path}`;
  return `/${cleanSlug}${relative}`;
}

/**
 * Strip the leading `/:centerSlug` segment from a pathname, returning the
 * page path the pre-multi-tenant nav used to match against (e.g. '/',
 * '/desk'). Unknown/missing slugs fall through as the original path.
 */
export function pagePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match) return pathname;
  return match[2] || '/';
}
