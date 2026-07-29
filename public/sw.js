// v2: v1 served the shell (including manifest.webmanifest and icon.svg) pure
// cache-first under a cache name that never changed across deploys, so an
// edit to either -- like this session's new PNG icon entries -- would stay
// invisible to anyone who already had a v1 cache. Static, content-hashed
// Next.js build assets (/_next/static/*) are unaffected by that risk since
// each deploy gives them a new URL, but the unhashed shell files are not.
// Stale-while-revalidate fixes it structurally rather than just once: a
// cached response still answers instantly, but every fetch also updates the
// cache in the background, so staleness is at most one visit, not forever.
const CACHE_NAME = "river-room-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/")),
    );
    return;
  }

  const cacheable = SHELL.includes(url.pathname)
    || url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/sounds/")
    || url.pathname.startsWith("/avatars/");
  if (!cacheable) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
