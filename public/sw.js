// v2: v1 served the shell (including manifest.webmanifest and icon.svg) pure
// cache-first under a cache name that never changed across deploys, so an
// edit to either -- like this session's new PNG icon entries -- would stay
// invisible to anyone who already had a v1 cache. Static, content-hashed
// Next.js build assets (/_next/static/*) are unaffected by that risk since
// each deploy gives them a new URL, but the unhashed shell files are not.
// Stale-while-revalidate fixes it structurally rather than just once: a
// cached response still answers instantly, but every fetch also updates the
// cache in the background, so staleness is at most one visit, not forever.
// v3: dropped the 192/512 PNG entries (no such files pending a replacement
// icon set) and stopped precaching atomically.
//
// cache.addAll() rejects the whole batch if any single request 404s, and the
// rejection here was swallowed by .catch(() => {}) -- so deleting one icon
// silently took the entire offline shell with it, including "/". That is a
// lot of blast radius for one missing decorative file. Caching each entry
// independently means a missing asset costs exactly itself.
//
// v5: the 192/512/maskable PNG icons now exist (generated from icon.svg),
// so they're back in SHELL.
// v6: the icon set and app/icon.svg were both regenerated from the real
// "High Roller Arcade" logo at the same URLs. Stale-while-revalidate would
// get there eventually, but a home-screen icon is precisely the asset a
// player never re-fetches, so the cache name changes to force it.
// v7: /favicon.ico is new, app/icon.svg was repaired (a double hyphen inside
// an XML comment made it unparseable, so strict parsers refused to draw it at
// all), and the manifest's theme/background colours moved to matte obsidian.
// Same reasoning as v6: the cached copies are exactly the assets a returning
// player never re-fetches on their own.
// v8: push/notificationclick/pushsubscriptionchange handlers added below --
// no SHELL change, so the cache name is untouched; the browser's normal
// byte-diff update check is what picks this file up.
const CACHE_NAME = "stackchips-shell-v7";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      SHELL.map((url) => cache.add(url).catch(() => {})),
    )).catch(() => {}),
  );
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

// Re-engagement pushes -- see lib/server/push-service.ts for what sends
// these and lib/push/client.ts for how a device subscribes. The payload is
// plain JSON: { title, body, url }. A malformed/missing payload still shows
// a generic notification rather than silently doing nothing, since a push
// event with no visible notification is exactly what browsers revoke
// permission for.
self.addEventListener("push", (event) => {
  let payload = { title: "StackChips", body: "Come back and play.", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON payload: fall through to the generic text above.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

// Tapping the notification focuses an already-open StackChips tab instead of
// stacking a new one -- most players already have the PWA open somewhere.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

// The push service can rotate a subscription's endpoint out from under a
// device without the app open (a browser-level renewal, not a player
// action) -- the old endpoint just stops delivering silently otherwise.
// Re-subscribing and re-posting is the documented recovery; no VAPID key is
// available here to hand subscribe() explicitly, so this reuses whatever
// key the expiring subscription itself was created with.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? { applicationServerKey: event.oldSubscription.options.applicationServerKey, userVisibleOnly: true } : undefined)
      .then((subscription) => {
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys) return;
        return fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }),
        });
      })
      .catch(() => {}),
  );
});
