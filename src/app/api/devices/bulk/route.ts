// POST /api/devices/bulk  — bulk operations on multiple devices
// Body: { ids: string[]; action: 'group' | 'delete'; groupName?: string }
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushDecommission } from '@/lib/fcm';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { ids, action, groupName } = await req.json() as {
      ids:       string[];
      action:    'group' | 'delete';
      groupName?: string;
    };
    if (!ids?.length) return NextResponse.json({ error: 'ids required' }, { status: 400 });

    if (action === 'group') {
      await db.device.updateMany({
        where: { id: { in: ids } },
        data:  { groupName: groupName ?? null },
      });
      return NextResponse.json({ updated: ids.length });
    }

    if (action === 'delete') {
      // Capture FCM tokens BEFORE deleting — the rows are gone afterwards. The push
      // tells each screen to wipe its cached plan/media and return to pairing now;
      // screens that miss it (offline, FCM blocked) converge via the 410 the device
      // API answers on their next call.
      const doomed = await db.device.findMany({
        where:  { id: { in: ids }, fcmToken: { not: null } },
        select: { fcmToken: true },
      });
      await db.device.deleteMany({ where: { id: { in: ids } } });
      await pushDecommission(doomed.map((d) => d.fcmToken!));
      return NextResponse.json({ deleted: ids.length });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
