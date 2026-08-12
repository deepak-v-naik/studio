// PATCH /api/slots/settings — slot-mode configuration, three shapes:
//   { storeId, loopSlotCount?, openDays?, hoursStart?, hoursEnd?, fillerCampaignId? }
//     — per-store slot config. loopSlotCount: null disables slot mode (store reverts
//       to its normal schedules); an integer enables the fixed loop.
//   { defaultFillerCampaignId } — global house-ads default (PlayerConfig).
//   { campaignId, slotContentId } — assign a campaign's 10s slot creative.
// Auth: admin-password header. Store config changes push plan_updated to its devices.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { istToday, parseHHmm } from '@/lib/slots';
import { pushPlanUpdated } from '@/lib/fcm';

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
    // or leaving slot mode — can strand bookings above the new count: the player would
    // stop playing them (buildSlotLoop ignores out-of-range positions) while the brand
    // has already paid. Refuse, and say exactly what is in the way, so the admin can
    // reassign those slots first. Past dates are ignored; they have already aired.
    if (body.loopSlotCount !== undefined) {
      const stranded = await db.slotBooking.findMany({
        where: {
          storeId: body.storeId,
          date: { gte: new Date(`${istToday()}T00:00:00Z`) },
          ...(body.loopSlotCount != null ? { slotPosition: { gte: body.loopSlotCount } } : {}),
        },
        select: { date: true, slotPosition: true, campaign: { select: { name: true } } },
        orderBy: [{ date: 'asc' }, { slotPosition: 'asc' }],
      });
      if (stranded.length > 0) {
        const first = stranded[0];
        return NextResponse.json({
          error: body.loopSlotCount == null
            ? `Cannot turn off slot mode: ${stranded.length} upcoming booking(s) are still sold, starting ${first.date.toISOString().slice(0, 10)} (${first.campaign.name}). Clear them first.`
            : `Cannot shrink to ${body.loopSlotCount} slots: ${stranded.length} upcoming booking(s) sit at position ${body.loopSlotCount + 1} or higher, starting ${first.date.toISOString().slice(0, 10)} (${first.campaign.name}, slot ${first.slotPosition + 1}). Reassign them to lower positions first.`,
          strandedCount: stranded.length,
          firstDate: first.date.toISOString().slice(0, 10),
        }, { status: 409 });
      }
    }
    if (body.openDays !== undefined && (!Number.isInteger(body.openDays) || body.openDays < 0 || body.openDays > 127)) {
      return NextResponse.json({ error: 'openDays must be a 7-bit Mon..Sun bitmask (0–127)' }, { status: 400 });
    }
    for (const f of ['hoursStart', 'hoursEnd'] as const) {
      if (body[f] !== undefined && parseHHmm(body[f]) == null) {
        return NextResponse.json({ error: `${f} must be HH:mm` }, { status: 400 });
      }
    }

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
        id: true, loopSlotCount: true, openDays: true,
        hoursStart: true, hoursEnd: true, fillerCampaignId: true,
      },
    });

    db.device.findMany({ where: { storeId: store.id }, select: { id: true } })
      .then((devices) => pushPlanUpdated(devices.map((d) => d.id)))
      .catch(() => {});

    return NextResponse.json({ store });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
