// eWeLink account status + cloud device list, for the screen drawer's Power
// card (link picker).
// GET /api/admin/ewelink/devices
// Auth: admin-password header
// Returns { configured, connected, needsReauth, region, devices: [...] } where
// each device carries which screen (if any) it is already linked to.

import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/with-api-handler';
import { db } from '@/lib/db';
import { ewelinkConfigured, getLinkedAccount, listThings, isMeteringDevice, readPowerParams } from '@/lib/ewelink';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export const GET = withApiHandler('/api/admin/ewelink/devices', 'admin', async (req) => {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!ewelinkConfigured()) {
    return NextResponse.json({ configured: false, connected: false, needsReauth: false, region: null, devices: [] });
  }
  const account = await getLinkedAccount();
  if (!account || account.needsReauth) {
    return NextResponse.json({
      configured: true,
      connected: Boolean(account),
      needsReauth: account?.needsReauth ?? false,
      region: account?.region ?? null,
      devices: [],
    });
  }

  const [things, links] = await Promise.all([
    listThings(account),
    db.smartPlug.findMany({ select: { ewelinkDeviceId: true, deviceId: true, device: { select: { name: true } } } }),
  ]);
  const linkByEwelinkId = new Map(links.map((l) => [l.ewelinkDeviceId, l]));

  return NextResponse.json({
    configured: true,
    connected: true,
    needsReauth: false,
    region: account.region,
    devices: things.map((t) => {
      const link = linkByEwelinkId.get(t.deviceid);
      const snapshot = readPowerParams(t.params, t.uiid);
      return {
        ewelinkDeviceId: t.deviceid,
        name: t.name,
        productModel: t.productModel,
        uiid: t.uiid,
        online: t.online,
        switchOn: snapshot.switchOn,
        supportsEnergy: isMeteringDevice(t.params, t.uiid),
        linkedDeviceId: link?.deviceId ?? null,
        linkedDeviceName: link?.device.name ?? null,
      };
    }),
  });
});
