const CACHE_NAME = "smart-commute-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Forecasts and participation are time-sensitive/private; never cache or HTML-fallback APIs.
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  const isStaticAsset = url.pathname.startsWith("/_next/static/") ||
    ["/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"].includes(url.pathname);
  if (!isStaticAsset) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
      }
      return response;
    })),
  );
});
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  const title = payload.title || "Smart Commute";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "Open Smart Commute for your latest journey advice.",
    icon: "/icon.svg",
    badge: "/icon-maskable.svg",
    tag: payload.decisionId ? `commute-${payload.decisionId}` : "smart-commute",
    renotify: false,
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then((windows) => windows.forEach((client) => client.postMessage({ type: "push-subscription-changed" }))));
});
