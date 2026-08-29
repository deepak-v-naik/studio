// CSV export of play events for billing/reporting.
// GET /api/events/export/csv?deviceId=&campaignId=&tag=&from=&to=
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

function esc(v: string | null | undefined) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p          = req.nextUrl.searchParams;
  const deviceId   = p.get('deviceId')   ?? undefined;
  const campaignId = p.get('campaignId') ?? undefined;
  const tag        = p.get('tag')        ?? undefined;
  const from       = p.get('from') ? new Date(p.get('from')!) : undefined;
  const to         = p.get('to')   ? new Date(p.get('to')!)   : undefined;

  try {
    const events = await db.playEvent.findMany({
      where: {
        ...(deviceId   ? { deviceId }   : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(tag        ? { tag }        : {}),
        ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: {
        id: true, deviceId: true, mediaId: true, campaignId: true,
        tag: true, startedAt: true, endedAt: true, durationMs: true,
        device: { select: { name: true, groupName: true } },
      },
      orderBy: { startedAt: 'asc' },
      take:    50_000,
    });

    const header = 'id,deviceId,deviceName,groupName,mediaId,campaignId,tag,startedAt,endedAt,durationMs';
    const rows = events.map((e) =>
      [
        esc(e.id), esc(e.deviceId), esc(e.device.name), esc(e.device.groupName),
        esc(e.mediaId), esc(e.campaignId), esc(e.tag),
        esc(e.startedAt.toISOString()), esc(e.endedAt.toISOString()),
        esc(String(e.durationMs)),
      ].join(',')
    );

    const csv = [header, ...rows].join('\n');
    const filename = `alive-pop-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
