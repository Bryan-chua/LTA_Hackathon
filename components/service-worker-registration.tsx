"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js")
        .then(async () => {
          await navigator.serviceWorker.ready;
          if (!("caches" in window)) return;
          const urls = performance.getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((value) => {
              const url = new URL(value);
              return url.origin === location.origin &&
                (url.pathname.startsWith("/_next/static/") ||
                  ["/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg"].includes(url.pathname));
            });
          const cache = await caches.open("smart-commute-v3");
          await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
          window.dispatchEvent(new Event("smart-commute-offline-shell-ready"));
        })
        .catch(() => {
          // The app remains usable online if registration or cache warming is unavailable.
        });
    }
  }, []);

  return null;
}
