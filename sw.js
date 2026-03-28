// Service Worker — Inscriptor PWA
const CACHE = "inscriptor-v1";
const ASSETS = [
  "/inscriptor/",
  "/inscriptor/index.html",
  "/inscriptor/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Pour les appels Google Apps Script : toujours réseau (pas de cache)
  if (e.request.url.includes("script.google.com") || e.request.url.includes("fonts.googleapis.com")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
