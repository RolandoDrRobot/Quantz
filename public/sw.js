// One cache per deploy — UpdateWatcher registers this file as sw.js?v=<build id>,
// so every deploy installs a fresh worker and `activate` below drops the
// previous deploy's cache. A fixed name here is what used to let an installed
// app keep serving an old build indefinitely.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `quantz-${VERSION}`;

const STATIC_ASSETS = [
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function putInCache(request, res) {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only same-origin GETs — everything else goes straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-only for API calls (live market data must be fresh)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response('{"error":"offline"}', {
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  // Cache-first only for files whose URL changes when their content does:
  // Next.js's content-hashed /_next/static/ chunks, plus the icons precached
  // above. Anything else served cache-first would never pick up a new deploy.
  if (url.pathname.startsWith('/_next/static/') || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => putInCache(request, res)))
    );
    return;
  }

  // Network-first for everything else (pages, RSC payloads, manifest, logo) —
  // the cache is only an offline fallback.
  event.respondWith(
    fetch(request)
      .then((res) => putInCache(request, res))
      .catch(async () =>
        (await caches.match(request)) ||
        (request.mode === 'navigate' && (await caches.match('/'))) ||
        Response.error()
      )
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Quantz', {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/favicon-32x32.png',
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
