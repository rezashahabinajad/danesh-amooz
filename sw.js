const APP_VERSION = '9.2.0';
const CACHE_NAME = 'danesh-amooz-man-v' + APP_VERSION + '-orange';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];
const REQUIRED_CORE_FOR_CLEANUP = [
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

// ۱. مرحله نصب (install): دانلود و اعتبارسنجی اجباری تمام فایل‌های اصلی و آیکن‌ها
// اگر حتی یکی از فایل‌های اصلی یا آیکن‌ها دانلود و کش نشود، نصب نسخه ناقص متوقف می‌شود تا نسخه قبلی سالم بماند.
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const assetUrl of ASSETS) {
        const response = await fetch(assetUrl, { cache: 'no-cache' });
        if (!response || !response.ok) {
          throw new Error(`Failed to fetch required core asset during SW install: ${assetUrl} (status: ${response ? response.status : 'none'})`);
        }
        await cache.put(assetUrl, response.clone());
      }
      // عدم اجرای خودکار skipWaiting در زمان نصب!
      // فعال‌سازی نسخه جدید فقط پس از تأیید صریح کاربر (SKIP_WAITING با confirmedByUser === true) انجام می‌شود.
    })()
  );
});

// ۲. مرحله فعال‌سازی (activate): حذف کش‌های قدیمی فقط پس از اطمینان ۱۰۰٪ از سلامت کش جدید (شامل آیکن‌ها)
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      let newCacheVerified = false;
      try {
        const newCache = await caches.open(CACHE_NAME);
        const checks = await Promise.all(
          REQUIRED_CORE_FOR_CLEANUP.map(url => newCache.match(url, { ignoreSearch: true }))
        );
        newCacheVerified = checks.every(res => res && res.ok);
      } catch (err) {
        newCacheVerified = false;
      }

      if (newCacheVerified) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
      }

      await self.clients.claim();
      const allClients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: APP_VERSION,
          cacheName: CACHE_NAME,
          oldCachesCleaned: newCacheVerified
        });
      }
    })()
  );
});

// ۳. دریافت پیام از برنامه برای اجرای هماهنگ skipWaiting فقط با تأیید صریح کاربر (confirmedByUser === true)
self.addEventListener('message', event => {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'SKIP_WAITING' && event.data.confirmedByUser === true) {
    self.skipWaiting();
  } else if (event.data.type === 'GET_SW_VERSION') {
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage({
        type: 'SW_VERSION_INFO',
        version: APP_VERSION,
        cacheName: CACHE_NAME
      });
    }
  }
});

// ۴. پاسخ‌دهی آفلاین/آنلاین هوشمند (حفظ کامل کارکرد آفلاین بدون دست زدن به درخواست‌های API خارجی)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }));
    })
  );
});
