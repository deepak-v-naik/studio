// Screen-offline alerts for the partner's own store.
//   GET   → this store's open alerts (+ recently resolved, so the dashboard can
//           show "back online" instead of the warning silently disappearing)
//   PATCH → mark them read
//
// Auth: resolveStoreId() only — never a bare storeId from the body. The store id
// doubles as a bearer credential in this codebase, so this route must go through
// the signed-token / session path like every other partner route.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoreId } from '@/lib/store-partner-auth';

export async function GET(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const recentlyResolved = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const alerts = await db.deviceAlert.findMany({
      where: {
        storeId,
        OR: [
          { status: 'OPEN' },
          { status: 'RESOLVED', resolvedAt: { gte: recentlyResolved } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, status: true, severity: true, deviceName: true,
        lastSeenAt: true, startedAt: true, resolvedAt: true, partnerReadAt: true,
      },
    });
    return NextResponse.json({ alerts });
  } catch {
    return NextResponse.json({ alerts: [] });
  }
}

export async function PATCH(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Scoped to this store — a partner can only ever mark their own alerts read.
    await db.deviceAlert.updateMany({
      where: { storeId, partnerReadAt: null },
      data:  { partnerReadAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('stores/alerts PATCH failed:', (e as Error).message);
    return NextResponse.json({ error: 'Could not update alerts' }, { status: 500 });
  }
}
