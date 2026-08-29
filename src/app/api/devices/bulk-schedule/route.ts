// POST /api/devices/bulk-schedule
// Creates a high-priority takeover schedule for specified devices.
// Body: { deviceIds: string[], playlistId: string, durationMins: number, name?: string }
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { deviceIds, playlistId, durationMins, name } = await req.json() as {
      deviceIds:   string[];
      playlistId:  string;
      durationMins: number;
      name?:       string;
    };

    if (!deviceIds?.length)  return NextResponse.json({ error: 'deviceIds required' }, { status: 400 });
    if (!playlistId)          return NextResponse.json({ error: 'playlistId required' }, { status: 400 });
    if (!durationMins || durationMins < 1) return NextResponse.json({ error: 'durationMins must be >= 1' }, { status: 400 });

    const startAt = new Date();
    const endAt   = new Date(startAt.getTime() + durationMins * 60 * 1000);

    const schedule = await db.schedule.create({
      data: {
        name:       name ?? `Takeover ${startAt.toLocaleString('en-IN')}`,
        playlistId,
        deviceIds,
        priority:   9,   // highest priority — overrides any other active schedule
        startAt,
        endAt,
        recurrence: 'ONCE',
        orientation: 'portrait',
      },
    });

    return NextResponse.json({ schedule: { id: schedule.id, name: schedule.name, endsAt: schedule.endAt } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
