/* frutero service worker
 *
 * Minimal PWA enhancer: pre-caches the app shell so the UI loads when
 * offline (API calls still fail, but the login/dashboard chrome renders
 * instead of a browser error page), picks a sensible cache strategy per
 * request kind, and hosts the push notification handler.
 *
 * Version is pinned via the `?v=<hash>` query string on the registration
 * URL. Each frontend build registers with a new version, which makes the
 * SW itself a new byte-sequence to the browser — triggering `updatefound`
 * on the registration, which the PwaUpdateBanner surfaces to the user.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `frutero-${VERSION}`;
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => { /* no-op */ })
  );
  // Skip waiting so the new SW takes over on the next navigation
  // instead of parking behind the old one for a cycle.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('frutero-') && k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: network-only. Caching responses would silently serve stale
  // sensor readings / device state — dangerous for a chamber control UI.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (address bar, link click): stale-while-revalidate
  // the cached index.html so new builds land on the next navigation
  // without blocking render when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('/index.html');
      const network = fetch(req).then((r) => {
        cache.put('/index.html', r.clone()).catch(() => {});
        return r;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // Hashed static assets (vite emits /assets/*-<hash>.js|css): cache-first
  // because the filename changes on every rebuild so stale never wins.
  if (url.pathname.startsWith('/assets/') || /\.(js|css|woff2?|png|svg|jpe?g|ico)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone()).catch(() => {});
        return r;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});

// Push handler stub. Phase 11 M4 will populate this; today it exists so
// subscribing to push doesn't silently fail when the M4 backend starts
// sending before every client has the M4 frontend bundle.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore malformed */ }
  const title = data.title || 'frutero';
  const body = data.body || 'Update from your grow chamber.';
  const url = data.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || 'frutero',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(target) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
