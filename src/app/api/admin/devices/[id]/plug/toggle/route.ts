// Switch the screen's Sonoff relay on/off (remote power-cycle path).
// POST /api/admin/devices/[id]/plug/toggle   { on: boolean }
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getLinkedAccount, setSwitch } from '@/lib/ewelink';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = (await req.json()) as { on?: boolean };
    if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'on: boolean required' }, { status: 400 });

    const plug = await db.smartPlug.findUnique({ where: { deviceId: id } });
    if (!plug) return NextResponse.json({ error: 'No plug linked to this screen' }, { status: 404 });

    const account = await getLinkedAccount();
    if (!account || account.needsReauth) {
      return NextResponse.json({ error: 'eWeLink account not connected' }, { status: 409 });
    }

    await setSwitch(account, plug.ewelinkDeviceId, body.on);
    const updated = await db.smartPlug.update({
      where: { id: plug.id },
      data: { switchOn: body.on, lastPolledAt: new Date() },
    });
    return NextResponse.json({ plug: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
