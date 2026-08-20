// Browser Push API sender for partner notifications.
//
// Store partners have no email address (User.email is null for every
// phone-registered partner) and the Twilio sender defaults to the WhatsApp
// sandbox, so web push is the only channel that reliably reaches a partner who
// isn't currently looking at the dashboard.
//
// Lazy-init + graceful no-op, matching src/lib/fcm.ts: with no VAPID keys set,
// every call here is a silent no-op rather than an error, so the feature
// degrades to the in-dashboard banner instead of breaking the cron.
//
// Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (generate with
// `npx web-push generate-vapid-keys`) plus NEXT_PUBLIC_VAPID_PUBLIC_KEY (same
// value as the public one — the browser needs it to subscribe).

import { db } from '@/lib/db';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

function vapidConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

// The endpoint is a URL supplied by the client and then requested server-side,
// so it is an SSRF vector unless constrained. Real subscriptions only ever point
// at a browser vendor's push service, so allowlist those hosts.
const PUSH_HOSTS = [
  'android.googleapis.com',        // legacy GCM
  'fcm.googleapis.com',            // Chrome / Chromium
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com',            // Safari
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
      || u.hostname.endsWith('.notify.windows.com'); // Edge/WNS uses per-region hosts
  } catch {
    return false;
  }
}

/**
 * Sends a push to every subscription belonging to a store.
 * Never throws — push is best-effort; the dashboard banner is the guarantee.
 * Subscriptions the push service reports as gone (404/410) are deleted.
 */
export async function pushToStore(storeId: string, payload: PushPayload): Promise<number> {
  if (!vapidConfigured()) return 0;

  try {
    const subs = await db.pushSubscription.findMany({ where: { storeId } });
    if (!subs.length) return 0;

    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:hello@wearealive.in',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    const body = JSON.stringify(payload);
    let delivered = 0;

    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        delivered++;
        await db.pushSubscription.update({
          where: { id: sub.id }, data: { lastOkAt: new Date() },
        }).catch(() => { /* non-fatal */ });
      } catch (e) {
        // 404/410 mean the browser dropped the subscription — it will never
        // work again, so stop carrying it forward.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }));

    return delivered;
  } catch {
    return 0; // best-effort — never break the caller
  }
}
