const APP_VERSION = '9.2.1';
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
// هیچ skipWaiting خودکاری در زمان نصب اجرا نمی‌شود تا نسخه قبلی تا لحظه تأیید صریح کاربر و ذخیره‌سازی کامل، پایدار بماند.
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
      // پس از تکمیل واقعی کش شدن تمام فایل‌ها و ورود به وضعیت installed، به کلاینت‌ها اطلاع بده که نسخه منتظر آماده است
      const allClients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({
          type: 'SW_INSTALL_COMPLETE_WAITING',
          version: APP_VERSION,
          cacheName: CACHE_NAME,
          timestamp: Date.now()
        });
      }
    })()
  );
});

// ۲. مرحله فعال‌سازی (activate): حذف کش‌های قدیمی فقط پس از اطمینان ۱۰۰٪ از سلامت کامل کش نسخه جدید
// دیتابیس IndexedDB، عکس‌ها، کتاب‌ها، نمرات و مدارس هرگز لمس یا پاک نمی‌شوند.
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
          oldCachesCleaned: newCacheVerified,
          timestamp: Date.now()
        });
      }
    })()
  );
});

// ۳. دریافت پیام از مدیر مرکزی آپدیت (CentralUpdateManager) با پشتیبانی کامل از MessageChannel و تایید صریح
self.addEventListener('message', event => {
  if (!event.data || typeof event.data !== 'object') return;
  const replyPort = (event.ports && event.ports[0]) ? event.ports[0] : null;

  const sendReply = (payload) => {
    try {
      if (replyPort && typeof replyPort.postMessage === 'function') {
        replyPort.postMessage(payload);
      }
    } catch (_) {}
    try {
      if (event.source && typeof event.source.postMessage === 'function') {
        event.source.postMessage(payload);
      }
    } catch (_) {}
  };

  if (event.data.type === 'SKIP_WAITING') {
    if (event.data.confirmedByUser !== true) {
      sendReply({
        ok: false,
        type: 'SW_SKIP_WAITING_REJECTED',
        reason: 'USER_CONFIRMATION_REQUIRED',
        version: APP_VERSION,
        cacheName: CACHE_NAME
      });
      return;
    }

    event.waitUntil(
      (async () => {
        try {
          // پیش از skipWaiting از سلامت کش نسخه جدید اطمینان حاصل کن
          const cache = await caches.open(CACHE_NAME);
          const checks = await Promise.all(
            REQUIRED_CORE_FOR_CLEANUP.map(url => cache.match(url, { ignoreSearch: true }))
          );
          const cacheHealthy = checks.every(res => res && res.ok);
          if (!cacheHealthy) {
            sendReply({
              ok: false,
              type: 'SW_SKIP_WAITING_ERROR',
              reason: 'NEW_CACHE_INCOMPLETE',
              error: 'کش نسخه جدید ناقص است؛ نصب متوقف شد تا نسخه قبلی حفظ شود.',
              version: APP_VERSION
            });
            return;
          }

          await self.skipWaiting();
          sendReply({
            ok: true,
            type: 'SW_SKIP_WAITING_ACK',
            version: APP_VERSION,
            cacheName: CACHE_NAME,
            timestamp: Date.now()
          });
        } catch (err) {
          sendReply({
            ok: false,
            type: 'SW_SKIP_WAITING_ERROR',
            reason: 'SKIP_WAITING_EXCEPTION',
            error: String(err && err.message ? err.message : err),
            version: APP_VERSION
          });
        }
      })()
    );
  } else if (event.data.type === 'GET_SW_VERSION' || event.data.type === 'PING_SW') {
    event.waitUntil(
      (async () => {
        let cacheHealthy = false;
        try {
          const c = await caches.open(CACHE_NAME);
          const checks = await Promise.all(
            REQUIRED_CORE_FOR_CLEANUP.map(url => c.match(url, { ignoreSearch: true }))
          );
          cacheHealthy = checks.every(res => res && res.ok);
        } catch (_) {}
        sendReply({
          ok: true,
          type: 'SW_VERSION_INFO',
          version: APP_VERSION,
          cacheName: CACHE_NAME,
          cacheHealthy,
          timestamp: Date.now()
        });
      })()
    );
  }
});

// ۴. پاسخ‌دهی آفلاین/آنلاین هوشمند: استفاده از کش نسخه فعال برای تضمین ثبات نسخه تا زمان تأیید آپدیت، و کارکرد کامل آفلاین
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) {
    return;
  }

  // برای درخواست‌های ناوبری (index.html): ابتدا کش نسخه فعال بررسی شود تا پیش از تأیید آپدیت، فایل صفحه از کش نسخه فعال خوانده شود و در نبود کش از شبکه دریافت گردد
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cachedIndex = await cache.match('./index.html', { ignoreSearch: true });
        if (cachedIndex) {
          return cachedIndex;
        }
        try {
          const networkRes = await fetch(event.request);
          if (networkRes && networkRes.status === 200) {
            cache.put('./index.html', networkRes.clone()).catch(() => {});
          }
          return networkRes;
        } catch (_) {
          const anyCached = await caches.match('./index.html', { ignoreSearch: true });
          return anyCached || Response.error();
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(event.request);
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(event.request, res.clone()).catch(() => {});
        }
        return res;
      } catch (_) {
        const fallback = await caches.match(event.request, { ignoreSearch: true })
          || await caches.match('./index.html', { ignoreSearch: true });
        return fallback || Response.error();
      }
    })
  );
});
