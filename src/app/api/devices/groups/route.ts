// GET /api/devices/groups — distinct group names with member counts + status breakdown
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

// Kept in sync with /api/devices and the device-health cron — see comment there.
const OFFLINE_THRESHOLD_MS = 20 * 60 * 1000;

function effectiveStatus(lastSeen: Date | null, dbStatus: string) {
  if (dbStatus === 'PENDING' && !lastSeen) return 'PENDING';
  if (!lastSeen) return 'OFFLINE';
  return Date.now() - lastSeen.getTime() < OFFLINE_THRESHOLD_MS ? 'ONLINE' : 'OFFLINE';
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = await db.device.findMany({
      where:  { groupName: { not: null } },
      select: { groupName: true, status: true, lastSeen: true },
    });

    const map = new Map<string, { total: number; online: number; offline: number; pending: number }>();
    for (const r of rows) {
      if (!r.groupName) continue;
      const s = effectiveStatus(r.lastSeen, r.status);
      const entry = map.get(r.groupName) ?? { total: 0, online: 0, offline: 0, pending: 0 };
      entry.total++;
      if (s === 'ONLINE')  entry.online++;
      if (s === 'OFFLINE') entry.offline++;
      if (s === 'PENDING') entry.pending++;
      map.set(r.groupName, entry);
    }

    const groups = Array.from(map.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
