const APP_VERSION = '9.9.9';
const CACHE_NAME = 'danesh-amooz-man-v9.9.9-orange';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];
const REQUIRED_CORE_FOR_CLEANUP = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

async function verifyCacheHealth(cacheName = CACHE_NAME) {
  try {
    const cache = await caches.open(cacheName);
    const checks = await Promise.all(
      REQUIRED_CORE_FOR_CLEANUP.map(url => cache.match(url, { ignoreSearch: true }))
    );
    const missing = [];
    checks.forEach((res, idx) => {
      if (!res || !res.ok) missing.push(REQUIRED_CORE_FOR_CLEANUP[idx]);
    });
    return { ok: missing.length === 0, missing, cacheName };
  } catch (err) {
    return { ok: false, missing: [...REQUIRED_CORE_FOR_CLEANUP], error: String(err && err.message ? err.message : err), cacheName };
  }
}

// ۱. مرحله نصب (install): دانلود کامل با دور زدن کش HTTP و اعتبارسنجی سلامت تمام فایل‌های هسته
// هیچ skipWaiting خودکاری اجرا نمی‌شود تا نسخه قبلی تا لحظه تأیید معلم و اتمام پشتیبان‌گیری فعال بماند.
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const assetUrl of ASSETS) {
        const req = new Request(assetUrl, { cache: 'reload' });
        const response = await fetch(req);
        if (!response || !response.ok) {
          throw new Error(`خطا در دانلود فایل هسته هنگام نصب نسخه ${APP_VERSION}: ${assetUrl} (کد وضعیت: ${response ? response.status : 'نامشخص'})`);
        }
        await cache.put(assetUrl, response.clone());
      }
      const health = await verifyCacheHealth(CACHE_NAME);
      if (!health.ok) {
        throw new Error(`اعتبارسنجی کش نسخه ${APP_VERSION} ناموفق بود؛ فایل‌های ناقص: ${health.missing.join(', ')}`);
      }
      // فعال‌سازی نسخه جدید صرفاً از طریق پیام SKIP_WAITING با confirmedByUser === true پس از تأیید معلم و اتمام پشتیبان‌گیری انجام می‌شود
      // (دیتابیس IndexedDB و localStorage و اطلاعات کاربران هرگز دستکاری نمی‌شوند)
    })()
  );
});

// ۲. مرحله فعال‌سازی (activate): پاک‌سازی کش‌های قدیمی فقط پس از تأیید ۱۰۰٪ سلامت کش نسخه جدید
// دیتابیس IndexedDB، مدارس، کلاس‌ها، دانش‌آموزان، عکس‌ها، کتاب‌ها و نمرات هرگز لمس یا پاک نمی‌شوند.
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const health = await verifyCacheHealth(CACHE_NAME);
      let cleanedKeys = [];
      if (health.ok) {
        const keys = await caches.keys();
        const oldKeys = keys.filter(key => key !== CACHE_NAME);
        await Promise.all(oldKeys.map(key => caches.delete(key)));
        cleanedKeys = oldKeys;
      }

      await self.clients.claim();
      const allClients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: APP_VERSION,
          cacheName: CACHE_NAME,
          cacheHealthy: health.ok,
          oldCachesCleaned: health.ok,
          cleanedKeys,
          timestamp: Date.now()
        });
      }
    })()
  );
});

// ۳. ارتباط دوطرفه با CentralUpdateManager از طریق MessageChannel + تایید قطعی ACK
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
        error: 'فعال‌سازی نسخه جدید نیازمند تأیید صریح کاربر است.',
        version: APP_VERSION,
        cacheName: CACHE_NAME
      });
      return;
    }

    event.waitUntil(
      (async () => {
        try {
          const health = await verifyCacheHealth(CACHE_NAME);
          if (!health.ok) {
            sendReply({
              ok: false,
              type: 'SW_SKIP_WAITING_ERROR',
              reason: 'NEW_CACHE_INCOMPLETE',
              missing: health.missing,
              error: `کش نسخه ${APP_VERSION} کامل نیست (${health.missing.join('، ')})؛ نصب متوقف شد تا نسخه قبلی سالم بماند.`,
              version: APP_VERSION,
              cacheName: CACHE_NAME
            });
            return;
          }

          await self.skipWaiting();
          sendReply({
            ok: true,
            type: 'SW_SKIP_WAITING_ACK',
            version: APP_VERSION,
            cacheName: CACHE_NAME,
            cacheHealthy: true,
            timestamp: Date.now()
          });
        } catch (err) {
          sendReply({
            ok: false,
            type: 'SW_SKIP_WAITING_ERROR',
            reason: 'SKIP_WAITING_EXCEPTION',
            error: String(err && err.message ? err.message : err),
            version: APP_VERSION,
            cacheName: CACHE_NAME
          });
        }
      })()
    );
  } else if (event.data.type === 'GET_SW_VERSION' || event.data.type === 'PING_SW' || event.data.type === 'CHECK_CACHE_HEALTH') {
    event.waitUntil(
      (async () => {
        const health = await verifyCacheHealth(CACHE_NAME);
        sendReply({
          ok: true,
          type: 'SW_VERSION_INFO',
          version: APP_VERSION,
          cacheName: CACHE_NAME,
          cacheHealthy: health.ok,
          missingAssets: health.missing,
          timestamp: Date.now()
        });
      })()
    );
  }
});

// ۴. پاسخ‌دهی آفلاین/آنلاین استاندارد با تضمین ثبات نسخه فعال و عدم تحویل فایل خراب
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) {
    return;
  }

  // درخواست‌های sw.js و manifest.webmanifest همیشه از شبکه (با fallback به کش) بررسی شوند تا آپدیت‌ها همیشه تشخیص داده شوند
  if (reqUrl.pathname.endsWith('/sw.js') || reqUrl.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(res => {
          if (res && res.ok && reqUrl.pathname.endsWith('/manifest.webmanifest')) {
            caches.open(CACHE_NAME).then(c => c.put('./manifest.webmanifest', res.clone())).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request, { ignoreSearch: true });
          return cached || Response.error();
        })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cachedIndex = await cache.match('./index.html', { ignoreSearch: true });
        if (cachedIndex) return cachedIndex;
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
