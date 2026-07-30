// ALIVE Partner — Service Worker
// Strategy:
//   - API routes  → network-first (fresh data, fall back to cache)
//   - Static assets → cache-first (JS, CSS, images, fonts)
//   - Navigation   → network-first, fall back to /offline if totally offline

// Bumped v1 -> v2 deliberately. The activate handler deletes every cache whose name
// isn't CACHE, so changing this name purges the stale Next.js bundles that were
// causing ChunkLoadError on already-affected browsers — they self-heal on next load.
const CACHE     = 'alive-partner-v2';
const PRECACHE  = [
  '/store-dashboard',
  '/store',
  '/offline',
];

// ── Install: precache the shell ───────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // Use { cache: 'reload' } so we always get a fresh copy on install
      Promise.allSettled(PRECACHE.map((url) => c.add(new Request(url, { cache: 'reload' }))))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API routes and auth — always network-first, short timeout fallback
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    e.respondWith(networkFirst(request));
    return;
  }

  // Next.js RSC payloads and any HTML — ALWAYS network-first, never served stale.
  // This is what caused ChunkLoadError: an RSC payload fell through to
  // stale-while-revalidate below, so a client-side navigation could be handed a cached
  // payload from an earlier deployment. That payload names chunk filenames by content
  // hash, and after a redeploy those files no longer exist on the server — the lazy
  // import then 404s and the panel never mounts. Fresh RSC/HTML always references
  // chunks that currently exist, which is also what makes cache-first safe below.
  const isRsc =
    url.searchParams.has('_rsc') ||
    request.headers.get('RSC') === '1' ||
    request.destination === 'document' ||
    (request.headers.get('Accept') || '').includes('text/html');
  if (isRsc || request.mode === 'navigate') {
    e.respondWith(navigationHandler(request));
    return;
  }

  // Static assets (Next.js /_next/) — cache-first. Safe because these URLs are
  // content-hashed and immutable: a given URL's bytes never change.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — stale-while-revalidate
  e.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached ?? new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res.ok) {
      // Clone SYNCHRONOUSLY, before the response is returned and its body consumed.
      // Cloning inside the async caches.open() callback ran after the body had already
      // been handed to the page, which threw "Failed to execute 'clone' on 'Response':
      // Response body is already used" and left the cache write silently broken.
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => cached);
  return cached ?? fetchPromise;
}

async function navigationHandler(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline');
    return offline ?? new Response('<h1>You are offline</h1>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }
}
