// Database-backed slot-loop helpers. Split from lib/slots.ts so the loop/availability
// math there stays pure (no Prisma import) and unit-testable.

import { db } from '@/lib/db';
import { isOpenOn, istToday } from '@/lib/slots';

// ── Loop resizing ─────────────────────────────────────────────────────────────

export type SlotMove = {
  bookingId:    string;
  date:         string;
  from:         number;
  to:           number;
  campaignId:   string;
  campaignName: string;
};

export type CompactionPlan =
  | { ok: true;  moves: SlotMove[] }
  | { ok: false; date: string; stranded: number; free: number };

/**
 * Plans how to fit a store's upcoming bookings into a loop of `newCount` positions.
 *
 * Shrinking the loop strands any booking at position >= newCount: the player skips
 * out-of-range positions, so a paid slot would silently stop playing. Rather than
 * blocking the resize, pack those bookings down into whatever positions are free on
 * the same date — the loop position is an internal detail, not something a brand buys,
 * so moving it costs them nothing (every slot plays once per loop either way).
 *
 * Only reports failure when a date genuinely has more bookings than the new loop can
 * hold — real oversell, which needs a human decision about who to drop. Planning is
 * all-or-nothing across dates so a rejected resize never half-applies.
 *
 * Past dates are ignored: they have already aired and their play logs are history.
 * newCount = 0 (leaving slot mode) naturally has no free positions, so any upcoming
 * booking blocks it.
 */
export async function planSlotCompaction(storeId: string, newCount: number): Promise<CompactionPlan> {
  const upcoming = await db.slotBooking.findMany({
    where:  { storeId, date: { gte: new Date(`${istToday()}T00:00:00Z`) } },
    select: {
      id: true, date: true, slotPosition: true, campaignId: true,
      campaign: { select: { name: true } },
    },
    orderBy: [{ date: 'asc' }, { slotPosition: 'asc' }],
  });

  const byDate = new Map<string, typeof upcoming>();
  for (const b of upcoming) {
    const key = b.date.toISOString().slice(0, 10);
    const list = byDate.get(key) ?? [];
    list.push(b);
    byDate.set(key, list);
  }

  const moves: SlotMove[] = [];
  for (const [date, rows] of byDate) {
    const stranded = rows.filter((r) => r.slotPosition >= newCount);
    if (stranded.length === 0) continue;

    const taken = new Set(rows.filter((r) => r.slotPosition < newCount).map((r) => r.slotPosition));
    const free: number[] = [];
    for (let p = 0; p < newCount && free.length < stranded.length; p++) {
      if (!taken.has(p)) free.push(p);
    }
    if (free.length < stranded.length) {
      return { ok: false, date, stranded: stranded.length, free: free.length };
    }
    stranded.forEach((s, i) => moves.push({
      bookingId:    s.id,
      date,
      from:         s.slotPosition,
      to:           free[i],
      campaignId:   s.campaignId,
      campaignName: s.campaign.name,
    }));
  }
  return { ok: true, moves };
}

/** Applies a planned compaction. Single transaction — a partially-moved loop would
 *  leave some paid slots unplayable, which is exactly what this is preventing. */
export async function applySlotMoves(moves: SlotMove[]): Promise<void> {
  if (moves.length === 0) return;
  await db.$transaction(
    moves.map((m) => db.slotBooking.update({
      where: { id: m.bookingId },
      data:  { slotPosition: m.to },
    })),
  );
}

/** Resolves the effective filler campaign for a store: per-store override, else the
 *  global PlayerConfig default. Null when neither is set or the campaign has no
 *  playable slot creative. */
export async function resolveFillerCampaign(
  storeFillerCampaignId: string | null,
): Promise<{ campaignId: string; contentId: string } | null> {
  let campaignId = storeFillerCampaignId;
  if (!campaignId) {
    const cfg = await db.playerConfig.findUnique({ where: { id: 1 }, select: { fillerCampaignId: true } });
    campaignId = cfg?.fillerCampaignId ?? null;
  }
  if (!campaignId) return null;
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId }, select: { id: true, slotContentId: true },
  });
  if (!campaign?.slotContentId) return null;
  return { campaignId: campaign.id, contentId: campaign.slotContentId };
}

/** Sold-count availability per store per date, honouring open_days exclusion.
 *  Closed dates are returned with sold=null so UIs can grey them out.
 *
 *  Only counts bookings INSIDE the store's current loop (slotPosition < loopSlotCount).
 *  A shrunk loop can strand bookings above the new count; buildSlotLoop already ignores
 *  those, so counting them here would report more sold than the loop has positions and
 *  read as "sold out" on a store that still has free slots. The settings route blocks
 *  shrinking past sold inventory, so strays should not exist — this keeps the arithmetic
 *  honest regardless (legacy rows, direct DB edits). */
export async function availabilityGrid(
  stores: { id: string; openDays: number; loopSlotCount: number }[],
  dates: string[],
): Promise<Map<string, Map<string, number | null>>> {
  const countMap = new Map<string, number>();
  if (stores.length && dates.length) {
    const dateFilter = {
      gte: new Date(`${dates[0]}T00:00:00Z`),
      lte: new Date(`${dates[dates.length - 1]}T00:00:00Z`),
    };
    // Stores can run different loop sizes, so bucket by size and issue one grouped
    // query per distinct size (a handful at most) rather than per store.
    const bySize = new Map<number, string[]>();
    for (const s of stores) {
      const list = bySize.get(s.loopSlotCount) ?? [];
      list.push(s.id);
      bySize.set(s.loopSlotCount, list);
    }
    const results = await Promise.all(
      [...bySize.entries()].map(([loopSlotCount, storeIds]) =>
        db.slotBooking.groupBy({
          by: ['storeId', 'date'],
          where: { storeId: { in: storeIds }, date: dateFilter, slotPosition: { lt: loopSlotCount } },
          _count: { id: true },
        }),
      ),
    );
    for (const c of results.flat()) {
      countMap.set(`${c.storeId}|${c.date.toISOString().slice(0, 10)}`, c._count.id);
    }
  }

  const grid = new Map<string, Map<string, number | null>>();
  for (const s of stores) {
    const row = new Map<string, number | null>();
    for (const d of dates) {
      row.set(d, isOpenOn(s.openDays, d) ? (countMap.get(`${s.id}|${d}`) ?? 0) : null);
    }
    grid.set(s.id, row);
  }
  return grid;
}
