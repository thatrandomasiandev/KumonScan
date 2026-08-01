/**
 * PWA wiring for the /family surface only. The manifest link and iOS meta
 * tags are injected at runtime (instead of index.html) so the staff kiosk
 * never advertises itself as the parent app, and the service worker is
 * registered with scope /family/ so it never controls kiosk pages.
 */

const THEME_COLOR = '#1B6EF3';

function appendOnce(id, create) {
  if (document.getElementById(id)) return;
  const el = create();
  el.id = id;
  document.head.appendChild(el);
}

export function setupFamilyPwa() {
  appendOnce('family-manifest', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    return link;
  });

  appendOnce('family-theme-color', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = THEME_COLOR;
    return meta;
  });

  appendOnce('family-apple-icon', () => {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = '/icons/apple-touch-icon.png';
    return link;
  });

  appendOnce('family-apple-capable', () => {
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-capable';
    meta.content = 'yes';
    return meta;
  });

  appendOnce('family-apple-title', () => {
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-title';
    meta.content = 'KumonScan';
    return meta;
  });

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/family/' })
      .catch((err) => console.warn('Family service worker registration failed:', err));
  }
}
