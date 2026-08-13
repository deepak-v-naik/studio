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

type SlotMoveNote = { storeName: string; dates: string[]; at: string };

/**
 * Slot reassignments touching this campaign in the last 30 days, read back from the
 * audit notes written when a store's loop was resized (see /api/slots/settings).
 * Never throws — a stat card must not break because an audit row is shaped oddly.
 */
async function recentSlotMoves(campaignId: string): Promise<SlotMoveNote[]> {
  try {
    const rows = await db.auditLog.findMany({
      where: {
        action:    'slot_loop_resized',
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
        meta:      { path: ['campaignIds'], array_contains: campaignId },
      },
      select:  { createdAt: true, meta: true },
      orderBy: { createdAt: 'desc' },
      take:    5,
    });

    return rows.flatMap((row) => {
      const meta = row.meta as {
        storeName?: string;
        moves?: { date?: string; campaignId?: string }[];
      } | null;
      const dates = [...new Set(
        (meta?.moves ?? [])
          .filter((m) => m.campaignId === campaignId && typeof m.date === 'string')
          .map((m) => m.date as string),
      )].sort();
      if (dates.length === 0) return [];
      return [{ storeName: meta?.storeName ?? 'a store', dates, at: row.createdAt.toISOString() }];
    });
  } catch {
    return [];
  }
}

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

    // Slot moves affecting this campaign (a store resized its loop, so we packed the
    // booking into a different position). Shown in the dashboard rather than emailed —
    // it changes nothing the brand bought, so it belongs where they check their numbers.
    const recentMoves = await recentSlotMoves(campaignId);

    return NextResponse.json({
      guaranteedPerDay,
      bonusPerDay,
      totalPerDay: guaranteedPerDay + bonusPerDay,
      cumulativeBonus: bonusTotal,
      cumulativeSlotPlays: slotEvents.length,
      recentMoves,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
