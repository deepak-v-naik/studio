// Link / configure / unlink a Sonoff smart plug for one screen.
// POST   /api/admin/devices/[id]/plug   { ewelinkDeviceId, ratedWatts? } — link
// PATCH  /api/admin/devices/[id]/plug   { ratedWatts }                  — update estimate wattage
// DELETE /api/admin/devices/[id]/plug                                   — unlink (readings cascade)
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getLinkedAccount, listThings, isMeteringDevice, readPowerParams } from '@/lib/ewelink';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = (await req.json()) as { ewelinkDeviceId?: string; ratedWatts?: number };
    if (!body.ewelinkDeviceId) return NextResponse.json({ error: 'ewelinkDeviceId required' }, { status: 400 });

    const device = await db.device.findUnique({ where: { id }, select: { id: true } });
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });

    const account = await getLinkedAccount();
    if (!account || account.needsReauth) {
      return NextResponse.json({ error: 'eWeLink account not connected' }, { status: 409 });
    }

    const thing = (await listThings(account)).find((t) => t.deviceid === body.ewelinkDeviceId);
    if (!thing) return NextResponse.json({ error: 'Device not found on the eWeLink account' }, { status: 404 });

    const snapshot = readPowerParams(thing.params, thing.uiid);
    const ratedWatts = typeof body.ratedWatts === 'number' && body.ratedWatts > 0 ? body.ratedWatts : null;
    const data = {
      deviceId: id,
      ewelinkDeviceId: thing.deviceid,
      name: thing.name,
      productModel: thing.productModel,
      uiid: thing.uiid,
      supportsEnergy: isMeteringDevice(thing.params, thing.uiid),
      ratedWatts,
      online: thing.online,
      switchOn: snapshot.switchOn,
      powerW: snapshot.powerW,
      voltageV: snapshot.voltageV,
      currentA: snapshot.currentA,
      lastPolledAt: new Date(),
    };
    // One plug per screen and one screen per plug — replace any stale link on
    // either side rather than failing on the unique constraints.
    const plug = await db.$transaction(async (tx) => {
      await tx.smartPlug.deleteMany({ where: { OR: [{ deviceId: id }, { ewelinkDeviceId: thing.deviceid }] } });
      return tx.smartPlug.create({ data });
    });
    return NextResponse.json({ plug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = (await req.json()) as { ratedWatts?: number | null };
    const ratedWatts = typeof body.ratedWatts === 'number' && body.ratedWatts > 0 ? body.ratedWatts : null;
    const plug = await db.smartPlug.update({ where: { deviceId: id }, data: { ratedWatts } });
    return NextResponse.json({ plug });
  } catch {
    return NextResponse.json({ error: 'No plug linked to this screen' }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    await db.smartPlug.delete({ where: { deviceId: id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'No plug linked to this screen' }, { status: 404 });
  }
}
