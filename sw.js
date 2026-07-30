// Service Worker: يخزّن هيكل التطبيق (HTML/CSS/JS/الخطوط) محلياً حتى يفتح بدون إنترنت نهائياً.
// لا يتدخل أبداً بطلبات API_URL (Apps Script) — تلك تمر مباشرة للشبكة ويديرها js/api.js و js/offline.js.

const CACHE_NAME = "attendance-shell-v11";
const ASSET_V = "11"; // لازم يطابق ?v= المكتوب بملفات HTML
const SHELL_FILES = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./css/style.css?v=" + ASSET_V,
  "./assets/logo.png",
  "./assets/fonts/tajawal-400-ar.woff2",
  "./assets/fonts/tajawal-400-lat.woff2",
  "./assets/fonts/tajawal-700-ar.woff2",
  "./assets/fonts/tajawal-700-lat.woff2",
  "./assets/fonts/tajawal-800-ar.woff2",
  "./assets/fonts/tajawal-800-lat.woff2",
  "./js/config.js?v=" + ASSET_V,
  "./js/api.js?v=" + ASSET_V,
  "./js/icons.js?v=" + ASSET_V,
  "./js/offline.js?v=" + ASSET_V,
  "./js/kiosk.js?v=" + ASSET_V,
  "./js/admin.js?v=" + ASSET_V
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

  // شبكة أولاً (عشان أي تحديث للكود ينعكس فورًا وأنت متصل)، وكاش كخطة بديلة لو النت مقطوع.
  // ignoreSearch بالبديل: لو رقم النسخة (?v=) تغيّر وما لحقنا نخزّن الجديد، بنرجع
  // للنسخة المخزّنة من نفس الملف بدل ما نطلع صفحة مكسورة أوفلاين.
  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || caches.match(req, { ignoreSearch: true }))
    )
  );
});
