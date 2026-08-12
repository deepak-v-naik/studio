// Database-backed slot-loop helpers. Split from lib/slots.ts so the loop/availability
// math there stays pure (no Prisma import) and unit-testable.

import { db } from '@/lib/db';
import { isOpenOn } from '@/lib/slots';

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
