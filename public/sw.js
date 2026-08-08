// Bumping this forces every installed PWA to drop its old cache on the next
// activate — needed once, here, because the cache-first "/" entry below
// used to never expire (same CACHE_NAME across deploys meant `activate`'s
// cleanup never saw it as stale), so an installed app could keep serving a
// JS bundle from before a fix shipped, indefinitely, even on a fresh network.
const CACHE_NAME = 'quantz-v2';

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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for API calls (live market data must be fresh)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response('{"error":"offline"}', {
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  // Network-first for page navigations. Cache-first on "/" is what caused
  // the installed PWA to keep running an old build indefinitely — it never
  // re-checked the network once cached. Falls back to the cache only when
  // actually offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Cache-first for everything else (icons, Next.js's content-hashed JS/CSS
  // chunks) — safe here since a changed file gets a new hashed URL, never a
  // stale hit on the same request.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return res;
    }))
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
