// PATCH /api/overlays/[id] — update an overlay
// DELETE /api/overlays/[id] — delete an overlay

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json() as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const passthrough = ['name', 'type', 'enabled', 'text', 'feedUrl', 'imageUrl', 'position',
      'bgColor', 'fgColor', 'speedPxSec', 'heightPct', 'deviceIds', 'groupName', 'storeIds',
      'cityFilter', 'dailyStart', 'dailyEnd', 'requireWifi', 'priority'];
    for (const k of passthrough) if (body[k] !== undefined) data[k] = body[k];
    if (body.startAt !== undefined) data.startAt = body.startAt ? new Date(body.startAt as string) : null;
    if (body.endAt   !== undefined) data.endAt   = body.endAt   ? new Date(body.endAt   as string) : null;

    const overlay = await db.overlay.update({ where: { id }, data });
    return NextResponse.json({
      overlay: {
        ...overlay,
        startAt:       overlay.startAt?.toISOString()       ?? null,
        endAt:         overlay.endAt?.toISOString()         ?? null,
        feedFetchedAt: overlay.feedFetchedAt?.toISOString() ?? null,
        createdAt:     overlay.createdAt.toISOString(),
        updatedAt:     overlay.updatedAt.toISOString(),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await db.overlay.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
