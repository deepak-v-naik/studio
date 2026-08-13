// GET /api/slots/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Admin grid data: every store's slot config + sold counts per date.
// Closed days (per openDays bitmask) come back as null so the grid greys them out.
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { istToday } from '@/lib/slots';
import { availabilityGrid } from '@/lib/slots-db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end   = new Date(`${to}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime() && out.length < 60; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get('from') ?? istToday();
    const to   = searchParams.get('to')   ?? from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
    }
    const dates = dateRange(from, to);

    const stores = await db.store.findMany({
      select: {
        id: true, storeName: true, city: true,
        loopSlotCount: true, openDays: true, hoursStart: true, hoursEnd: true,
        fillerCampaignId: true,
      },
      orderBy: [{ city: 'asc' }, { storeName: 'asc' }],
    });

    const slotStores = stores.filter((s) => s.loopSlotCount != null);
    const grid = await availabilityGrid(
      slotStores.map((s) => ({ id: s.id, openDays: s.openDays, loopSlotCount: s.loopSlotCount! })),
      dates,
    );

    const cfg = await db.playerConfig.findUnique({ where: { id: 1 }, select: { fillerCampaignId: true } });

    return NextResponse.json({
      dates,
      defaultFillerCampaignId: cfg?.fillerCampaignId ?? null,
      stores: stores.map((s) => ({
        ...s,
        // sold per date; null = closed that day; absent map = slot mode off
        sold: s.loopSlotCount != null
          ? Object.fromEntries(grid.get(s.id) ?? [])
          : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
