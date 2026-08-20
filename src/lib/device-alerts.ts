// Screen-offline alert lifecycle: open at the offline edge, escalate to the
// partner once the outage is sustained, resolve when the screen comes back.
//
// Timing rationale — the two audiences want different things:
//   • Admin  → told immediately at the edge. They're technical, they triage.
//   • Partner → told only after a SUSTAINED outage. The offline edge is already
//     20 min after the last heartbeat, and the player's heartbeat is a
//     WorkManager job Android clamps to a 15-min floor (so Doze/jitter alone can
//     trip it). Messaging a shopkeeper about a 20-minute blip that fixed itself
//     trains them to ignore us; waiting for ~1h of real downtime means the
//     message is always actionable ("check the plug / the router").

import { db } from '@/lib/db';
import { notifyAdminWA, notifyStoreWA, deviceOfflineAdminMsg, deviceOfflinePartnerMsg, deviceBackOnlineMsg } from '@/lib/notify';
import { pushToStore } from '@/lib/web-push';

/** Extra downtime past the offline edge before the partner is told. */
export const PARTNER_NOTIFY_AFTER_MS = 40 * 60 * 1000; // ≈60 min total downtime
/** Aggregate rather than spam when a whole batch drops at once (mains cut, ISP outage). */
const ADMIN_DIGEST_THRESHOLD = 3;

export type NewlyOfflineDevice = {
  id: string;
  name: string;
  storeId: string | null;
  lastSeen: Date | null;
  store?: { storeName: string } | null;
};

/**
 * Records an alert for each device that just crossed into OFFLINE and notifies
 * the admin. Skips devices that already have an OPEN alert, so a screen that
 * flaps offline→online→offline inside one incident doesn't stack rows.
 * Never throws — the cron's own bookkeeping must not fail because of alerting.
 */
export async function openOfflineAlerts(devices: NewlyOfflineDevice[]): Promise<number> {
  if (!devices.length) return 0;

  const opened: NewlyOfflineDevice[] = [];
  try {
    const existing = await db.deviceAlert.findMany({
      where: { deviceId: { in: devices.map((d) => d.id) }, status: 'OPEN' },
      select: { deviceId: true },
    });
    const alreadyOpen = new Set(existing.map((a) => a.deviceId));

    for (const d of devices) {
      if (alreadyOpen.has(d.id)) continue;
      await db.deviceAlert.create({
        data: {
          deviceId:   d.id,
          storeId:    d.storeId,
          type:       'OFFLINE',
          severity:   'warning',
          deviceName: d.name,
          storeName:  d.store?.storeName ?? null,
          lastSeenAt: d.lastSeen,
        },
      });
      opened.push(d);
    }
  } catch {
    return 0; // table not migrated yet, or a transient DB error — never break the sweep
  }

  if (!opened.length) return 0;

  // One message for a fleet-wide event, individual ones for isolated failures.
  if (opened.length >= ADMIN_DIGEST_THRESHOLD) {
    const lines = opened.slice(0, 10).map((d) => `• ${d.store?.storeName ?? 'Unassigned'} — ${d.name}`);
    const more  = opened.length > 10 ? `\n…and ${opened.length - 10} more` : '';
    void notifyAdminWA(
      `🔴 *${opened.length} screens went offline*\n${lines.join('\n')}${more}\n\nhttps://wearealive.in/admin`,
    );
  } else {
    for (const d of opened) {
      void notifyAdminWA(deviceOfflineAdminMsg({
        deviceName: d.name,
        storeName:  d.store?.storeName ?? null,
        lastSeen:   d.lastSeen,
      }));
    }
  }

  return opened.length;
}

/**
 * Notifies partners about outages that have now lasted long enough to be real,
 * and escalates their severity. Called once per cron sweep.
 * Returns the number of partners notified.
 */
export async function escalateSustainedOutages(now = new Date()): Promise<number> {
  let notified = 0;
  try {
    const due = await db.deviceAlert.findMany({
      where: {
        status:            'OPEN',
        partnerNotifiedAt: null,
        storeId:           { not: null },
        startedAt:         { lt: new Date(now.getTime() - PARTNER_NOTIFY_AFTER_MS) },
      },
      select: {
        id: true, storeId: true, deviceName: true, storeName: true, lastSeenAt: true, startedAt: true,
        // Current device state — the alert row is a snapshot and must not be
        // trusted on its own for either "is it still down" or "whose is it".
        device: { select: { status: true, storeId: true } },
      },
      take: 50, // a fleet-wide outage shouldn't blow the cron's time budget
    });

    for (const alert of due) {
      if (!alert.storeId) continue;

      // Self-healing guard. The alert says the screen is down, but that's a
      // snapshot; if the resolve write was ever lost we'd be telling a
      // shopkeeper their screen is dark while it plays in front of them.
      // Re-check live state, and close the alert instead of alarming them.
      if (alert.device && alert.device.status !== 'OFFLINE') {
        await db.deviceAlert.update({
          where: { id: alert.id },
          data:  { status: 'RESOLVED', resolvedAt: now },
        }).catch(() => {});
        continue;
      }

      // The screen may have been unlinked or moved to another store since the
      // alert opened. Notifying alert.storeId then would message the WRONG
      // partner about a screen that is no longer theirs — and they'd never get
      // a recovery notice, because the resolve routes by the same stale id.
      if (alert.device && alert.device.storeId !== alert.storeId) {
        await db.deviceAlert.update({
          where: { id: alert.id },
          data:  { status: 'RESOLVED', resolvedAt: now },
        }).catch(() => {});
        continue;
      }

      // Mark BEFORE sending: a duplicate alert is far worse for a shopkeeper
      // than a missed one, and the next sweep is only 5 minutes away.
      await db.deviceAlert.update({
        where: { id: alert.id },
        data:  { partnerNotifiedAt: now, severity: 'critical' },
      });

      const store = await db.store.findUnique({
        where:  { id: alert.storeId },
        select: { storeName: true, whatsapp: true },
      });

      const msg = deviceOfflinePartnerMsg({
        storeName: store?.storeName ?? alert.storeName ?? 'your store',
        since:     alert.lastSeenAt ?? alert.startedAt,
      });

      void pushToStore(alert.storeId, {
        title: 'Your ALIVE screen is offline',
        body:  'It stopped playing about an hour ago. Please check the screen’s power and Wi-Fi.',
        url:   '/store-dashboard',
        tag:   `offline-${alert.id}`,
      });
      if (store?.whatsapp) void notifyStoreWA(store.whatsapp, msg);

      notified++;
    }
  } catch {
    return notified; // best-effort
  }
  return notified;
}

/**
 * Closes any OPEN alert for a device that has just heartbeated again, and tells
 * the partner it's fixed — but only if they were told it broke, so a resolution
 * notice can never be the first thing they hear.
 *
 * Called from the device hot paths (plan / events), so it is fire-and-forget and
 * only runs when the device's prior status was actually OFFLINE.
 */
export async function resolveOfflineAlerts(deviceId: string, now = new Date()): Promise<void> {
  try {
    const open = await db.deviceAlert.findMany({
      where:  { deviceId, status: 'OPEN' },
      select: { id: true, storeId: true, storeName: true, deviceName: true, startedAt: true, partnerNotifiedAt: true },
    });
    if (!open.length) return;

    for (const alert of open) {
      await db.deviceAlert.update({
        where: { id: alert.id },
        data: {
          status:      'RESOLVED',
          resolvedAt:  now,
          downtimeSec: Math.max(0, Math.round((now.getTime() - alert.startedAt.getTime()) / 1000)),
        },
      });

      if (alert.partnerNotifiedAt && alert.storeId) {
        void pushToStore(alert.storeId, {
          title: 'Your ALIVE screen is back online',
          body:  'Ads are playing again — nothing further needed. Thank you!',
          url:   '/store-dashboard',
          tag:   `offline-${alert.id}`,
        });
        const store = await db.store.findUnique({
          where: { id: alert.storeId }, select: { whatsapp: true, storeName: true },
        });
        if (store?.whatsapp) {
          void notifyStoreWA(store.whatsapp, deviceBackOnlineMsg(store.storeName ?? alert.storeName ?? 'your store'));
        }
      }
    }
  } catch {
    /* best-effort — must never fail a device heartbeat */
  }
}
