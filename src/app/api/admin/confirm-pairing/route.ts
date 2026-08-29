// POST /api/admin/confirm-pairing
// Admin enters the 6-char code shown on the TV screen to add it to the fleet.
// Auth: admin-password header
// Body: { code: string }
// Returns: { device: { id, name, hardwareKey } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { code } = await req.json() as { code?: string };
    const normalised = code?.trim().toUpperCase();
    if (!normalised || normalised.length !== 6) {
      return NextResponse.json({ error: 'code must be exactly 6 characters' }, { status: 400 });
    }

    const device = await db.device.findUnique({
      where:  { pairingCode: normalised },
      select: { id: true, name: true, hardwareKey: true, pairedAt: true },
    });

    if (!device) {
      return NextResponse.json({ error: 'No device found with that code' }, { status: 404 });
    }
    if (device.pairedAt) {
      // Already confirmed — idempotent
      return NextResponse.json({ device: { id: device.id, name: device.name, hardwareKey: device.hardwareKey } });
    }

    await db.device.update({
      where: { id: device.id },
      data:  { pairedAt: new Date() },
    });

    return NextResponse.json({ device: { id: device.id, name: device.name, hardwareKey: device.hardwareKey } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
