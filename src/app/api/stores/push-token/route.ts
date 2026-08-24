// Partner mobile-app (Expo) push-token registry — the app-notification
// counterpart of /api/stores/push-subscribe (browser web-push).
//   POST   { token } → store/refresh an Expo push token for this store
//   DELETE { token } → drop one (sign-out, or partner turned notifications off)
//
// Auth: resolveStoreId() — a token is bound to the authenticated store, never
// to a storeId supplied in the body, or one partner could register their phone
// to receive another partner's outage alerts.
//
// Tokens are stored in PushSubscription with the token as `endpoint` (its
// natural identity) and empty p256dh/auth — see src/lib/expo-push.ts. Unlike
// web-push endpoints these are never fetched as URLs (they go in a POST body to
// exp.host), so the SSRF allowlist doesn't apply; the strict format check below
// is what keeps arbitrary strings out.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoreId } from '@/lib/store-partner-auth';
import { isExpoPushToken } from '@/lib/expo-push';

export async function POST(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { token } = await req.json() as { token?: string };
    if (!token || !isExpoPushToken(token)) {
      return NextResponse.json({ error: 'A valid Expo push token is required' }, { status: 400 });
    }

    // Token is the subscription's identity. Upserting on it means a reinstalled
    // app (or a phone handed to a different partner) updates the existing row
    // instead of accumulating duplicates or leaking alerts to the old store.
    // A cross-store rebind is legitimate (account switch on the same phone) but
    // rare enough to log: a token is a high-entropy secret, so a rebind the old
    // owner didn't cause would mean their device storage was compromised.
    const prev = await db.pushSubscription.findUnique({
      where: { endpoint: token }, select: { storeId: true },
    });
    if (prev && prev.storeId !== storeId) {
      console.warn(`push-token rebind: token moved from store ${prev.storeId} to ${storeId}`);
    }
    await db.pushSubscription.upsert({
      where:  { endpoint: token },
      create: {
        storeId,
        endpoint:  token,
        p256dh:    '',
        auth:      '',
        userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
      },
      update: { storeId },
    });

    // Cap rows per store so a partner (or a scripted caller with a valid store
    // token) can't grow the table without bound — real usage is one or two
    // phones. Keep the newest MAX_PER_STORE across both channels; stale web
    // subscriptions are also pruned on dead delivery, this is the backstop.
    const MAX_PER_STORE = 10;
    const excess = await db.pushSubscription.findMany({
      where:   { storeId },
      orderBy: { createdAt: 'desc' },
      skip:    MAX_PER_STORE,
      select:  { id: true },
    });
    if (excess.length) {
      await db.pushSubscription.deleteMany({
        where: { id: { in: excess.map((e) => e.id) } },
      }).catch(() => { /* best-effort */ });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('push-token register failed:', (e as Error).message);
    return NextResponse.json({ error: 'Could not save notification settings' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { token } = await req.json() as { token?: string };
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
    // Scoped to the caller's own store so a token can't be unregistered by
    // anyone but its owner.
    await db.pushSubscription.deleteMany({ where: { endpoint: token, storeId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not update notification settings' }, { status: 500 });
  }
}
