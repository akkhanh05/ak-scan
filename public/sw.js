/*
 * AK Scan service worker: makes the app usable offline after one visit.
 * It never sees document content — files are processed in memory and are not
 * fetched over the network, so nothing user-provided is cached here.
 *
 *  - Navigations: network first, cached page when offline.
 *  - Hashed build assets (/_next/static): cache first (immutable).
 *  - OCR engine, PDF worker, models, font, icons: stale-while-revalidate,
 *    in a cache keyed by OCR_ASSET_VERSION (must match workflow/shared/core/ocr-config.ts).
 */
const OCR_ASSET_VERSION = "2026-11-best-int-1";
const PAGES = "ak-scan-pages-v1";
const STATIC = "ak-scan-static-v1";
const RUNTIME = `ak-scan-runtime-${OCR_ASSET_VERSION}`;
const KEEP = new Set([PAGES, STATIC, RUNTIME]);
const scope = new URL(self.registration.scope);
const base = scope.pathname.replace(/\/$/, "");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((cache) => cache.add(new Request(`${base}/`, { cache: "reload" }))).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("ak-scan-") && !KEEP.has(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

function isRuntimeAsset(path) {
  return path.startsWith(`${base}/tessdata/`) || path.startsWith(`${base}/tesseract-`) || path === `${base}/pdf.worker.min.mjs` || path === `${base}/render-worker.js`
    || /\.(ttf|png|svg|ico|webmanifest)$/.test(path);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(PAGES).then((cache) => cache.put(`${base}/`, copy)); }
      return response;
    }).catch(async () => (await caches.match(`${base}/`)) ?? Response.error()));
    return;
  }

  if (url.pathname.startsWith(`${base}/_next/static/`)) {
    event.respondWith(caches.open(STATIC).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  if (isRuntimeAsset(url.pathname)) {
    event.respondWith(caches.open(RUNTIME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response; });
      if (cached) { event.waitUntil(network.catch(() => undefined)); return cached; }
      return network;
    }));
  }
});
