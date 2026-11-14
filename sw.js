// Offline support: keeps a copy of the app's own files on the device.
// Online it always fetches fresh files (network first) and refreshes the copy;
// it only falls back to the saved copy when the network fails or is slow.
// Store data is handled separately by Firestore's offline cache.
const CACHE = "postremio-v1";
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  "./",
  "index.html",
  "app.js",
  "styles.css",
  "html2canvas.min.js",
  "vendor/firebase/firebase-app-compat.js",
  "vendor/firebase/firebase-auth-compat.js",
  "vendor/firebase/firebase-firestore-compat.js",
  "logo.jpeg",
  "ticket_logo.jpg",
  "icon-192.png",
  "apple-touch-icon.png",
  "favicon.png",
  "besosnuez.jpg",
  "bites.jpg",
  "brownie.jpg",
  "canela.jpg",
  "carlota.jpg",
  "cheesecake_fresa.jpg",
  "cheesecake_nutella.jpg",
  "crookie.jpg",
  "fresa.jpg",
  "kinder.jpg",
  "lotus.jpg",
  "lucky.jpg",
  "mini_cake.jpg",
  "mms.jpg",
  "oreo.jpg",
  "pan_zanahoria.jpg",
  "pandemuerto.jpg",
  "pastel_rv.jpg",
  "pay_elote.jpg",
  "pistache.jpg",
  "redvelvet.jpg",
  "rol.jpg",
  "tres_leches.jpg",
  "turin.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, fallbackUrl) {
  return new Promise(resolve => {
    let settled = false;
    const fromCache = () =>
      caches.open(CACHE)
        .then(cache => cache.match(request, { ignoreSearch: true }).then(hit => hit || (fallbackUrl && cache.match(fallbackUrl))))
        .then(hit => hit || Response.error());

    const timer = setTimeout(() => {
      fromCache().then(hit => { if (!settled && hit.type !== "error") { settled = true; resolve(hit); } });
    }, NETWORK_TIMEOUT_MS);

    // Navigations must be fetched as-is (redirect handling); other files bypass the HTTP cache
    fetch(request, request.mode === "navigate" ? undefined : { cache: "no-cache" }).then(response => {
      clearTimeout(timer);
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      if (!settled) { settled = true; resolve(response); }
    }).catch(() => {
      clearTimeout(timer);
      if (!settled) fromCache().then(hit => { settled = true; resolve(hit); });
    });
  });
}

function cacheFirst(request) {
  return caches.open(CACHE).then(cache =>
    cache.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }))
  );
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // Firebase/Google APIs: untouched
  if (url.pathname.endsWith("/diagnostico.html")) return;    // always live
  if (url.pathname.endsWith("/sw.js")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "index.html"));
  } else if (/\.(jpg|jpeg|png|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
