'use client';

// Partner-facing screen-offline banner + push opt-in.
//
// Two jobs:
//  1. Show the partner, in plain language, that their screen has stopped — and
//     the one thing they can do about it (check power / Wi-Fi).
//  2. Offer browser notifications, so they find out without opening this page.
//     Partners have no email on file, so push is the only channel that reaches
//     them proactively besides WhatsApp.
//
// Renders nothing when there's no alert and notifications are already on/denied,
// so a healthy store sees no clutter.

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Bell, Loader2, X } from 'lucide-react';

type AlertRow = {
  id: string;
  status: 'OPEN' | 'RESOLVED';
  severity: string;
  deviceName: string;
  lastSeenAt: string | null;
  startedAt: string;
  resolvedAt: string | null;
};

function since(iso: string | null): string {
  if (!iso) return 'a while';
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} minutes`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hour${hrs > 1 ? 's' : ''}` : `${Math.round(hrs / 24)} day(s)`;
}

// The VAPID public key must be sent to pushManager as a Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function ScreenAlertBanner({ storeId, token }: { storeId?: string; token?: string }) {
  const [alerts,   setAlerts]   = useState<AlertRow[]>([]);
  const [pushState, setPushState] = useState<'unsupported' | 'default' | 'granted' | 'denied' | 'busy'>('default');
  const [dismissedPrompt, setDismissedPrompt] = useState(false);
  const [pushError, setPushError] = useState(false);

  // Poll so a partner who leaves the dashboard open sees the change without a
  // manual refresh. 60s is well inside the ~5-min detection granularity.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // The signed token is required whenever there's no next-auth cookie —
        // right after registration, and in admin open-as-partner. Without it
        // resolveStoreId() returns null and this silently 401s, which would
        // leave exactly those partners never seeing an outage.
        const res = await fetch('/api/stores/alerts', {
          headers: token ? { 'x-store-token': token } : undefined,
        });
        if (!res.ok || cancelled) return;
        const d = await res.json() as { alerts: AlertRow[] };
        setAlerts(d.alerts ?? []);
      } catch { /* transient */ }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported'); return;
    }
    setPushState(Notification.permission as 'default' | 'granted' | 'denied');
    try { setDismissedPrompt(localStorage.getItem('alive_push_prompt_dismissed') === '1'); } catch { /* ignore */ }
  }, []);

  const enablePush = useCallback(async () => {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) return;
    setPushState('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setPushState(permission as 'denied' | 'default'); return; }

      const reg = await navigator.serviceWorker.ready;
      // Reuse an existing subscription if the browser already has one —
      // subscribing twice with the same key returns the same endpoint anyway.
      const sub = await reg.pushManager.getSubscription()
        ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid),
        });

      const qs = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
      const res = await fetch(`/api/stores/push-subscribe${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-store-token': token } : {}) },
        body: JSON.stringify(sub.toJSON()),
      });
      // The browser granting permission is only half of it — if the server
      // didn't store the subscription we'd never actually push, so don't tell
      // the partner notifications are on when they aren't.
      if (!res.ok) {
        await sub.unsubscribe().catch(() => { /* best-effort */ });
        setPushState('default');
        setPushError(true);
        return;
      }
      setPushError(false);
      setPushState('granted');
    } catch {
      setPushState('default');
      setPushError(true);
    }
  }, [storeId, token]);

  const dismissPrompt = () => {
    setDismissedPrompt(true);
    try { localStorage.setItem('alive_push_prompt_dismissed', '1'); } catch { /* ignore */ }
  };

  const open     = alerts.filter((a) => a.status === 'OPEN');
  const resolved = alerts.filter((a) => a.status === 'RESOLVED');
  // Only celebrate a recovery that happened in the last 2 hours.
  const justBack = resolved.find((a) => a.resolvedAt && Date.now() - new Date(a.resolvedAt).getTime() < 2 * 60 * 60 * 1000);

  const showPushPrompt =
    !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    pushState !== 'unsupported' && pushState !== 'granted' && pushState !== 'denied' &&
    !dismissedPrompt;

  if (!open.length && !justBack && !showPushPrompt) return null;

  return (
    <div className="space-y-3">
      {open.length > 0 && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">
              {open.length > 1 ? `${open.length} of your screens have stopped` : 'Your screen has stopped'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              No ads have played for about {since(open[0].lastSeenAt ?? open[0].startedAt)}.
              Please check that the screen is switched on and your Wi-Fi is working —
              it starts again on its own once it reconnects.
            </p>
            <a
              href="https://wa.me/919741324448?text=Hi+Alive+team,+my+screen+is+offline."
              target="_blank" rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition-colors"
            >
              Still not working? Message us
            </a>
          </div>
        </div>
      )}

      {!open.length && justBack && (
        <div className="rounded-2xl border border-green-500/25 bg-green-500/5 p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-foreground">Your screen is back online</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ads are playing again — nothing further needed.</p>
          </div>
        </div>
      )}

      {showPushPrompt && (
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
          <Bell className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Get alerted if your screen stops</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              We&apos;ll notify you on this phone so you can fix it quickly and keep earning.
            </p>
            <button
              onClick={() => void enablePush()}
              disabled={pushState === 'busy'}
              className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {pushState === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
              Turn on notifications
            </button>
            {pushError && (
              <p className="text-xs text-destructive mt-2">Could not turn on notifications — please try again.</p>
            )}
          </div>
          <button onClick={dismissPrompt} className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
