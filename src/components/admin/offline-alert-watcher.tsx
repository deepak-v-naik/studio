'use client';

// Polls for screen-offline alerts and pops a toast in the admin panel the
// moment a screen drops, plus keeps the header bell's unread count live.
//
// Uses sonner rather than the shadcn toast: src/hooks/use-toast.ts sets
// TOAST_LIMIT = 1 with a ~16-minute removal delay, so a fleet-wide outage would
// collapse into a single stuck popup. Sonner stacks and auto-dismisses.
//
// Renders nothing — it's a behaviour-only component mounted once by the admin
// shell.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const POLL_MS = 45_000;
const SS_PW   = 'alive_admin_pw';

type AlertRow = {
  id: string;
  status: 'OPEN' | 'RESOLVED';
  severity: string;
  deviceName: string;
  storeName: string | null;
  startedAt: string;
  resolvedAt: string | null;
  adminReadAt: string | null;
};

export default function OfflineAlertWatcher({
  onUnreadChange, onOpenAlerts,
}: {
  onUnreadChange?: (n: number) => void;
  onOpenAlerts?: () => void;
}) {
  // Alert ids already surfaced in this browser session, so a poll never
  // re-toasts something the admin has already seen pop up.
  const seenOpen     = useRef<Set<string>>(new Set());
  const seenResolved = useRef<Set<string>>(new Set());
  const primed       = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const pw = sessionStorage.getItem(SS_PW) ?? '';
      if (!pw) return;
      try {
        const res = await fetch('/api/admin/alerts', { headers: { 'admin-password': pw } });
        if (!res.ok || cancelled) return;
        const { alerts, unread } = await res.json() as { alerts: AlertRow[]; unread: number };

        onUnreadChange?.(unread);

        // The API returns at most 100 rows and drops resolved ones after an
        // hour, so bound the seen-sets to that same horizon — otherwise a panel
        // left open for days grows them without limit.
        if (seenOpen.current.size > 500) {
          const live = new Set(alerts.map((a) => a.id));
          seenOpen.current     = new Set([...seenOpen.current].filter((id) => live.has(id)));
          seenResolved.current = new Set([...seenResolved.current].filter((id) => live.has(id)));
        }

        // First poll after a page load: record what's already outstanding
        // WITHOUT toasting. Otherwise opening /admin during an ongoing outage
        // would blast one popup per already-known offline screen.
        if (!primed.current) {
          for (const a of alerts) {
            (a.status === 'OPEN' ? seenOpen : seenResolved).current.add(a.id);
          }
          primed.current = true;
          return;
        }

        const freshlyOffline = alerts.filter((a) => a.status === 'OPEN' && !seenOpen.current.has(a.id));
        // Only celebrate a recovery whose outage THIS tab actually reported.
        // Otherwise a tab opened after a screen dropped would pop a bare
        // "X is back online" for an outage the admin was never told about.
        const freshlyBack = alerts.filter((a) =>
          a.status === 'RESOLVED' && seenOpen.current.has(a.id) && !seenResolved.current.has(a.id));

        for (const a of freshlyOffline) seenOpen.current.add(a.id);
        for (const a of freshlyBack)    seenResolved.current.add(a.id);

        // Aggregate a mass outage into one popup — 12 separate toasts for a
        // city-wide power cut is noise, not a signal.
        if (freshlyOffline.length > 2) {
          toast.error(`${freshlyOffline.length} screens went offline`, {
            description: freshlyOffline.slice(0, 4).map((a) => a.storeName ?? a.deviceName).join(', ')
              + (freshlyOffline.length > 4 ? ` +${freshlyOffline.length - 4} more` : ''),
            duration: 15000,
            action: onOpenAlerts ? { label: 'View', onClick: onOpenAlerts } : undefined,
          });
        } else {
          for (const a of freshlyOffline) {
            toast.error(`${a.storeName ?? 'Unassigned'} — screen offline`, {
              description: `${a.deviceName} stopped responding. Check power and internet at the store.`,
              duration: 15000,
              action: onOpenAlerts ? { label: 'View', onClick: onOpenAlerts } : undefined,
            });
          }
        }

        for (const a of freshlyBack) {
          toast.success(`${a.storeName ?? a.deviceName} is back online`, { duration: 6000 });
        }
      } catch { /* transient — the next poll retries */ }
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [onUnreadChange, onOpenAlerts]);

  return null;
}
