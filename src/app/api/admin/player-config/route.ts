// Fleet-wide player behavior knobs — editable from admin, no APK rebuild required.
// GET   /api/admin/player-config → { config: PlayerConfig }
// PATCH /api/admin/player-config → { config: PlayerConfig }
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

async function getOrCreateConfig() {
  return db.playerConfig.upsert({
    where:  { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const config = await getOrCreateConfig();
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      retryIntervalMs?:          number;
      transitionDurationMs?:     number;
      kioskKeyLockEnabled?:      boolean;
      downloadConnectTimeoutMs?: number;
      downloadReadTimeoutMs?:    number;
    };

    await getOrCreateConfig();
    const config = await db.playerConfig.update({
      where: { id: 1 },
      data:  body,
    });
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
