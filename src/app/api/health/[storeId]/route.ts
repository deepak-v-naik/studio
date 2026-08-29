// GET /api/health/:storeId
// Returns RuView + ESPresense sensor node status for a store.
// Auth: admin-password header.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

function nodeStatus(lastSeen: Date | null) {
  if (!lastSeen) return 'unknown';
  return Date.now() - lastSeen.getTime() <= HEARTBEAT_TIMEOUT_MS ? 'online' : 'offline';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { storeId } = await params;

  const health = await db.storeSensorHealth.findUnique({ where: { storeId } });

  return NextResponse.json({
    storeId,
    calibrationStatus: health?.calibrationStatus ?? 'pending',
    firmwareVersion: health?.firmwareVersion ?? null,
    ruview: {
      lastSeen: health?.ruviewLastSeen?.toISOString() ?? null,
      uptime: health?.ruviewUptime ?? null,
      status: nodeStatus(health?.ruviewLastSeen ?? null),
    },
    espresense: {
      lastSeen: health?.espresenseLastSeen?.toISOString() ?? null,
      uptime: health?.espresenseUptime ?? null,
      status: nodeStatus(health?.espresenseLastSeen ?? null),
    },
  });
}
