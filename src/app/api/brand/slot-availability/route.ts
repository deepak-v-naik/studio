// GET /api/brand/slot-availability?from=YYYY-MM-DD&to=YYYY-MM-DD&city=<cluster>
// Brand-facing per-date availability across the store cluster. Deliberately exposes
// NO slot/store mechanics — just Available/Limited/Sold out per date. Availability is
// computed from SOLD bookings only; filler/bonus fill state never reads as "sold out"
// (spec rule 5).
//
// Unauthenticated by design: the booking flow (/brand-onboarding) is public — brands
// sign in at the payment step, not before picking a date — so this has to answer
// pre-auth. What it returns is the coarse buy-side signal a booking page is meant to
// show; per-store sold counts stay behind the admin-only /api/slots/* routes.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { istToday } from '@/lib/slots';
import { availabilityGrid } from '@/lib/slots-db';

const LIMITED_THRESHOLD = 0.7; // ≥70% of cluster inventory sold → "limited"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get('from') ?? istToday();
    const toDefault = new Date(new Date(`${from}T00:00:00Z`).getTime() + 27 * 86_400_000)
      .toISOString().slice(0, 10);
    const to   = searchParams.get('to') ?? toDefault;
    const city = searchParams.get('city');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
    }

    const dates: string[] = [];
    for (let t = new Date(`${from}T00:00:00Z`).getTime();
         t <= new Date(`${to}T00:00:00Z`).getTime() && dates.length < 60;
         t += 86_400_000) {
      dates.push(new Date(t).toISOString().slice(0, 10));
    }

    const stores = await db.store.findMany({
      where: {
        loopSlotCount: { not: null },
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
      },
      select: { id: true, openDays: true, loopSlotCount: true },
    });

    if (stores.length === 0) {
      return NextResponse.json({ dates: dates.map((date) => ({ date, status: 'closed' as const })) });
    }

    const grid = await availabilityGrid(
      stores.map((s) => ({ id: s.id, openDays: s.openDays, loopSlotCount: s.loopSlotCount! })),
      dates,
    );

    const out = dates.map((date) => {
      let total = 0, sold = 0, openStores = 0;
      for (const s of stores) {
        const cell = grid.get(s.id)?.get(date);
        if (cell === null || cell === undefined) continue; // closed that day
        openStores++;
        total += s.loopSlotCount!;
        sold  += cell;
      }
      const status =
        openStores === 0        ? 'closed'
        : sold >= total         ? 'sold_out'
        : sold / total >= LIMITED_THRESHOLD ? 'limited'
        :                         'available';
      return { date, status };
    });

    return NextResponse.json({ dates: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
