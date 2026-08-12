// PATCH /api/slots/settings — slot-mode configuration, three shapes:
//   { storeId, loopSlotCount?, openDays?, hoursStart?, hoursEnd?, fillerCampaignId? }
//     — per-store slot config. loopSlotCount: null disables slot mode (store reverts
//       to its normal schedules); an integer enables the fixed loop.
//   { defaultFillerCampaignId } — global house-ads default (PlayerConfig).
//   { campaignId, slotContentId } — assign a campaign's 10s slot creative.
// Auth: admin-password header. Store config changes push plan_updated to its devices.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseHHmm } from '@/lib/slots';
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
