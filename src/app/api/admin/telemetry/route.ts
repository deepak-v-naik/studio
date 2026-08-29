// GET /api/admin/telemetry?route=<substring>&hours=24&limit=50
// Read-only view into client/server error telemetry (TelemetryEvent), so a browser
// crash can be diagnosed from what actually happened instead of a pasted console log.
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = req.nextUrl;
    const routeFilter = searchParams.get('route');
    const hours = Math.min(Number(searchParams.get('hours') ?? 24), 24 * 30);
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = await db.telemetryEvent.findMany({
      where: {
        createdAt: { gte: since },
        ...(routeFilter ? { OR: [
          { route: { contains: routeFilter } },
          // Client-caught errors (error-boundary.tsx, app/error.tsx) don't send `route`
          // (falls back to '/client'), so also match on the referer captured server-side.
          { requestMeta: { path: ['referer'], string_contains: routeFilter } },
        ] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ count: events.length, since: since.toISOString(), events });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
