// Schedule CRUD.
// GET  /api/schedules   → { schedules: Schedule[] }
// POST /api/schedules   → { schedule: Schedule }
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushPlanUpdated, resolveScheduleDeviceIds } from '@/lib/fcm';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = await db.schedule.findMany({
      select: {
        id:          true,
        name:        true,
        playlistId:  true,
        priority:    true,
        deviceIds:   true,
        groupName:   true,
        storeIds:    true,
        cityFilter:  true,
        startAt:     true,
        endAt:       true,
        recurrence:  true,
        dailyStart:  true,
        dailyEnd:    true,
        createdAt:   true,
        orientation:  true,
        intervalMins: true,
        playlist: { select: { name: true } },
      },
      orderBy: { startAt: 'desc' },
    });
    const schedules = rows.map((s) => ({
      ...s,
      orientation:  (s as { orientation?: string }).orientation  ?? 'landscape',
      intervalMins: (s as { intervalMins?: number | null }).intervalMins ?? null,
      recurrence:   s.recurrence.toLowerCase() as 'once' | 'daily' | 'weekly',
      startAt:      s.startAt.toISOString(),
      endAt:        s.endAt.toISOString(),
      createdAt:    s.createdAt.toISOString(),
    }));
    return NextResponse.json({ schedules });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    // If new columns don't exist yet (migration pending), fall back to core fields only
    if (msg.includes('orientation') || msg.includes('intervalMins') || msg.includes('column')) {
      try {
        const rows = await db.schedule.findMany({
          select: {
            id: true, name: true, playlistId: true, priority: true,
            deviceIds: true, groupName: true, startAt: true, endAt: true,
            recurrence: true, dailyStart: true, dailyEnd: true, createdAt: true,
            playlist: { select: { name: true } },
          },
          orderBy: { startAt: 'desc' },
        });
        const schedules = rows.map((s) => ({
          ...s,
          orientation:  'landscape' as const,
          intervalMins: null,
          recurrence:   s.recurrence.toLowerCase() as 'once' | 'daily' | 'weekly',
          startAt:      s.startAt.toISOString(),
          endAt:        s.endAt.toISOString(),
          createdAt:    s.createdAt.toISOString(),
        }));
        return NextResponse.json({ schedules });
      } catch (e2) {
        return NextResponse.json({ error: (e2 as Error).message }, { status: 500 });
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const {
      name, playlistId, groupName, deviceIds, storeIds, cityFilter,
      startAt, endAt, recurrence,
      dailyStart, dailyEnd, priority,
      orientation, intervalMins,
      replaceScheduleIds,
    } = await req.json() as {
      name:          string;
      playlistId:    string;
      groupName?:    string;
      deviceIds?:    string[];
      storeIds?:     string[];
      cityFilter?:   string | null;
      startAt:       string;
      endAt:         string;
      recurrence:    'once' | 'daily' | 'weekly';
      dailyStart?:   string;
      dailyEnd?:     string;
      priority?:     number;
      orientation?:  'landscape' | 'portrait' | 'any';
      intervalMins?: number | null;
      // Schedules the admin confirmed replacing (see /api/schedules/conflicts).
      // Deleted in the same transaction that creates the new schedule, so a
      // failed create can never leave a screen with neither playlist.
      replaceScheduleIds?: string[];
    };

    if (!name || !playlistId || !startAt || !endAt) {
      return NextResponse.json({ error: 'name, playlistId, startAt, endAt required' }, { status: 400 });
    }

    const replaceIds = Array.isArray(replaceScheduleIds)
      ? replaceScheduleIds.filter((x): x is string => typeof x === 'string')
      : [];
    // Capture the replaced schedules' targeting BEFORE deleting — their screens
    // also need a plan_updated push (the old playlist just left them).
    const replacedTargets = replaceIds.length
      ? await db.schedule.findMany({
          where:  { id: { in: replaceIds } },
          select: { deviceIds: true, groupName: true, storeIds: true, cityFilter: true },
        })
      : [];

    const baseData = {
      name,
      playlistId,
      priority:   priority   ?? 0,
      groupName:  groupName  ?? null,
      deviceIds:  deviceIds  ?? [],
      storeIds:   storeIds   ?? [],
      cityFilter: cityFilter ?? null,
      startAt:    new Date(startAt),
      endAt:      new Date(endAt),
      recurrence: (recurrence?.toUpperCase() ?? 'ONCE') as 'ONCE' | 'DAILY' | 'WEEKLY',
      dailyStart: dailyStart ?? null,
      dailyEnd:   dailyEnd   ?? null,
    };

    // With replaceIds: delete-old + create-new atomically. A rolled-back attempt
    // (e.g. the orientation-column fallback below) deletes nothing, so the retry
    // starts clean. Returns the real delete count — stale ids delete nothing.
    const createSchedule = (data: typeof baseData & { orientation?: string; intervalMins?: number | null }) =>
      replaceIds.length
        ? db.$transaction(async (tx) => {
            const del = await tx.schedule.deleteMany({ where: { id: { in: replaceIds } } });
            const row = await tx.schedule.create({ data, include: { playlist: { select: { name: true } } } });
            return { row, deleted: del.count };
          })
        : db.schedule.create({ data, include: { playlist: { select: { name: true } } } })
            .then((row) => ({ row, deleted: 0 }));

    let schedule, deletedCount;
    try {
      ({ row: schedule, deleted: deletedCount } =
        await createSchedule({ ...baseData, orientation: orientation ?? 'landscape', intervalMins: intervalMins ?? null }));
    } catch (e1) {
      const msg1 = (e1 as Error).message ?? '';
      if (!msg1.includes('orientation') && !msg1.includes('intervalMins') && !msg1.includes('column')) throw e1;
      // orientation/intervalMins columns not yet migrated — create without them
      ({ row: schedule, deleted: deletedCount } = await createSchedule(baseData));
    }

    const norm = {
      ...schedule,
      orientation:  (schedule as { orientation?: string }).orientation  ?? 'landscape',
      intervalMins: (schedule as { intervalMins?: number | null }).intervalMins ?? null,
      recurrence:   schedule.recurrence.toLowerCase() as 'once' | 'daily' | 'weekly',
      startAt:      schedule.startAt.toISOString(),
      endAt:        schedule.endAt.toISOString(),
      createdAt:    schedule.createdAt.toISOString(),
    };

    // Push plan_updated to affected devices (best-effort, non-blocking) — the
    // new schedule's screens plus every screen a replaced schedule was serving.
    Promise.all([
      resolveScheduleDeviceIds({
        deviceIds:  schedule.deviceIds,
        groupName:  schedule.groupName,
        storeIds:   (schedule as { storeIds?: string[] }).storeIds,
        cityFilter: (schedule as { cityFilter?: string | null }).cityFilter,
      }),
      ...replacedTargets.map((t) => resolveScheduleDeviceIds(t)),
    ]).then((sets) => pushPlanUpdated(Array.from(new Set(sets.flat())))).catch(() => {});

    return NextResponse.json({ schedule: norm, replaced: deletedCount });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
