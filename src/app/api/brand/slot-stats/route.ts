// GET /api/brand/slot-stats?campaignId=…
// Campaign stat card numbers: guaranteed vs bonus plays per day.
//   guaranteedPerDay — today's booked slots × each store's loop repeats/day
//   bonusPerDay      — average attributed filler plays/day from play logs (isFiller)
//   totalPerDay      — sum
//   bonusToTotal     — Phase-2 cumulative "bonus plays earned this campaign" counter
// Derived at read time from PlayEvent (the spec's play_logs) — no extra tables.
// Auth: next-auth session; the campaign must belong to the logged-in brand's email.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { istToday, loopRepeatsPerDay } from '@/lib/slots';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const campaignId = req.nextUrl.searchParams.get('campaignId') ?? '';
    if (!campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 });

    const campaign = await db.campaign.findFirst({
      where:  { id: campaignId, email: session.user.email },
      select: { id: true, createdAt: true },
    });
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    // Guaranteed: today's booked slots per store × that store's loop repeats/day.
    const today = istToday();
    const bookings = await db.slotBooking.groupBy({
      by:     ['storeId'],
      where:  { campaignId, date: new Date(`${today}T00:00:00Z`) },
      _count: { id: true },
    });
    let guaranteedPerDay = 0;
    if (bookings.length) {
      const stores = await db.store.findMany({
        where:  { id: { in: bookings.map((b) => b.storeId) } },
        select: { id: true, loopSlotCount: true, hoursStart: true, hoursEnd: true },
      });
      const storeMap = new Map(stores.map((s) => [s.id, s]));
      for (const b of bookings) {
        const s = storeMap.get(b.storeId);
        if (!s?.loopSlotCount) continue;
        guaranteedPerDay += b._count.id * loopRepeatsPerDay({
          loopSlotCount: s.loopSlotCount, hoursStart: s.hoursStart, hoursEnd: s.hoursEnd,
        });
      }
    }

    // Bonus: attributed filler plays from the logs, averaged over the days that
    // actually have slot plays (so a campaign that started mid-week isn't diluted).
    const slotEvents = await db.playEvent.findMany({
      where:  { campaignId, slotPosition: { not: null } },
      select: { isFiller: true, startedAt: true },
    });
    const bonusTotal = slotEvents.filter((e) => e.isFiller).length;
    const playDays = new Set(slotEvents.map((e) => e.startedAt.toISOString().slice(0, 10))).size;
    const bonusPerDay = playDays > 0 ? Math.round(bonusTotal / playDays) : 0;

    return NextResponse.json({
      guaranteedPerDay,
      bonusPerDay,
      totalPerDay: guaranteedPerDay + bonusPerDay,
      cumulativeBonus: bonusTotal,
      cumulativeSlotPlays: slotEvents.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
