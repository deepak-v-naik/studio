// GET /api/footfall/:storeId/audit?from=&to=
// Returns a breakdown of staff-excluded footfall events for a store.
// Auth: admin-password header.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { storeId } = await params;

  const { searchParams } = new URL(req.url);
  const to   = searchParams.get('to')   ? new Date(searchParams.get('to')!)   : new Date();
  const from = searchParams.get('from') ? new Date(searchParams.get('from')!) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  const events = await db.footfallEvent.findMany({
    where: { storeId, timestamp: { gte: from, lte: to }, exclusionReason: { not: null } },
    orderBy: { timestamp: 'desc' },
    take: 500,
  });

  const breakdown = new Map<string, number>();
  for (const e of events) {
    const reason = e.exclusionReason ?? 'UNKNOWN';
    breakdown.set(reason, (breakdown.get(reason) ?? 0) + 1);
  }

  return NextResponse.json({
    storeId,
    from: from.toISOString(),
    to: to.toISOString(),
    breakdown: [...breakdown.entries()].map(([reason, count]) => ({ reason, count })),
    events: events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.toISOString(),
      exclusionReason: e.exclusionReason,
      zoneId: e.zoneId,
      confidenceScore: e.confidenceScore,
      detectionMethod: e.detectionMethod,
    })),
  });
}
