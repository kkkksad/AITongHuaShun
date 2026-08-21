// KAIROS Quant Workbench — Service Worker
// Provides offline caching for static assets and app shell.

const CACHE_NAME = "kairos-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
];

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Graceful fallback: some assets may not be available during dev
      });
    })
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  // Claim all clients so the SW controls pages immediately
  self.clients.claim();
});

// Fetch: network-first for navigation, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // For navigation requests (HTML pages), use network-first
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a clone of the response
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // Offline: serve cached page or fallback
          return caches.match(request).then(
            (cached) => cached || caches.match("/")
          );
        })
    );
    return;
  }

  // Hashed bundles must prefer the current deployment. The cache remains an
  // offline fallback so a temporary network failure does not blank the app.
  if (new URL(request.url).pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(
          (cached) => cached || new Response("", { status: 408, statusText: "Offline" }),
        )),
    );
    return;
  }

  // For other static assets, use cache-first with network fallback.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache successful responses for future offline use
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // If both cache and network fail, return nothing
          return new Response("", { status: 408, statusText: "Offline" });
        });
    })
  );
});
