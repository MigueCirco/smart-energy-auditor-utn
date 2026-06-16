const CACHE_NAME = "sea-pwa-v0.2.0";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css?v=0.2.0",
  "./app.js?v=0.2.0",
  "./manifest.webmanifest?v=0.2.0",
  "./version.json",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-16.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-icon-512.png",
  "./favicon.ico",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    throw error;
  }
}

function shouldHandle(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (request.mode === "navigate") return true;
  return [
    "/index.html",
    "/app.js",
    "/styles.css",
    "/manifest.webmanifest",
    "/version.json",
    "/favicon.ico",
  ].some((path) => url.pathname.endsWith(path)) || url.pathname.includes("/assets/icons/");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !shouldHandle(event.request)) return;
  event.respondWith(networkFirst(event.request));
});
