// POST /api/devices/[id]/force-sync — bump Device.forceSyncAt so the player's
// next poll sees a newer timestamp and re-fetches/re-downloads content.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushPlanUpdated } from '@/lib/fcm';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const device = await db.device.update({
      where: { id },
      data:  { forceSyncAt: new Date() },
      select: { id: true, forceSyncAt: true },
    });
    // Immediately notify the device via FCM so it doesn't wait for the 15-min poll
    pushPlanUpdated([id]).catch(() => {});
    return NextResponse.json({
      ok: true,
      forceSyncAt: device.forceSyncAt?.toISOString() ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
