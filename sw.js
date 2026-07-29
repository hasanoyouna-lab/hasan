// Service Worker: يخزّن هيكل التطبيق (HTML/CSS/JS) محلياً حتى يفتح بدون إنترنت نهائياً.
// لا يتدخل أبداً بطلبات API_URL (Apps Script) — تلك تمر مباشرة للشبكة ويديرها js/api.js و js/offline.js.

const CACHE_NAME = "attendance-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./css/style.css",
  "./assets/logo.png",
  "./js/config.js",
  "./js/api.js",
  "./js/offline.js",
  "./js/kiosk.js",
  "./js/admin.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // طلبات الكتابة (POST لـ Apps Script) تمر عادي
  if (new URL(req.url).origin !== self.location.origin) return; // ملفات خارجية (Apps Script) لا تُعترض

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
