/**
 * KumonScan Family service worker.
 *
 * Registered with scope /family/ so it only controls the parent app, never
 * the staff kiosk. Strategy:
 *   - static assets (hashed /assets/, icons, manifest): cache-first
 *   - /api/ data: network-first with cache fallback, so a parent who opens
 *     the installed app offline still sees the last-loaded attendance
 *   - navigations: network-first, falling back to the cached app shell
 */

const STATIC_CACHE = 'kumonscan-family-static-v1';
const DATA_CACHE = 'kumonscan-family-data-v1';

const PRECACHE_URLS = [
  '/family/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Never cache one-time magic-link verification responses.
function isCacheableApiPath(pathname) {
  return (
    pathname.startsWith('/api/parent/') || pathname === '/api/parent-auth/session'
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    const { pathname } = new URL(request.url);
    if (response.ok && (!pathname.startsWith('/api/') || isCacheableApiPath(pathname))) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE, '/family/'));
    return;
  }

  event.respondWith(cacheFirst(request));
});
