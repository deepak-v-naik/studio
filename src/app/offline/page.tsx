// This page is served by the service worker when a navigation fetch fails.
// CRITICAL: it must work WITHOUT hydration. When the SW serves this page as a
// fallback, its Next.js chunks are usually not cached, so with the network down
// React never hydrates — a useEffect or onClick here would be dead code. All
// behavior lives in the inline <script> below, which runs from the raw HTML.
//
// The script:
//   - wires up the Try-again button (a React onClick would need hydration)
//   - auto-reloads when the browser fires `online`, and probes the server every
//     5s regardless, because navigator.onLine can stay true through a blip.
//     The probe uses a unique query string so the SW's networkFirst handler
//     can't satisfy it from cache — success means the server is truly reachable.
//   - skips auto-reload when the URL is literally /offline (someone opened this
//     page directly while online — reloading would loop forever). When served
//     as a fallback the address bar keeps the requested route (/admin, /store…),
//     so reloading retries that route.
const RECOVERY_SCRIPT = `
(function () {
  var btn = document.getElementById('offline-retry');
  if (btn) btn.addEventListener('click', function () { location.reload(); });
  if (location.pathname === '/offline') return;
  var reloading = false;
  function probe() {
    if (reloading) return;
    fetch('/api/health?probe=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (res.ok && !reloading) { reloading = true; location.reload(); }
      })
      .catch(function () { /* still offline — keep waiting */ });
  }
  window.addEventListener('online', probe);
  setInterval(probe, 5000);
  probe();
})();
`;

export default function OfflinePage() {
  return (
    <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center', fontFamily: '"Manrope", system-ui, sans-serif' }}>
      <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.03em', marginBottom: 48, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.4 }}>
        alive<span style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc2626', display: 'inline-block', transform: 'translateY(1px)' }} />
      </div>
      <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#dc2626', fontWeight: 600, marginBottom: 20 }}>
        No connection
      </div>
      <h1 style={{ fontWeight: 700, fontSize: 'clamp(22px, 5vw, 36px)', letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 14px', maxWidth: '16ch' }}>
        You&apos;re offline right now
      </h1>
      <p style={{ fontSize: 15, color: '#737373', lineHeight: 1.65, margin: '0 0 36px', maxWidth: '34ch' }}>
        Your data is saved. This page reconnects automatically the moment you&apos;re back online.
      </p>
      <button
        id="offline-retry"
        type="button"
        style={{ padding: '12px 28px', borderRadius: 999, border: 'none', background: '#0a0a0a', color: '#fff', fontFamily: '"Manrope", sans-serif', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
      >
        Try again
      </button>
      <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
    </div>
  );
}
