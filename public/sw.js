/*
 * Worship+ service worker — Phase 1: installable app shell only.
 *
 * Strategy:
 *   - Cross-origin requests (Supabase song data, Stripe, Anthropic, etc.) are
 *     never intercepted — they pass straight to the network and are NEVER
 *     cached. This is what keeps song data out of the cache (Phase 2 territory).
 *   - Same-origin navigations / app shell: network-first with a cached fallback
 *     so the app opens instantly and still loads when offline.
 *   - Same-origin static assets (/_next/static, icons, fonts, images): cache-first
 *     since they are content-hashed and immutable.
 *   - Same-origin /api/* routes: network-first WITHOUT writing to cache, so no
 *     dynamic/song-related responses are persisted.
 */

// Bump this on every deploy that ships client changes. Changing the string makes
// the browser see a byte-different sw.js → install → skipWaiting → activate, whose
// handler deletes every cache not in the current-version list (below) and calls
// clients.claim(), so fresh assets take over on the next load with no manual
// refresh. (Navigations are already network-first, so online users get new HTML +
// content-hashed chunks regardless; this guarantees stale caches are dropped too.)
const VERSION = "2026-07-02a";
const STATIC_CACHE = `wp-static-${VERSION}`;
const PAGES_CACHE = `wp-pages-${VERSION}`;

// Minimal precache: the manifest + icons. The HTML shell is cached at runtime
// (it is an authenticated SSR page, so we don't precache it at install time).
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![STATIC_CACHE, PAGES_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:css|js|woff2?|ttf|otf|eot|png|jpe?g|svg|webp|avif|gif|ico)$/i.test(
      url.pathname
    )
  );
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, { store = true } = {}) {
  try {
    const response = await fetch(request);
    if (store && response && response.ok && response.type === "basic") {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("/app");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET — POST/PUT/etc. (Stripe, AI generation, mutations) pass through.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept cross-origin requests (Supabase song data, Stripe, fonts CDN…).
  if (url.origin !== self.location.origin) return;

  // API routes: network-first, but do not persist responses (no song data caching).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, PAGES_CACHE, { store: false }));
    return;
  }

  // Static, content-hashed assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navigations and everything else same-origin: network-first with cached fallback.
  event.respondWith(networkFirst(request, PAGES_CACHE));
});
