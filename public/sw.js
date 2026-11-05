// KAIROS Quant Workbench — Service Worker
// Provides offline caching only for approved same-origin static assets and app shell.

const CACHE_NAME = "kairos-v3";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];
const APP_ROUTES = new Set(["/", "/index.html", "/strategy", "/market", "/account", "/learning", "/settings"]);

function isCacheable(response, html = false) {
  return response.ok && response.type === "basic" && (!html ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "text/html");
}

function readCache(request) {
  return caches.open(CACHE_NAME).then((cache) => cache.match(request));
}

function cacheResponse(event, request, response, html = false) {
  if (!isCacheable(response, html)) return;
  const clone = response.clone();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined));
}

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(STATIC_ASSETS.map(async (path) => {
      try {
        const response = await fetch(path);
        if (isCacheable(response, path === "/" || path === "/index.html")) await cache.put(path, response);
      } catch {
        // Keep other approved assets available if one pre-cache read fails.
      }
    }))).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith("kairos-") && key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for navigation, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // API, unknown paths and cross-origin reads must reach the network directly.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const route = url.pathname.replace(/\/+$/, "") || "/";
  const navigation = request.mode === "navigate" && APP_ROUTES.has(route);
  const shell = url.pathname === "/" || url.pathname === "/index.html";
  const asset = url.pathname.startsWith("/assets/");
  if (!navigation && !shell && !asset && !STATIC_ASSETS.includes(url.pathname)) return;

  // Known app navigation uses network-first HTML with an offline shell fallback.
  if (navigation || shell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(event, request, response, true);
          return response;
        })
        .catch(async () => (await readCache(request)) || (await readCache("/")) ||
          new Response("", { status: 408, statusText: "Offline" }))
    );
    return;
  }

  // Hashed bundles must prefer the current deployment. The cache remains an
  // offline fallback so a temporary network failure does not blank the app.
  if (asset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(event, request, response);
          return response;
        })
        .catch(() => readCache(request).then(
          (cached) => cached || new Response("", { status: 408, statusText: "Offline" }),
        )),
    );
    return;
  }

  // Approved public icons and manifest use cache-first with network fallback.
  event.respondWith(
    readCache(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          cacheResponse(event, request, response);
          return response;
        })
        .catch(() => {
          // If both cache and network fail, return nothing
          return new Response("", { status: 408, statusText: "Offline" });
        });
    })
  );
});
