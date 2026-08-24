// Power card data for one screen: integration status, linked plug state, the
// recent power series, and energy totals.
// GET /api/admin/devices/[id]/power?hours=24     (hours clamped to 1..168)
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ewelinkConfigured } from '@/lib/ewelink';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const hours = Math.min(168, Math.max(1, Number(req.nextUrl.searchParams.get('hours') ?? 24) || 24));
    const now = Date.now();

    const [account, plug] = await Promise.all([
      db.ewelinkAccount.findUnique({ where: { id: 1 }, select: { region: true, needsReauth: true } }),
      db.smartPlug.findUnique({ where: { deviceId: id } }),
    ]);

    const status = {
      configured: ewelinkConfigured(),
      connected: Boolean(account),
      needsReauth: account?.needsReauth ?? false,
      region: account?.region ?? null,
    };
    if (!plug) return NextResponse.json({ ...status, plug: null, series: [], energy: null });

    const [series, wh24, wh7d] = await Promise.all([
      db.plugReading.findMany({
        where: { plugId: plug.id, at: { gte: new Date(now - hours * 3_600_000) } },
        orderBy: { at: 'asc' },
        select: { at: true, online: true, switchOn: true, powerW: true, energyWh: true, estimated: true },
      }),
      db.plugReading.aggregate({
        where: { plugId: plug.id, at: { gte: new Date(now - 24 * 3_600_000) } },
        _sum: { energyWh: true },
      }),
      db.plugReading.aggregate({
        where: { plugId: plug.id, at: { gte: new Date(now - 7 * 24 * 3_600_000) } },
        _sum: { energyWh: true },
      }),
    ]);

    return NextResponse.json({
      ...status,
      plug,
      series,
      energy: {
        wh24h: wh24._sum.energyWh ?? 0,
        wh7d: wh7d._sum.energyWh ?? 0,
        estimated: !plug.supportsEnergy,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
