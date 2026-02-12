const CACHE_VERSION = "bf-cache-v40";
const APP_SHELL = [
  "index.html",
  "chat.html",
  "shop.html",
  "product.html",
  "cart.html",
  "contact.html",
  "about.html",
  "account.html",
  "auth.html",
  "terms.html",
  "privacy.html",
  "admin/index.html",
  "admin/products.html",
  "admin/orders.html",
  "admin/users.html",
  "admin/stats.html",
  "admin/chat.html",
  "assets/css/styles.css",
  "assets/js/app.js",
  "assets/js/i18n.js",
  "assets/js/firebase-ui.js",
  "assets/js/chat-client.js",
  "assets/js/admin-chat.js",
  "assets/js/cart.js",
  "assets/js/ai-config.js",
  "assets/js/email-config.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML to keep content fresh.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("index.html")))
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
});

