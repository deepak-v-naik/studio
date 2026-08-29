// GET /api/footfall/:storeId?from=&to=
// Returns hourly footfall aggregates for a store within a date range.
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

  const hourly = await db.footfallHourly.findMany({
    where: { storeId, hourBucket: { gte: from, lte: to } },
    orderBy: { hourBucket: 'asc' },
  });

  const totals = hourly.reduce(
    (acc, h) => ({
      customerCount: acc.customerCount + h.customerCount,
      unconfirmedCount: acc.unconfirmedCount + h.unconfirmedCount,
      excludedCount: acc.excludedCount + h.excludedCount,
    }),
    { customerCount: 0, unconfirmedCount: 0, excludedCount: 0 },
  );

  // Screen presence rate per campaign for this store in the range
  const presenceEvents = await db.screenPresenceEvent.findMany({
    where: { storeId, timestamp: { gte: from, lte: to }, campaignId: { not: null } },
    select: { campaignId: true, presenceDetected: true },
  });
  const byCampaign = new Map<string, { total: number; confirmed: number }>();
  for (const e of presenceEvents) {
    if (!e.campaignId) continue;
    const prev = byCampaign.get(e.campaignId) ?? { total: 0, confirmed: 0 };
    byCampaign.set(e.campaignId, {
      total: prev.total + 1,
      confirmed: prev.confirmed + (e.presenceDetected ? 1 : 0),
    });
  }
  const campaigns = byCampaign.size > 0
    ? await db.campaign.findMany({ where: { id: { in: [...byCampaign.keys()] } }, select: { id: true, name: true } })
    : [];
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));

  return NextResponse.json({
    storeId,
    from: from.toISOString(),
    to: to.toISOString(),
    totals,
    hourly: hourly.map((h) => ({
      hourBucket: h.hourBucket.toISOString(),
      customerCount: h.customerCount,
      unconfirmedCount: h.unconfirmedCount,
      avgConfidence: h.avgConfidence,
      excludedCount: h.excludedCount,
    })),
    presenceByCampaign: [...byCampaign.entries()].map(([campaignId, v]) => ({
      campaignId,
      campaignName: campaignNames.get(campaignId) ?? campaignId,
      total: v.total,
      confirmed: v.confirmed,
      presenceRate: v.total > 0 ? v.confirmed / v.total : null,
    })),
  });
}
