// POST /api/devices/[id]/command — push a remote command to a device over FCM.
// Equivalent to Xibo's XMR relay (collectNow/reboot/screenshot/etc pushed to players),
// but riding on FCM instead of a self-hosted ZeroMQ relay since Android already
// maintains that persistent, NAT-friendly connection for us.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushCommand, type DeviceCommandType } from '@/lib/fcm';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

// plan_updated is pushed automatically by schedule/playlist mutations (see fcm.ts
// callers) — this endpoint is for the two commands an admin triggers explicitly.
const ALLOWED_TYPES: DeviceCommandType[] = ['reboot', 'health_ping'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  let type: DeviceCommandType;
  try {
    const body = await req.json();
    if (!ALLOWED_TYPES.includes(body?.type)) {
      return NextResponse.json({ error: `type must be one of: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 });
    }
    type = body.type;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const device = await db.device.findUnique({ where: { id }, select: { id: true } });
  if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });

  await pushCommand([id], type);
  await db.auditLog.create({
    data: { action: 'device_command', target: id, meta: { type } },
  });

  return NextResponse.json({ ok: true });
}
