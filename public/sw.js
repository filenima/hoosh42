// هوش Service Worker — نسخه ۸ (تجربه آفلاین کامل)
//
// FIX(v8):
//  C1: getAllQueued هندلرهای onsuccess/onerror را قبل از await done نصب
//      می‌کند — قبلاً event از دست می‌رفت و Promise هرگز resolve نمی‌شد و
//      کل Background Sync مرده بود (فاکتورهای آفلاین برای همیشه در صف می‌ماند)
//  H1: skipWaiting بی‌شرط در install حذف شد — فقط با پیام SKIP_WAITING
//      (تأیید کاربر) فعال می‌شود؛ reload نابهنگام اولین بازدید حل شد
//  H3: پاسخ ۴۰۱/۴۰۳ در replay صف را حذف نمی‌کند — نشست منقضی طبیعی است؛
//      آیتم نگه داشته می‌شود تا بعد از لاگین مجدد ارسال شود
//  FIX: fallback لوگو از caches.match (همه کش‌ها) نه فقط IMAGE_CACHE
//  FIX: جلوگیری از صف دوگانه (URL+hash بدنه) — ریسک فاکتور تکراری با retry کاربر
//  FIX: پیام GET_QUEUE_COUNT برای شمارش صف از سمت اپ
//  FIX: مسیرهای GET بیشتری برای خواندن آفلاین کش می‌شوند
//
// استراتژی‌ها (مطابق مشخصات Feature ⑧):
// ۱. Precache پوسته اپ: /، manifest، آیکون‌ها، offline.html
//    با نام‌های کش نسخه‌دار: hoosh-shell-v12 / hoosh-static-v12 / hoosh-img-v12 / hoosh-api-v12
// ۲. Navigation (GET صفحه‌ها) → network-first؛ در آفلاین: cache → offline.html
// ۳. Asset استاتیک (/_next/static، فونت، js/css) و تصاویر → cache-first
// ۴. GET /api/* → network-first با fallback به cache برای مسیرهای داده‌ای
//    (کش جدا hoosh-api-v12) — پاسخ آفلاین با هدر X-Hoosh-Offline: 1 تا UI
//    بنر «داده ذخیره‌شده» نشان دهد. /api/auth/* هرگز کش نمی‌شود. POST فقط
//    برای مسیرهای مجاز صف می‌شود.
// ۵. Background Sync: POSTهای ناموفق به /api/accounting/invoices و /api/expenses
//    در IndexedDB «hoosh-sync-queue» صف می‌شوند و با رویداد sync
//    (تگ hoosh-bg-sync — و تگ قدیمی hoshhesab-sync برای سازگاری sw-register)
//    دوباره ارسال می‌شوند.
// ۶. activate: پاکسازی همه کش‌های نسخه‌های قبل.
// ۷. Push Notification + notificationclick + message
//    (SKIP_WAITING / GET_VERSION / CLEAR_CACHE / FORCE_SYNC / GET_QUEUE_COUNT)
//
// نسخه‌بندی: با هر تغییر SW_VERSION را بروز کنید.

const SW_VERSION = "hoosh-v12-2026-09";
const SHELL_CACHE = "hoosh-shell-v12";
const STATIC_CACHE = "hoosh-static-v12";
const IMAGE_CACHE = "hoosh-img-v12";
const API_CACHE = "hoosh-api-v12";

const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, IMAGE_CACHE, API_CACHE];

// پوسته‌ای که هنگام نصب پیش‌کش می‌شود (ignore failure برای هر آیتم)
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/offline.html",
  "/logo.svg",
  "/icon-192.png",
  "/icon-192-maskable.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];

const STATIC_ASSET_REGEX = /\.(?:js|css|woff2?|ttf|otf|eot|wasm)$/i;
const IMAGE_ASSET_REGEX = /\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$/i;
const IMAGE_CACHE_MAX_ENTRIES = 120;

// مسیرهای API که GET آن‌ها برای خواندن آفلاین کش می‌شود (فقط پاسخ ۲۰۰)
// FIX(v8): علاوه بر dashboard/products، داده‌های اصلیِ آفلاین‌موردنیاز هم کش می‌شوند
const API_OFFLINE_CACHE_PREFIXES = [
 "/api/dashboard",
 "/api/products",
 "/api/parties",
 "/api/accounting/invoices",
 "/api/inventory",
 "/api/warehouses",
 "/api/expenses",
 "/api/checks",
 "/api/bank-accounts",
];
// مسیرهایی که هرگز نباید کش شوند (نشست‌ها/توکن‌ها)
const API_NEVER_CACHE_PREFIXES = ["/api/auth/"];

// POSTهایی که در صف Background Sync قرار می‌گیرند
const BG_SYNC_POST_PREFIXES = ["/api/accounting/invoices", "/api/expenses"];
const BG_SYNC_TAGS = ["hoosh-bg-sync", "hoshhesab-sync"]; // تگ قدیمی برای سازگاری sw-register
const BG_SYNC_MAX_ATTEMPTS = 5;

// ============ Install — پیش‌کش پوسته ============
// FIX(v8/H1): skipWaiting بی‌شرط حذف شد — SW جدید صبر می‌کند تا کاربر با دکمه
// «به‌روزرسانی» (پیام SKIP_WAITING) فعالش کند؛ reload نابهنگام اولین بازدید حل شد.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await Promise.allSettled(
          PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: "reload" })))
        );
      } catch (err) {
        console.warn("[SW v8] Precache error:", err);
      }
    })()
  );
});

// ============ Activate — پاکسازی کش‌های قدیمی + مالکیت کلاینت‌ها ============
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => {
        client.postMessage({ type: "SW_ACTIVATED", version: SW_VERSION });
      });
    })()
  );
});

// ============ Fetch handler ============
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // فقط same-origin
  if (url.origin !== self.location.origin) return;

  // POST/PUT/PATCH/DELETE → صف آفلاین فقط برای مسیرهای مجاز
  if (request.method !== "GET") {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      BG_SYNC_POST_PREFIXES.some((p) => url.pathname.startsWith(p))
    ) {
      event.respondWith(handleQueuablePost(request));
    }
    return;
  }

  // صفحات (HTML navigation) — network-first + fallback به cache و سپس offline.html
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // API — network-first؛ کش آفلاین فقط برای dashboard/products
  if (url.pathname.startsWith("/api/")) {
    if (API_NEVER_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) return; // pass-through
    if (API_OFFLINE_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      event.respondWith(handleApiWithOfflineCache(request));
    }
    return;
  }

  // Asset استاتیک — cache-first
  if (STATIC_ASSET_REGEX.test(url.pathname) || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // تصاویر (شامل /_next/image) — cache-first با سقف تعداد
  if (IMAGE_ASSET_REGEX.test(url.pathname) || url.pathname.startsWith("/_next/image")) {
    event.respondWith(imageCacheFirst(request));
    return;
  }
});

// ============ Navigation: network-first با fallback آفلاین ============
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    // آفلاین: اول نسخه کش‌شده همان صفحه، بعد offline.html
    const cached = (await cache.match(request)) || (await caches.match(request));
    if (cached) return cached;
    const offline = await caches.match("/offline.html");
    if (offline) return offline;
    return new Response("<html><body><h1>آفلاین هستید</h1></body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

// ============ API: network-first + کش آفلاین با هدر X-Hoosh-Offline ============
async function handleApiWithOfflineCache(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) {
      // داده ذخیره‌شده + هدر برای نمایش بنر «داده‌های ذخیره‌شده» در UI
      const headers = new Headers(cached.headers);
      headers.set("X-Hoosh-Offline", "1");
      headers.set("X-SW-Cache", "HIT");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: "اتصال اینترنت برقرار نیست",
        offline: true,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ============ Cache-first (استاتیک) ============
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.status === 200) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

// ============ Image cache-first با سقف ورودی ============
async function imageCacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.status === 200) {
      cache.put(request, res.clone()).catch(() => {});
      trimCache(cache, IMAGE_CACHE_MAX_ENTRIES).catch(() => {});
    }
    return res;
  } catch (err) {
    // FIX(v8): logo.svg در SHELL_CACHE پیش‌کش می‌شود نه IMAGE_CACHE — از caches.match
    // (جستجوی همه کش‌ها) استفاده کن تا fallback واقعاً کار کند
    const logo = await caches.match("/logo.svg");
    if (logo) return logo;
    throw err;
  }
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// ============ POSTهای قابل صف: تلاش شبکه → صف IndexedDB + Background Sync ============
// FIX(v8): جلوگیری از صف دوگانه — اگر همین درخواست (همان URL + همان بدنه)
// از قبل در صف باشد، دوباره اضافه نمی‌شود. ریسک حل‌شده: کاربر در حالت آفلاین
// فرم را دوباره ثبت می‌کند → دو نسخه در صف → دو فاکتور تکراری.
async function handleQueuablePost(request) {
  try {
    return await fetch(request.clone());
  } catch (err) {
    try {
      const body = await request.clone().text();
      const alreadyQueued = await isDuplicateQueued(request.url, body);
      if (!alreadyQueued) {
        await enqueueRequest({
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body,
          bodyHash: await sha256Hex(body),
          queuedAt: Date.now(),
          attempts: 0,
        });
      }
      await registerBgSync();
      return new Response(
        JSON.stringify({
          success: false,
          error: "این درخواست در حالت آفلاین ثبت شد و پس از اتصال مجدد ارسال خواهد شد.",
          offline: true,
          queued: true,
          duplicate: alreadyQueued,
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
    } catch (queueErr) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "اتصال اینترنت برقرار نیست و ذخیره‌ی درخواست ناموفق بود.",
          offline: true,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}

async function registerBgSync() {
  if (!("sync" in self.registration)) return;
  for (const tag of BG_SYNC_TAGS) {
    try {
      await self.registration.sync.register(tag);
    } catch (e) {
      /* بعضی مرورگرها فقط یک تگ فعال دارند — نادیده بگیر */
    }
  }
}

// ============ Background Sync — بازپخش صف ============
self.addEventListener("sync", (event) => {
  if (BG_SYNC_TAGS.includes(event.tag)) {
    event.waitUntil(processSyncQueue());
  }
});

async function processSyncQueue() {
  try {
    const queue = await getAllQueued();
    if (queue.length === 0) return;
    const remaining = [];
    let processed = 0;

    for (const item of queue) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        });
        if (res.ok) {
          processed++;
        } else if (res.status === 401 || res.status === 403) {
          // FIX(v8/H3): نشست منقضی/بدون دسترسی در حالت آفلاین کاملاً طبیعی است —
          // آیتم «حذف نمی‌شود»؛ نگه داشته می‌شود تا کاربر لاگین مجدد کند و دوباره
          // ارسال شود. حذف قبلی = از دست رفتن بی‌صدای فاکتور واقعی کاربر.
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts <= BG_SYNC_MAX_ATTEMPTS) remaining.push(item);
          else processed++; // سقف تلاش — گزارش حذف برای جلوگیری از حلقه بی‌نهایت
        } else if (res.status >= 400 && res.status < 500) {
          // خطای سمت کلاینت (اعتبارسنجی) — بازپخش بی‌فایده است؛ حذف
          // (401/403 بالاتر جداگانه مدیریت می‌شوند و حذف نمی‌شوند)
          processed++;
        } else {
          remaining.push(item); // خطای سرور — نگه دار
        }
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts < BG_SYNC_MAX_ATTEMPTS) remaining.push(item);
      }
    }

    await replaceQueue(remaining);

    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((client) => {
      client.postMessage({
        type: "BG_SYNC_DONE",
        processed,
        remaining: remaining.length,
      });
    });
  } catch (err) {
    console.error("[SW v7] Background sync error:", err);
  }
}

// ============ IndexedDB: صف hoosh-sync-queue ============
const QUEUE_DB = "hoosh-sync-queue";
const QUEUE_STORE = "queue";
let queueDbPromise = null;

function openQueueDb() {
  if (queueDbPromise) return queueDbPromise;
  queueDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return queueDbPromise;
}

function txQueue(mode) {
  return openQueueDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE, mode);
        const store = tx.objectStore(QUEUE_STORE);
        resolve({ store, done: new Promise((res, rej) => {
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        }) });
      })
  );
}

async function enqueueRequest(item) {
  const { store, done } = await txQueue("readwrite");
  store.add(item);
  await done;
}

// FIX(v8): hash بدنه برای تشخیص درخواست تکراری (بدون کتابخانه — SubtleCrypto)
async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // fallback: hash ساده رشته‌ای (طول + کاراکترها)
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) >>> 0;
    }
    return `fallback-${h}-${text.length}`;
  }
}

// آیا درخواست مشابه (همان URL + همان hash بدنه) از قبل در صف است؟
async function isDuplicateQueued(url, body) {
  try {
    const hash = await sha256Hex(body);
    const queue = await getAllQueued();
    return (
      Array.isArray(queue) &&
      queue.some((item) => item.url === url && (item.bodyHash === hash || item.body === body))
    );
  } catch {
    return false;
  }
}

async function getAllQueued() {
  // FIX(v8/C1): هندلرهای onsuccess/onerror باید «قبل از» await done نصب شوند.
  // رویداد success مربوط به store.getAll() قبل از oncomplete تراکنش dispatch
  // می‌شود — قبلاً لیسنر بعد از آن نصب می‌شد، event از دست می‌رفت و Promise
  // هرگز resolve نمی‌شد → کل Background Sync مرده بود (صف آفلاین برای همیشه گیر می‌کرد).
  const { store, done } = await txQueue("readonly");
  const result = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await done;
  return result;
}

async function replaceQueue(items) {
  const { store, done } = await txQueue("readwrite");
  store.clear();
  items.forEach((item) => store.add(item));
  await done;
}

// ============ Push Notifications ============
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "هوش", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "هوش";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    dir: "rtl",
    lang: "fa",
    tag: payload.tag || "hoosh-notification",
    data: payload.data || {},
    actions: payload.actions || [],
    vibrate: payload.vibrate || [100, 50, 100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ============ Notification Click ============
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({
            type: "NOTIFICATION_CLICK",
            data: event.notification.data,
          });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});

// ============ Message Handler ============
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (data.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
  if (data.type === "CLEAR_CACHE") {
    event.waitUntil(
      (async () => {
        await Promise.all(ALL_CACHES.map((c) => caches.delete(c)));
        event.ports[0]?.postMessage({ cleared: true });
      })()
    );
  }
  if (data.type === "FORCE_SYNC") {
    event.waitUntil(processSyncQueue());
  }
  // FIX(v8): شمارش صف از سمت اپ — use-offline-sync تعداد درخواست‌های در انتظار را
  // از صف واقعی SW می‌پرسد (به‌جای صف جداگانه و مرده در lib/offline-db.ts)
  if (data.type === "GET_QUEUE_COUNT") {
    event.waitUntil(
      (async () => {
        let count = 0;
        try {
          const queue = await getAllQueued();
          count = Array.isArray(queue) ? queue.length : 0;
        } catch {
          count = 0;
        }
        event.ports[0]?.postMessage({ count });
      })()
    );
  }
  // حذف دستی یک آیتم صف (برای UI مدیریت صف آفلاین)
  if (data.type === "REMOVE_QUEUED_ITEM" && typeof data.id === "number") {
    event.waitUntil(
      (async () => {
        try {
          const queue = await getAllQueued();
          const remaining = queue.filter((item) => item.id !== data.id);
          await replaceQueue(remaining);
          event.ports[0]?.postMessage({ removed: true });
        } catch {
          event.ports[0]?.postMessage({ removed: false });
        }
      })()
    );
  }
});

// ============ Error reporting ============
self.addEventListener("error", (event) => {
  console.error("[SW v7] Global error:", event.message);
});
self.addEventListener("unhandledrejection", (event) => {
  console.error("[SW v7] Unhandled rejection:", event.reason);
});
