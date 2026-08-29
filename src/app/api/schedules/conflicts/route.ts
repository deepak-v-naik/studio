// Pre-save conflict check for schedule creation.
// POST /api/schedules/conflicts → { conflicts: ScheduleConflict[] }
//
// Given the targeting + window of a schedule the admin is about to create,
// returns every existing schedule whose window overlaps AND whose resolved
// screens intersect the new schedule's screens. The Schedules tab shows these
// in a "replace the old playlist?" confirmation before saving; confirmed ids
// come back to POST /api/schedules as replaceScheduleIds and are deleted in
// the same transaction that creates the new schedule.
//
// Deliberately schedule-level: dayparting/recurrence are ignored — if the
// windows overlap at all, the admin is asked. Auth: admin-password header,
// same as the sibling schedule routes.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveScheduleDeviceIds } from '@/lib/fcm';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

type Targeting = {
  deviceIds?:  string[];
  groupName?:  string | null;
  storeIds?:   string[];
  cityFilter?: string | null;
};

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as Targeting & { startAt: string; endAt: string; excludeId?: string };
    if (!body.startAt || !body.endAt) {
      return NextResponse.json({ error: 'startAt, endAt required' }, { status: 400 });
    }
    const newStart = new Date(body.startAt);
    const newEnd   = new Date(body.endAt);

    const allDevices = await db.device.findMany({ select: { id: true, name: true } });
    const nameOf = new Map(allDevices.map((d) => [d.id, d.name]));

    // resolveScheduleDeviceIds handles every target mode incl. all-screens
    // (empty targeting = whole fleet), matching /api/device/plan's resolution.
    const newIds = new Set(await resolveScheduleDeviceIds({
      deviceIds:  body.deviceIds ?? [],
      groupName:  body.groupName,
      storeIds:   body.storeIds,
      cityFilter: body.cityFilter,
    }));
    if (newIds.size === 0) return NextResponse.json({ conflicts: [] });

    // Only schedules whose window overlaps the new one can conflict. Floor at
    // "now": a backdated startAt must not resurface schedules that already
    // ended — "already playing" would misstate them and deleting them is noise.
    const overlapFloor = newStart.getTime() > Date.now() ? newStart : new Date();
    const candidates = await db.schedule.findMany({
      where: {
        endAt:   { gt: overlapFloor },
        startAt: { lt: newEnd },
        ...(body.excludeId ? { id: { not: body.excludeId } } : {}),
      },
      select: {
        id: true, name: true, deviceIds: true, groupName: true, storeIds: true,
        cityFilter: true, startAt: true, endAt: true,
        playlist: { select: { name: true } },
      },
    });

    const conflicts = [];
    for (const s of candidates) {
      const oldIds = await resolveScheduleDeviceIds({
        deviceIds:  s.deviceIds,
        groupName:  s.groupName,
        storeIds:   s.storeIds,
        cityFilter: s.cityFilter,
      });
      const overlap = oldIds.filter((id) => newIds.has(id));
      if (overlap.length === 0) continue;
      conflicts.push({
        id:                 s.id,
        name:               s.name,
        playlistName:       s.playlist?.name ?? 'Unknown playlist',
        startAt:            s.startAt.toISOString(),
        endAt:              s.endAt.toISOString(),
        overlapCount:       overlap.length,
        overlapDeviceNames: overlap.slice(0, 5).map((id) => nameOf.get(id) ?? id),
        // Screens the old schedule serves that the new one does NOT — deleting
        // it takes their content away, so the dialog must call this out.
        extraCount:         oldIds.length - overlap.length,
      });
    }

    return NextResponse.json({ conflicts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
