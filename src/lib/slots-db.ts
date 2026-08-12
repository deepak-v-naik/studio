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
 *  Closed dates are returned with sold=null so UIs can grey them out. */
export async function availabilityGrid(
  stores: { id: string; openDays: number; loopSlotCount: number }[],
  dates: string[],
): Promise<Map<string, Map<string, number | null>>> {
  const storeIds = stores.map((s) => s.id);
  const counts = storeIds.length && dates.length
    ? await db.slotBooking.groupBy({
        by: ['storeId', 'date'],
        where: {
          storeId: { in: storeIds },
          date: { gte: new Date(`${dates[0]}T00:00:00Z`), lte: new Date(`${dates[dates.length - 1]}T00:00:00Z`) },
        },
        _count: { id: true },
      })
    : [];
  const countMap = new Map<string, number>();
  for (const c of counts) {
    countMap.set(`${c.storeId}|${c.date.toISOString().slice(0, 10)}`, c._count.id);
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
