// Service Worker — Inscriptor PWA
// Gère le cache ET les notifications push locales via sync périodique

const CACHE        = "inscriptor-v3";
const APPS_SCRIPT  = "https://script.google.com/macros/s/AKfycbzAN85HlVDl1P7MBWIXVdoaEHKP4HU3cxIM8NFO61ijiiDPyyWtvmfMSCGVrE7p_utJUQ/exec";
const ASSETS = ["/inscriptor/", "/inscriptor/index.html", "/inscriptor/manifest.json"];
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── Cache ─────────────────────────────────────────────────────────────────────

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
  // Démarrer la vérification périodique
  scheduleCheck();
});

self.addEventListener("fetch", e => {
  if (e.request.url.includes("script.google.com") || e.request.url.includes("fonts.googleapis.com")) return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});

// ── Messages depuis l'app ─────────────────────────────────────────────────────

self.addEventListener("message", e => {
  if (e.data.type === "SAVE_SNAPSHOT") {
    // L'app envoie la liste actuelle pour initialiser le snapshot
    saveSnapshot(e.data.snapshot);
  }
  if (e.data.type === "START_CHECK") {
    scheduleCheck();
  }
});

// ── Vérification périodique ───────────────────────────────────────────────────

let checkTimer = null;

function scheduleCheck() {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(doCheck, CHECK_INTERVAL_MS);
}

async function doCheck() {
  try {
    await checkForChanges();
  } catch(e) {
    // Silencieux
  }
  scheduleCheck(); // Reprogrammer après chaque check
}

async function checkForChanges() {
  // Récupérer le snapshot sauvegardé
  const cache   = await caches.open(CACHE);
  const snapRes = await cache.match("/__snapshot__");
  if (!snapRes) return; // Pas encore de snapshot → attendre que l'app en envoie un
  const snapshot = await snapRes.json();

  // Chercher la prochaine soirée (jeudi)
  const now  = new Date();
  const day  = now.getDay();
  const diff = day <= 4 ? 4 - day : 4 - day + 7;
  const next = new Date(now);
  next.setHours(0,0,0,0);
  next.setDate(now.getDate() + diff);
  const key = "badminton-" + next.getFullYear() + "-" + (next.getMonth()+1) + "-" + next.getDate();

  // Appeler l'API
  const url  = APPS_SCRIPT + "?action=list&week=" + key + "&_cb=" + Date.now();
  const res  = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!data.success) return;

  const newPlayers  = (data.players  || []).map(p => p.name);
  const newWaitlist = (data.waitlist || []).map(p => p.name);
  const oldPlayers  = snapshot[key] ? snapshot[key].players  : [];
  const oldWaitlist = snapshot[key] ? snapshot[key].waitlist : [];

  const notifications = [];

  // Nouveaux inscrits
  newPlayers.forEach(name => {
    if (!oldPlayers.includes(name))
      notifications.push({ title: "🏸 Nouvelle inscription", body: name + " s'est inscrit·e pour jeudi !" });
  });
  // Désistements
  oldPlayers.forEach(name => {
    if (!newPlayers.includes(name))
      notifications.push({ title: "🏸 Désistement", body: name + " s'est retiré·e de jeudi." });
  });
  // Rejoindre liste d'attente
  newWaitlist.forEach(name => {
    if (!oldWaitlist.includes(name))
      notifications.push({ title: "⏳ Liste d'attente", body: name + " rejoint la liste d'attente pour jeudi." });
  });
  // Promotion liste d'attente
  newWaitlist.forEach(name => {
    if (oldWaitlist.includes(name) && newPlayers.includes(name))
      notifications.push({ title: "🎉 Promotion", body: name + " passe de la liste d'attente aux inscrits !" });
  });

  // Envoyer les notifications
  const perm = await self.registration.pushManager.permissionState({ userVisibleOnly: true }).catch(() => "denied");

  for (const notif of notifications) {
    await self.registration.showNotification(notif.title, {
      body:    notif.body,
      icon:    "/inscriptor/icon-192.png",
      badge:   "/inscriptor/icon-192.png",
      tag:     "inscriptor-" + Date.now(),
      vibrate: [100, 50, 100],
      data:    { url: "/inscriptor/" }
    });
  }

  // Mettre à jour le snapshot
  const newSnapshot = Object.assign({}, snapshot);
  newSnapshot[key] = { players: newPlayers, waitlist: newWaitlist };
  await saveSnapshot(newSnapshot);
}

async function saveSnapshot(snapshot) {
  const cache = await caches.open(CACHE);
  await cache.put("/__snapshot__", new Response(JSON.stringify(snapshot), {
    headers: { "Content-Type": "application/json" }
  }));
}

// ── Clic sur une notification ─────────────────────────────────────────────────

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(cls => {
      for (const c of cls) {
        if (c.url.includes("/inscriptor/") && "focus" in c) return c.focus();
      }
      return clients.openWindow("/inscriptor/");
    })
  );
});
