'use client';

import { useEffect } from 'react';

// A ChunkLoadError means this tab is running JS from a build that no longer exists on
// the server: the page bundle it loaded names its lazy chunks by content hash, and a
// redeploy replaced them. Nothing the page does can recover, because the file it wants
// is genuinely gone — every lazily-loaded panel silently fails to mount, which reads to
// the user as "the admin is unresponsive".
//
// Recovery is to drop the stale caches and reload once. Guarded by sessionStorage so a
// genuinely missing chunk can't turn into a reload loop; the second occurrence is left
// to surface as a real error instead of hiding behind endless refreshes.

const FLAG = 'alive_chunk_reload';

function isChunkLoadError(value: unknown): boolean {
  const msg =
    value instanceof Error ? `${value.name}: ${value.message}`
    : typeof value === 'string' ? value
    : '';
  return /ChunkLoadError|Loading chunk \d+ failed|Importing a module script failed/i.test(msg);
}

async function recover() {
  if (sessionStorage.getItem(FLAG)) return; // already tried once this session
  sessionStorage.setItem(FLAG, '1');

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    // Unregister rather than update: the stale worker is what served the dead bundle,
    // and a fresh registration on reload picks up the current one.
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // Even if cleanup fails, still reload — the reload alone often re-fetches fresh HTML.
  }
  window.location.reload();
}

export default function ChunkErrorRecovery() {
  useEffect(() => {
    // Clear the guard once a load completes without a chunk failure, so a later
    // deployment gets its own single recovery attempt.
    const clearFlag = setTimeout(() => sessionStorage.removeItem(FLAG), 10_000);

    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error) || isChunkLoadError(e.message)) void recover();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) void recover();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      clearTimeout(clearFlag);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
