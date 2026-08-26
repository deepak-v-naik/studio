'use client';

import { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISSED_KEY = 'alive_pwa_dismissed';

export function PwaRegister() {
  // Register service worker — production only. In dev the SW's cache-first on
  // /_next/static/ is poison: Turbopack reuses chunk URLs with different
  // content across rebuilds, so a cached chunk from an earlier run crashes the
  // page with "module factory is not available" until the SW is cleared by
  // hand. Prod chunk URLs are content-hashed, so caching is safe there.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      // Also clean up any worker left behind by a previous prod visit or an
      // older build of this component on localhost.
      navigator.serviceWorker.getRegistrations()
        .then((regs) => regs.forEach((r) => { void r.unregister(); }))
        .catch(() => { /* non-fatal */ });
      return;
    }
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => { /* non-fatal */ });
  }, []);

  return null;
}

// Shown only on store-dashboard — nudges mobile users to install
export function PwaInstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show,   setShow]   = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode) or previously dismissed
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setShow(false);
  };

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISSED_KEY, '1');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl border border-border bg-card shadow-2xl p-4 flex items-center gap-3 max-w-sm mx-auto">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <span className="text-lg font-black text-primary leading-none">A</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">Add ALIVE to Home Screen</p>
        <p className="text-[11px] text-muted-foreground">Works offline · No App Store needed</p>
      </div>
      <button
        onClick={() => void install()}
        className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white shrink-0"
      >
        <Download className="h-3.5 w-3.5" /> Install
      </button>
      <button onClick={dismiss} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
