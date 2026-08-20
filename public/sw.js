// ALIVE Partner — Service Worker
// Strategy:
//   - API routes  → network-first (fresh data, fall back to cache)
//   - Static assets → cache-first (JS, CSS, images, fonts)
//   - Navigation   → network-first, fall back to /offline if totally offline

// Bumped v1 -> v2 deliberately. The activate handler deletes every cache whose name
// isn't CACHE, so changing this name purges the stale Next.js bundles that were
// causing ChunkLoadError on already-affected browsers — they self-heal on next load.
// v2 -> v3: adds the push / notificationclick handlers below. The activate
// handler deletes every cache whose name isn't CACHE, so bumping this is what
// makes already-installed workers pick up the new script.
const CACHE     = 'alive-partner-v3';
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

// ── Push: screen-offline alerts ──────────────────────────────────────────────
// Payload is the JSON sent by src/lib/web-push.ts:
//   { title, body, url?, tag? }
// `tag` is the alert id, so the "back online" notification replaces the
// "offline" one in the tray instead of stacking a second, contradictory alert.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* malformed payload */ }

  const title = data.title || 'ALIVE';
  const options = {
    body: data.body || '',
    // Matches src/app/manifest.ts. NOTE: public/icons/ currently holds only a
    // README — until those PNGs are generated the browser falls back to its
    // default icon (the notification still shows).
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'alive-alert',
    renotify: true,
    data: { url: data.url || '/store-dashboard' },
  };
  // waitUntil keeps the worker alive until the notification is actually shown.
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/store-dashboard';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an already-open dashboard tab rather than piling up new ones.
    for (const client of all) {
      if (client.url.includes(target) && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
