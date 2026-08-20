// Runs every 5 minutes via .github/workflows/device-health-cron.yml (GitHub
// Actions), which POSTs a bearer-authed GET here on schedule. The
// `crons` entry in vercel.json only fires this once a day (0 3 * * *) as a
// fallback in case the GitHub Actions schedule ever stalls — Vercel's Hobby
// plan rejects any cron expression that runs more than once a day, so the
// real 5-minute cadence has to live outside vercel.json.
//
// Marks devices OFFLINE if lastSeen > 20 minutes ago.
// Updates 30-day rolling uptime estimate (uptimePctD30).
//
// The player's heartbeat is a WorkManager PeriodicWorkRequest, which Android
// silently clamps to a 15-minute minimum interval regardless of what's
// requested — so under normal operation lastSeen can legitimately go ~15 min
// between updates, plus scheduling jitter (Doze, deferred network
// constraints). A 10-minute offline threshold flapped healthy devices
// OFFLINE routinely; 20 minutes gives enough headroom above the real cadence.
//
// GET /api/cron/device-health
// Auth: CRON_SECRET (Vercel sets Authorization: Bearer <secret> for its own
// daily fallback call; the GitHub Actions workflow sets the same header from
// a repo secret of the same name)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notifyAdminWA } from '@/lib/notify';
import { openOfflineAlerts, escalateSustainedOutages } from '@/lib/device-alerts';
import { recordError, hashStack, getOrCreateCorrelationId } from '@/lib/telemetry';

const UPTIME_DROP_THRESHOLD_PCT = 15;
const OFFLINE_TRANSITION_THRESHOLD = 3;
const MISSING_HEARTBEAT_WINDOWS_THRESHOLD = 3;
const HEARTBEAT_WINDOW_MS = 20 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now           = new Date();
  const offlineThresh = new Date(now.getTime() - 20 * 60 * 1000);   // 20 min
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    // 1. Mark devices that haven't been seen in 20+ minutes as OFFLINE.
    // updateManyAndReturn (one UPDATE ... RETURNING) so the set of devices that
    // crossed the edge is captured atomically with the flip — a plain updateMany
    // returns only a count, and re-deriving the set afterwards would either miss
    // devices or re-notify every still-offline screen on every 5-minute run.
    const justWentOffline = await db.device.updateManyAndReturn({
      where: {
        status:  { not: 'OFFLINE' },
        lastSeen: { lt: offlineThresh },
      },
      data: { status: 'OFFLINE' },
      select: { id: true, name: true, storeId: true, lastSeen: true },
    });
    const markedOffline = justWentOffline.length;

    // Alerting is best-effort and must never fail the health sweep.
    const storeNames = new Map<string, string>();
    const storeIds = justWentOffline.map((d) => d.storeId).filter((s): s is string => !!s);
    if (storeIds.length) {
      const stores = await db.store.findMany({
        where: { id: { in: storeIds } }, select: { id: true, storeName: true },
      }).catch(() => []);
      for (const s of stores) storeNames.set(s.id, s.storeName);
    }
    const openedAlerts = await openOfflineAlerts(justWentOffline.map((d) => ({
      ...d,
      store: d.storeId ? { storeName: storeNames.get(d.storeId) ?? '' } : null,
    })));

    // Partners are told only once an outage is sustained — see lib/device-alerts.
    const partnersNotified = await escalateSustainedOutages(now);

    // 2. Recalculate rolling 30-day uptime for all non-PENDING devices
    const devices = await db.device.findMany({
      where:  { status: { not: 'PENDING' } },
      select: { id: true, claimedAt: true, uptimePctD30: true, status: true, lastSeen: true, groupName: true, storeId: true },
    });

    let createdTickets = 0;

    for (const device of devices) {
      const windowStart = device.claimedAt > thirtyDaysAgo ? device.claimedAt : thirtyDaysAgo;
      const windowMs    = now.getTime() - windowStart.getTime();
      if (windowMs <= 0) continue;

      // Sum total online time from play events within the window
      const events = await db.playEvent.aggregate({
        where:  { deviceId: device.id, startedAt: { gte: windowStart } },
        _sum:   { durationMs: true },
      });

      const onlineMs     = events._sum.durationMs ?? 0;
      const uptimePctD30 = Math.min(100, (onlineMs / windowMs) * 100);

      await db.device.update({
        where: { id: device.id },
        data:  { uptimePctD30 },
      });

      const uptimeDropBreached = (device.uptimePctD30 ?? uptimePctD30) - uptimePctD30 > UPTIME_DROP_THRESHOLD_PCT;

      const [offlineTransitions, recentEventsCount, unresolvedTicket] = await Promise.all([
        db.playEvent.count({
          where: {
            deviceId: device.id,
            startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            tag: 'OFFLINE_TRANSITION',
          },
        }),
        db.playEvent.count({
          where: {
            deviceId: device.id,
            startedAt: { gte: new Date(now.getTime() - HEARTBEAT_WINDOW_MS * MISSING_HEARTBEAT_WINDOWS_THRESHOLD) },
          },
        }),
        db.remediationTicket.findFirst({
          where: { deviceId: device.id, status: 'OPEN' },
          select: { id: true },
        }),
      ]);

      const msSinceLastSeen = device.lastSeen ? now.getTime() - device.lastSeen.getTime() : Number.MAX_SAFE_INTEGER;
      const missingHeartbeatWindows = Math.floor(msSinceLastSeen / HEARTBEAT_WINDOW_MS);
      const missingHeartbeatBreached = missingHeartbeatWindows >= MISSING_HEARTBEAT_WINDOWS_THRESHOLD;
      const offlineTransitionsBreached = offlineTransitions >= OFFLINE_TRANSITION_THRESHOLD;

      if ((uptimeDropBreached || missingHeartbeatBreached || offlineTransitionsBreached) && !unresolvedTicket) {
        const triggerType = uptimeDropBreached
          ? 'UPTIME_DROP'
          : missingHeartbeatBreached
            ? 'MISSING_HEARTBEATS'
            : 'REPEATED_OFFLINE_TRANSITIONS';

        const severity = missingHeartbeatWindows >= 6 ? 'high' : 'medium';
        const newTicket = await db.remediationTicket.create({
          data: {
            deviceId: device.id,
            triggerType,
            severity,
            triggerWindowStart: windowStart,
            triggerWindowEnd: now,
            snapshot: {
              device: {
                id: device.id,
                status: device.status,
                lastSeen: device.lastSeen,
                groupName: device.groupName,
                storeId: device.storeId,
              },
              metrics: {
                previousUptimePctD30: device.uptimePctD30,
                computedUptimePctD30: uptimePctD30,
                missingHeartbeatWindows,
                offlineTransitions,
                recentEventsCount,
              },
              thresholds: {
                uptimeDropPct: UPTIME_DROP_THRESHOLD_PCT,
                offlineTransitions: OFFLINE_TRANSITION_THRESHOLD,
                missingHeartbeatWindows: MISSING_HEARTBEAT_WINDOWS_THRESHOLD,
              },
            },
          },
        });
        createdTickets++;

        void notifyAdminWA(
          `⚠️ Device alert [${triggerType}]\nDevice: ${device.id}\nSeverity: ${severity}\nStore: ${device.storeId ?? 'unassigned'}\nLast seen: ${device.lastSeen?.toISOString() ?? 'never'}`
        );

        const remediateUrl = `${process.env.NEXTAUTH_URL ?? ''}/api/agent/remediate`;
        void fetch(remediateUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
          body: JSON.stringify({ ticketId: newTicket.id }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      ok: true, markedOffline, updatedUptime: devices.length, createdTickets,
      openedAlerts, partnersNotified,
    });
  } catch (e) {
    const error = e as Error;
    const correlationId = getOrCreateCorrelationId(null);
    void recordError({ route: '/api/cron/device-health', errorClass: error.name, message: error.message, stackHash: hashStack(error.stack), correlationId, actorType: 'system' });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
