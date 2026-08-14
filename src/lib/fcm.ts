// Server-side Firebase Cloud Messaging helper.
// Uses the lazy-init pattern (never module-level) to avoid breaking SSG.
// Set FIREBASE_SERVICE_ACCOUNT_JSON env var to a JSON string of the service account.

import { db } from '@/lib/db';
import type { App } from 'firebase-admin/app';

let _app: App | null = null;

async function getFirebaseApp(): Promise<App | null> {
  if (_app) return _app;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const existing = getApps();
    if (existing.length > 0) {
      _app = existing[0];
      return _app;
    }
    _app = initializeApp({ credential: cert(JSON.parse(json)) });
    return _app;
  } catch {
    return null;
  }
}

// Command types the player understands (AliveMessagingService.onMessageReceived).
// This is ALIVE's equivalent of Xibo's XMR relay — FCM already gives us a persistent,
// NAT-friendly push channel to the fleet, so there's no separate ZeroMQ/Redis relay to run.
export type DeviceCommandType = 'plan_updated' | 'reboot' | 'health_ping';

/**
 * Sends a data-only FCM message of the given type to the given device IDs.
 * Silently no-ops if FIREBASE_SERVICE_ACCOUNT_JSON is not set.
 * Never throws — push is best-effort (players still fall back to their normal poll).
 */
export async function pushCommand(deviceIds: string[], type: DeviceCommandType): Promise<void> {
  if (!deviceIds.length) return;
  const app = await getFirebaseApp();
  if (!app) return;

  try {
    const devices = await db.device.findMany({
      where: { id: { in: deviceIds }, fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    const tokens = devices.map((d) => d.fcmToken!).filter(Boolean);
    if (!tokens.length) return;

    const { getMessaging } = await import('firebase-admin/messaging');
    const messaging = getMessaging(app);

    // Send in chunks of 500 (FCM sendEachForMulticast limit)
    const CHUNK = 500;
    for (let i = 0; i < tokens.length; i += CHUNK) {
      await messaging.sendEachForMulticast({
        tokens: tokens.slice(i, i + CHUNK),
        data: { type },
        android: { priority: 'high' },
      });
    }
  } catch {
    // best-effort — never break the API response
  }
}

/** Sends a `plan_updated` FCM data message to the given device IDs. */
export const pushPlanUpdated = (deviceIds: string[]) => pushCommand(deviceIds, 'plan_updated');

/**
 * Sends a `decommission` FCM data message to the given FCM tokens. Takes raw tokens,
 * not device IDs, because the caller (bulk delete) must capture them BEFORE the
 * device rows are deleted — afterwards there is nothing left to look up.
 *
 * This is the fast path for "admin deleted a screen": the player wipes its cached
 * plan/media and returns to pairing. The guaranteed path is the 410 the device API
 * answers on its next call (plan/events/update-check), so offline screens converge
 * too — this push just makes attended deletions take effect in seconds.
 * Silently no-ops if FIREBASE_SERVICE_ACCOUNT_JSON is not set. Never throws.
 */
export async function pushDecommission(tokens: string[]): Promise<void> {
  const valid = tokens.filter(Boolean);
  if (!valid.length) return;
  const app = await getFirebaseApp();
  if (!app) return;

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const messaging = getMessaging(app);
    const CHUNK = 500;
    for (let i = 0; i < valid.length; i += CHUNK) {
      await messaging.sendEachForMulticast({
        tokens: valid.slice(i, i + CHUNK),
        data: { type: 'decommission' },
        android: { priority: 'high' },
      });
    }
  } catch {
    // best-effort — the 410 pull path is the guarantee
  }
}

/**
 * Resolves device IDs affected by a schedule's targeting fields.
 * Used before calling pushPlanUpdated.
 */
export async function resolveScheduleDeviceIds(schedule: {
  deviceIds: string[];
  groupName?: string | null;
  storeIds?: string[];
  cityFilter?: string | null;
}): Promise<string[]> {
  const ids = new Set<string>(schedule.deviceIds);

  if (schedule.groupName) {
    const rows = await db.device.findMany({
      where: { groupName: schedule.groupName },
      select: { id: true },
    });
    for (const r of rows) ids.add(r.id);
  }

  if (schedule.storeIds?.length) {
    const rows = await db.device.findMany({
      where: { storeId: { in: schedule.storeIds } },
      select: { id: true },
    });
    for (const r of rows) ids.add(r.id);
  }

  if (schedule.cityFilter) {
    const stores = await db.store.findMany({
      where: { city: { equals: schedule.cityFilter, mode: 'insensitive' } },
      select: { id: true },
    });
    if (stores.length) {
      const rows = await db.device.findMany({
        where: { storeId: { in: stores.map((s) => s.id) } },
        select: { id: true },
      });
      for (const r of rows) ids.add(r.id);
    }
  }

  return Array.from(ids);
}
