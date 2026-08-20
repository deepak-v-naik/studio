// Partner web-push subscription registry.
//   POST   { endpoint, keys: { p256dh, auth } } → store/refresh a subscription
//   DELETE { endpoint }                          → drop one (partner turned it off)
//
// Auth: resolveStoreId() — a subscription is bound to the authenticated store,
// never to a storeId supplied in the body, or one partner could register a
// browser to receive another partner's outage alerts.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoreId } from '@/lib/store-partner-auth';
import { isAllowedPushEndpoint } from '@/lib/web-push';

export async function POST(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const endpoint = body.endpoint;
    const p256dh   = body.keys?.p256dh;
    const auth     = body.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'endpoint and keys are required' }, { status: 400 });
    }
    // Refuse anything that isn't a real browser push service: the endpoint is
    // client-supplied and later fetched server-side, so an arbitrary URL here
    // would turn this into an SSRF primitive.
    if (!isAllowedPushEndpoint(endpoint)) {
      return NextResponse.json({ error: 'Unsupported push endpoint' }, { status: 400 });
    }

    // Endpoint is the subscription's identity. Upserting on it means a browser
    // that re-subscribes (or a device handed to a different partner) updates the
    // existing row instead of accumulating duplicates.
    await db.pushSubscription.upsert({
      where:  { endpoint },
      create: { storeId, endpoint, p256dh, auth, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
      update: { storeId, p256dh, auth },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('push-subscribe failed:', (e as Error).message);
    return NextResponse.json({ error: 'Could not save notification settings' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { endpoint } = await req.json() as { endpoint?: string };
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    // Scoped to the caller's own store so an endpoint can't be unsubscribed by
    // anyone but its owner.
    await db.pushSubscription.deleteMany({ where: { endpoint, storeId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not update notification settings' }, { status: 500 });
  }
}
