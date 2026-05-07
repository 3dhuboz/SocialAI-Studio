/**
 * Service worker — minimal PWA shell.
 *
 *  • Network-first for HTML navigations so the user always sees the freshest
 *    shell when online; falls back to a cached "/" if the network is dead.
 *  • Cache-first for hashed Vite assets (filenames change on every build,
 *    so the cache never stales — old entries get evicted on activate).
 *  • Same-origin only — never proxies the API or third-party requests.
 *  • Bump CACHE_VERSION below to force-evict on the next deploy.
 */
const CACHE_VERSION = 'sai-v1';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const SHELL_FALLBACK = '/';

self.addEventListener('install', (event) => {
  // Pre-cache the shell so we have something to show when the user is
  // offline. Failure here doesn't block install — the SW still activates.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_FALLBACK)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Evict stale caches from previous CACHE_VERSIONs.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only handle same-origin requests. APIs, fonts.googleapis, Clerk, PayPal,
  // YouTube, Facebook etc. all hit the network directly — the SW never
  // touches them.
  if (url.origin !== self.location.origin) return;

  // Skip the SW file itself and the manifest so they always come fresh.
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

  // HTML navigations — network-first with cached-shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update the cached shell on every successful navigation.
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_FALLBACK, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL_FALLBACK))
    );
    return;
  }

  // Hashed Vite assets — cache-first, lazy populate.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            // Only cache successful, basic responses.
            if (res && res.status === 200 && res.type === 'basic') {
              cache.put(req, res.clone());
            }
            return res;
          });
        })
      )
    );
    return;
  }

  // Everything else (logo.svg, manifest icons, _headers, etc.) falls
  // through to default browser behaviour.
});
