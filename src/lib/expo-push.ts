// Expo push sender for the partner mobile app (store-app, com.partner.alive).
//
// The partner app is a React Native/Expo build, so browser web-push can never
// reach it — Expo's push service is its only channel. Tokens live in the same
// PushSubscription table as web-push subscriptions: an Expo token is stored as
// the `endpoint` (it is the subscription's natural identity, exactly like a
// push-service URL), with empty p256dh/auth since Expo needs no VAPID keys.
// The two senders tell their rows apart by shape — web-push takes only
// `https://` endpoints, this module takes only `Expo…PushToken[…]` ones.
//
// Delivery needs no server secret (EXPO_ACCESS_TOKEN is optional, only for
// accounts with enhanced push security), but the ANDROID BUILD must carry FCM
// credentials — see store-app/DEPLOYMENT.md § Push notifications. Without them
// registration succeeds in dev but delivery silently fails.
//
// Matches src/lib/web-push.ts semantics: best-effort, never throws, and tokens
// the service reports dead (DeviceNotRegistered) are deleted so we stop
// carrying them forward.

import { db } from '@/lib/db';
import type { PushPayload } from '@/lib/web-push';

// Both historical formats are live in the wild. Real token bodies are ~22
// chars; the {1,256} bound exists because this validates client-supplied input
// headed for a DB column — format-valid-but-arbitrarily-long must not pass.
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,256}\]$/;

export function isExpoPushToken(value: string): boolean {
  return value.length <= 300 && EXPO_TOKEN_RE.test(value);
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100; // Expo's documented max messages per request

type ExpoTicket = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

/**
 * Sends a push to every Expo (mobile-app) token belonging to a store.
 * Returns the number of accepted tickets. Never throws.
 */
export async function pushExpoToStore(storeId: string, payload: PushPayload): Promise<number> {
  try {
    const subs = await db.pushSubscription.findMany({
      where: { storeId, endpoint: { startsWith: 'Expo' } },
      select: { id: true, endpoint: true },
    });
    const tokens = subs.filter((s) => isExpoPushToken(s.endpoint));
    if (!tokens.length) return 0;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    let delivered = 0;
    for (let i = 0; i < tokens.length; i += CHUNK) {
      const batch = tokens.slice(i, i + CHUNK);
      const messages = batch.map((s) => ({
        to:        s.endpoint,
        title:     payload.title,
        body:      payload.body,
        sound:     'default' as const,
        priority:  'high' as const,
        channelId: 'alerts', // must match the channel the app creates
        data:      { url: payload.url ?? '/', tag: payload.tag ?? null },
      }));

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });
      if (!res.ok) continue; // whole-batch transport failure — tokens may still be fine

      const tickets = ((await res.json()) as { data?: ExpoTicket[] }).data ?? [];
      // Tickets come back aligned with the messages array.
      //
      // Known limitation: a ticket's `ok` means Expo ACCEPTED the message, not
      // that FCM delivered it — true delivery outcomes live in push *receipts*,
      // which must be fetched ~15 min later and would need per-send state we
      // deliberately don't keep (the 5-min cron would be the natural place if
      // this ever matters). The failure this hides in practice is missing FCM
      // credentials on the Android build, which is why (a) error tickets are
      // logged loudly below so misconfiguration shows up in Vercel logs, and
      // (b) the credential setup is a documented build prerequisite
      // (store-app/DEPLOYMENT.md § Push notifications).
      await Promise.all(tickets.map(async (ticket, idx) => {
        const sub = batch[idx];
        if (!sub) return;
        if (ticket.status === 'ok') {
          delivered++;
          await db.pushSubscription.update({
            where: { id: sub.id }, data: { lastOkAt: new Date() },
          }).catch(() => { /* non-fatal */ });
        } else if (ticket.details?.error === 'DeviceNotRegistered') {
          // The app was uninstalled or the token rotated — it will never work
          // again, so stop carrying it forward.
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          // InvalidCredentials / MessageTooBig / rate limits — surface them.
          console.error(
            `expo-push ticket error for store ${storeId}: ${ticket.details?.error ?? 'unknown'} — ${ticket.message ?? ''}`,
          );
        }
      }));
    }
    return delivered;
  } catch {
    return 0; // best-effort — never break the caller
  }
}
