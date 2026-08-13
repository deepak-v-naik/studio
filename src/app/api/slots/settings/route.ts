// PATCH /api/slots/settings — slot-mode configuration, three shapes:
//   { storeId, loopSlotCount?, openDays?, hoursStart?, hoursEnd?, fillerCampaignId? }
//     — per-store slot config. loopSlotCount: null disables slot mode (store reverts
//       to its normal schedules); an integer enables the fixed loop.
//   { defaultFillerCampaignId } — global house-ads default (PlayerConfig).
//   { campaignId, slotContentId } — assign a campaign's 10s slot creative.
// Auth: admin-password header. Store config changes push plan_updated to its devices.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loopRepeatsPerDay, parseHHmm } from '@/lib/slots';
import { applySlotMoves, planSlotCompaction, type SlotMove } from '@/lib/slots-db';
import { notifyBrand, slotReassignedMsg } from '@/lib/notify';
import { pushPlanUpdated } from '@/lib/fcm';

/**
 * Records the reassignment and tells each affected brand. Grouped per campaign so a
 * brand gets one message however many of its slots moved. Best-effort throughout —
 * a failed notification must not roll back a resize that already applied.
 */
async function recordAndAnnounceMoves(
  store: { id: string; storeName: string; loopSlotCount: number | null; hoursStart: string; hoursEnd: string },
  moves: SlotMove[],
): Promise<void> {
  if (moves.length === 0) return;

  await db.auditLog.create({
    data: {
      action: 'slot_loop_resized',
      target: store.id,
      meta: {
        storeName:     store.storeName,
        loopSlotCount: store.loopSlotCount,
        movedCount:    moves.length,
        moves: moves.map((m) => ({
          date: m.date, from: m.from, to: m.to,
          campaignId: m.campaignId, campaignName: m.campaignName,
        })),
      },
    },
  }).catch(() => { /* the note is valuable, but never worth failing the resize over */ });

  const byCampaign = new Map<string, SlotMove[]>();
  for (const m of moves) {
    const list = byCampaign.get(m.campaignId) ?? [];
    list.push(m);
    byCampaign.set(m.campaignId, list);
  }

  const campaigns = await db.campaign.findMany({
    where:  { id: { in: [...byCampaign.keys()] } },
    select: { id: true, name: true, email: true, phone: true },
  });

  const guaranteedPerDay = store.loopSlotCount != null
    ? loopRepeatsPerDay({
        loopSlotCount: store.loopSlotCount,
        hoursStart:    store.hoursStart,
        hoursEnd:      store.hoursEnd,
      })
    : null;

  await Promise.allSettled(campaigns.map((c) => {
    const cMoves = byCampaign.get(c.id) ?? [];
    if (!c.email && !c.phone) return Promise.resolve();
    return notifyBrand(
      { email: c.email, phone: c.phone },
      `Your ALIVE slot at ${store.storeName} moved`,
      slotReassignedMsg({
        brandName:  c.name,
        storeName:  store.storeName,
        moves:      cMoves.map((m) => ({ date: m.date, from: m.from, to: m.to })),
        guaranteedPerDay: guaranteedPerDay != null ? guaranteedPerDay * cMoves.length : null,
      }),
    );
  }));
}

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

type Body = {
  storeId?: string;
  loopSlotCount?: number | null;
  openDays?: number;
  hoursStart?: string;
  hoursEnd?: string;
  fillerCampaignId?: string | null;
  defaultFillerCampaignId?: string | null;
  campaignId?: string;
  slotContentId?: string | null;
};

export async function PATCH(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as Body;

    if (body.campaignId !== undefined) {
      const campaign = await db.campaign.update({
        where:  { id: body.campaignId },
        data:   { slotContentId: body.slotContentId ?? null },
        select: { id: true, slotContentId: true },
      });
      return NextResponse.json({ campaign });
    }

    if (body.defaultFillerCampaignId !== undefined) {
      const config = await db.playerConfig.upsert({
        where:  { id: 1 },
        update: { fillerCampaignId: body.defaultFillerCampaignId },
        create: { id: 1, fillerCampaignId: body.defaultFillerCampaignId },
        select: { fillerCampaignId: true },
      });
      return NextResponse.json({ config });
    }

    if (!body.storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

    if (body.loopSlotCount != null && (!Number.isInteger(body.loopSlotCount) || body.loopSlotCount < 1 || body.loopSlotCount > 60)) {
      return NextResponse.json({ error: 'loopSlotCount must be 1–60 (or null to disable slot mode)' }, { status: 400 });
    }

    // Growing the loop is always safe (new positions are simply unsold). Shrinking it —
    // or leaving slot mode — strands bookings above the new count: the player skips
    // out-of-range positions, so a paid slot would silently stop playing. Pack those
    // down into free positions on the same date instead of refusing; a loop position is
    // an internal detail rather than something a brand buys, and every slot plays once
    // per loop regardless. Only a genuine oversell (more bookings than the new loop
    // holds) still blocks, because that needs a human to decide who gets dropped.
    let moves: SlotMove[] = [];
    if (body.loopSlotCount !== undefined) {
      const plan = await planSlotCompaction(body.storeId, body.loopSlotCount ?? 0);
      if (!plan.ok) {
        return NextResponse.json({
          error: body.loopSlotCount == null
            ? `Cannot turn off slot mode: ${plan.stranded} booking(s) are still sold on ${plan.date} and later. Clear them first.`
            : `Cannot shrink to ${body.loopSlotCount} slots: ${plan.date} has ${plan.stranded} booking(s) that need re-homing but only ${plan.free} free position(s). Free up slots on that date, or pick a larger number.`,
          date: plan.date, stranded: plan.stranded, free: plan.free,
        }, { status: 409 });
      }
      moves = plan.moves;
    }
    if (body.openDays !== undefined && (!Number.isInteger(body.openDays) || body.openDays < 0 || body.openDays > 127)) {
      return NextResponse.json({ error: 'openDays must be a 7-bit Mon..Sun bitmask (0–127)' }, { status: 400 });
    }
    for (const f of ['hoursStart', 'hoursEnd'] as const) {
      if (body[f] !== undefined && parseHHmm(body[f]) == null) {
        return NextResponse.json({ error: `${f} must be HH:mm` }, { status: 400 });
      }
    }

    // Re-home the stranded bookings BEFORE narrowing the loop, so there is no window
    // where a device could fetch a plan that drops slots the brands have paid for.
    await applySlotMoves(moves);

    const store = await db.store.update({
      where: { id: body.storeId },
      data: {
        ...(body.loopSlotCount    !== undefined ? { loopSlotCount:    body.loopSlotCount }    : {}),
        ...(body.openDays         !== undefined ? { openDays:         body.openDays }         : {}),
        ...(body.hoursStart       !== undefined ? { hoursStart:       body.hoursStart }       : {}),
        ...(body.hoursEnd         !== undefined ? { hoursEnd:         body.hoursEnd }         : {}),
        ...(body.fillerCampaignId !== undefined ? { fillerCampaignId: body.fillerCampaignId } : {}),
      },
      select: {
        id: true, storeName: true, loopSlotCount: true, openDays: true,
        hoursStart: true, hoursEnd: true, fillerCampaignId: true,
      },
    });

    // Audit note + brand emails/WhatsApps, after the resize is committed.
    void recordAndAnnounceMoves(store, moves);

    db.device.findMany({ where: { storeId: store.id }, select: { id: true } })
      .then((devices) => pushPlanUpdated(devices.map((d) => d.id)))
      .catch(() => {});

    return NextResponse.json({
      store,
      // Surfaced so the admin sees what the resize did rather than it happening silently.
      reassigned: moves.map((m) => ({
        date: m.date, from: m.from + 1, to: m.to + 1, campaignName: m.campaignName,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
