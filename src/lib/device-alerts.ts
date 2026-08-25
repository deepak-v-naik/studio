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
import { pushToStore, type PushPayload } from '@/lib/web-push';
import { pushExpoToStore } from '@/lib/expo-push';

/**
 * Fan a partner notification out to every push channel (browser + mobile app).
 *
 * AWAITED, not fire-and-forget: on Vercel the function instance can be frozen
 * the moment the response is sent, killing any in-flight fetch. Since the alert
 * row is deliberately marked notified BEFORE sending (a duplicate is worse than
 * a miss), a push dropped by the freeze would be permanently lost. Both senders
 * are guaranteed never to throw, so awaiting them keeps the never-break-the-cron
 * invariant while pinning the sends inside the caller's awaited promise chain
 * (the cron awaits escalateSustainedOutages; the device hot paths run
 * resolveOfflineAlerts via after(), which waits on its promise).
 */
async function pushToStoreAllChannels(storeId: string, payload: PushPayload): Promise<void> {
  await Promise.all([
    pushToStore(storeId, payload),     // partner PWA (web push, needs VAPID keys)
    pushExpoToStore(storeId, payload), // partner mobile app (Expo push)
  ]);
}

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
  // Pre-outage snapshot — frozen onto the alert row because the Device columns are
  // overwritten by every heartbeat (see DeviceAlert.bootedAtBefore).
  bootedAt?: Date | null;
  appStartedAt?: Date | null;
  appVersion?: string | null;
};

export type OutageCause = 'POWER_LOST' | 'NETWORK_LOST' | 'APP_STOPPED' | 'PLAYER_UPDATED' | 'UNKNOWN';

export type CauseVerdict = {
  cause: OutageCause;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
};

/** Clock slack: heartbeats are ~15 min apart and timestamps are derived from an uptime
 *  measured a round-trip earlier, so treat sub-3-minute movement as "unchanged". */
const CLOCK_SLACK_MS = 3 * 60 * 1000;

/**
 * Works out WHY a screen was offline, at the moment it comes back.
 *
 * The three causes are indistinguishable while the screen is down — the witness is the
 * thing that died. They become separable on recovery, because the returning device
 * reports two independent restart clocks:
 *
 *   the box restarted            -> it lost power (nothing else stops a running TV)
 *   box steady, app restarted    -> the player died: crash, force-stop, or an update
 *   box steady, app steady       -> nothing on the device failed, so the link did
 *
 * The last line is the valuable one: an app that ran continuously *through* the outage
 * is positive proof the fault was the network, not the screen — which is the difference
 * between sending an engineer and calling the ISP.
 *
 * Deliberately returns UNKNOWN with a stated reason rather than guessing: a confident
 * wrong cause sends someone to the wrong site, which is worse than "not yet known".
 */
export function classifyOutageCause(before: {
  lastSeenAt: Date | null;
  bootedAtBefore: Date | null;
  appStartedBefore: Date | null;
  appVersionBefore: string | null;
}, after: {
  bootedAt: Date | null;
  appStartedAt: Date | null;
  appVersion: string | null;
}): CauseVerdict {
  const evidence: string[] = [];

  // No baseline means the screen was running a build that predates uptime reporting,
  // so there is nothing to diff. Say so plainly instead of inventing a cause.
  if (!before.bootedAtBefore || !after.bootedAt) {
    return {
      cause: 'UNKNOWN',
      confidence: 'low',
      evidence: [
        'Cannot determine the cause: this screen is running a player build that does not report uptime.',
        'Install the current APK and any future outage on this screen will be diagnosed automatically.',
      ],
    };
  }

  const rebooted = after.bootedAt.getTime() - before.bootedAtBefore.getTime() > CLOCK_SLACK_MS;

  if (rebooted) {
    evidence.push(`The device restarted during the outage (booted ${fmtIst(after.bootedAt)}).`);
    // An update we caused looks like a reboot, so rule it out before blaming the mains.
    if (before.appVersionBefore && after.appVersion && before.appVersionBefore !== after.appVersion) {
      evidence.push(`The player also updated, ${before.appVersionBefore} to ${after.appVersion} — the restart was the update, not a power failure.`);
      return { cause: 'PLAYER_UPDATED', confidence: 'high', evidence };
    }
    evidence.push('Nothing else stops a running TV, so the power was interrupted — a cut, an unplugged set, or someone switching it off at the wall.');
    return { cause: 'POWER_LOST', confidence: 'high', evidence };
  }

  evidence.push(`The device never restarted — it has been powered on since ${fmtIst(before.bootedAtBefore)}, right through the outage.`);

  if (!before.appStartedBefore || !after.appStartedAt) {
    evidence.push('Whether the player itself restarted is unknown: this build does not report process uptime.');
    return { cause: 'UNKNOWN', confidence: 'low', evidence };
  }

  const appRestarted = after.appStartedAt.getTime() - before.appStartedBefore.getTime() > CLOCK_SLACK_MS;

  if (appRestarted) {
    evidence.push(`The player restarted during the outage (started ${fmtIst(after.appStartedAt)}) — it crashed, was force-stopped, or was closed.`);
    return { cause: 'APP_STOPPED', confidence: 'high', evidence };
  }

  evidence.push('The player also ran continuously — it never restarted either.');
  evidence.push('The screen and the app were both healthy the whole time, so the only thing that failed was the connection: Wi-Fi, the router, or the internet line.');
  return { cause: 'NETWORK_LOST', confidence: 'high', evidence };
}

function fmtIst(d: Date): string {
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

/** One-line summary for the admin toast — the sentence that has to land at a glance. */
export function causeHeadline(cause: string | null): string {
  switch (cause) {
    case 'POWER_LOST':     return 'Power was cut';
    case 'NETWORK_LOST':   return 'Internet/Wi-Fi dropped — screen and player were fine';
    case 'APP_STOPPED':    return 'The player app stopped';
    case 'PLAYER_UPDATED': return 'Restarted for a player update';
    default:               return 'Cause not yet known';
  }
}

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
          // Freeze the pre-outage state now — these Device columns are overwritten by
          // the very first heartbeat when the screen returns, which is exactly the
          // moment we need to compare against them.
          bootedAtBefore:   d.bootedAt ?? null,
          appStartedBefore: d.appStartedAt ?? null,
          appVersionBefore: d.appVersion ?? null,
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

      await pushToStoreAllChannels(alert.storeId, {
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
      select: {
        id: true, storeId: true, storeName: true, deviceName: true, startedAt: true,
        partnerNotifiedAt: true, lastSeenAt: true,
        bootedAtBefore: true, appStartedBefore: true, appVersionBefore: true,
      },
    });
    if (!open.length) return;

    // Read the device AFTER its recovery heartbeat has landed (callers invoke this from
    // after(), post-update), so these are the values the returning screen just reported.
    const fresh = await db.device.findUnique({
      where:  { id: deviceId },
      select: { bootedAt: true, appStartedAt: true, appVersion: true },
    }).catch(() => null);

    for (const alert of open) {
      const verdict = fresh
        ? classifyOutageCause(
            {
              lastSeenAt:       alert.lastSeenAt,
              bootedAtBefore:   alert.bootedAtBefore,
              appStartedBefore: alert.appStartedBefore,
              appVersionBefore: alert.appVersionBefore,
            },
            { bootedAt: fresh.bootedAt, appStartedAt: fresh.appStartedAt, appVersion: fresh.appVersion },
          )
        : null;

      await db.deviceAlert.update({
        where: { id: alert.id },
        data: {
          status:      'RESOLVED',
          resolvedAt:  now,
          downtimeSec: Math.max(0, Math.round((now.getTime() - alert.startedAt.getTime()) / 1000)),
          ...(verdict ? {
            cause:           verdict.cause,
            causeConfidence: verdict.confidence,
            causeEvidence:   verdict.evidence.join('\n'),
          } : {}),
        },
      });

      if (alert.partnerNotifiedAt && alert.storeId) {
        await pushToStoreAllChannels(alert.storeId, {
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
