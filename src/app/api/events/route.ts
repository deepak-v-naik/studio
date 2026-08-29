// Admin play-event query.
// GET /api/events?deviceId=&campaignId=&tag=&from=&to=&limit=&cursor=
// Auth: admin-password header
// Returns: { events: PlayEvent[], nextCursor }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p          = req.nextUrl.searchParams;
  const deviceId   = p.get('deviceId')   ?? undefined;
  const campaignId = p.get('campaignId') ?? undefined;
  const tag        = p.get('tag')        ?? undefined;
  const from       = p.get('from')       ? new Date(p.get('from')!) : undefined;
  const to         = p.get('to')         ? new Date(p.get('to')!)   : undefined;
  const limit      = Math.min(Number(p.get('limit') ?? 500), 2000);
  const cursor     = p.get('cursor')     ?? undefined;

  // Use select to avoid touching columns that may not exist yet (impressions, costPaise)
  try {
    const events = await db.playEvent.findMany({
      where: {
        ...(deviceId   ? { deviceId }   : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(tag        ? { tag }        : {}),
        ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: {
        id: true, deviceId: true, mediaId: true, campaignId: true,
        tag: true, startedAt: true, endedAt: true, durationMs: true,
        device: { select: { name: true, groupName: true, id: true } },
      },
      orderBy: { startedAt: 'desc' },
      take:    limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Enrich with impressions/costPaise if those columns exist
    let enriched: typeof events & { impressions?: number; costPaise?: number }[] = events;
    try {
      const ids = events.map((e) => e.id);
      if (ids.length) {
        const extras = await db.$queryRawUnsafe<{ id: string; impressions: number; costPaise: number }[]>(
          `SELECT id, COALESCE(impressions,1) AS impressions, COALESCE("costPaise",0) AS "costPaise" FROM "PlayEvent" WHERE id = ANY($1::text[])`,
          ids,
        );
        const map = new Map(extras.map((x) => [x.id, x]));
        enriched = events.map((e) => ({ ...e, impressions: map.get(e.id)?.impressions ?? 1, costPaise: map.get(e.id)?.costPaise ?? 0 }));
      }
    } catch { /* impressions columns not yet migrated — omit gracefully */ }

    const hasMore    = enriched.length > limit;
    const page       = hasMore ? enriched.slice(0, limit) : enriched;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return NextResponse.json({ events: page, nextCursor });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
