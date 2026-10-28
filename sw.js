const APP_VERSION = '5.8.1';
const CACHE_NAME = 'danesh-amooz-v5.8.1';
const CACHE_PREFIX = 'danesh-amooz-';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(CORE);
    } catch (e) {
      // Keep installation resilient if optional files are missing in certain hosting setups
      for (const url of CORE) {
        try { await cache.add(url); } catch (_) {}
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Strictly delete ONLY old caches belonging to this app (danesh-amooz-*)
    // Never touch other apps' caches or IndexedDB / localStorage
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION, cacheName: CACHE_NAME });
      } catch (_) {}
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request, { cache: 'no-store' });
      if (networkResponse && networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkResponse.clone()).catch(() => {});
      }
      return networkResponse;
    } catch (e) {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html', { ignoreSearch: true });
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});