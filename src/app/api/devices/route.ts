// GET /api/devices — list devices with status, scheduling, and store info.
// Supports cursor pagination + server-side filtering.
// Query params: ?status=ONLINE|OFFLINE|PENDING&q=&groupName=&storeId=&city=&cursor=&take=50&linked=true|false
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// Player heartbeat is a WorkManager PeriodicWorkRequest, clamped to a 15-min
// floor by Android regardless of the requested interval — 20 min matches the
// same threshold used by the device-health cron so this list and that cron
// agree on what "online" means.
const OFFLINE_THRESHOLD_MS = 20 * 60 * 1000;
const DEFAULT_TAKE = 50;

function adminGuard(req: NextRequest) {
  // Fail CLOSED: a missing ADMIN_PASSWORD must authorize nobody (see admin-auth.ts).
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

function effectiveStatus(lastSeen: Date | null, dbStatus: string): 'ONLINE' | 'OFFLINE' | 'PENDING' {
  if (dbStatus === 'PENDING' && !lastSeen) return 'PENDING';
  if (!lastSeen) return 'OFFLINE';
  return Date.now() - lastSeen.getTime() < OFFLINE_THRESHOLD_MS ? 'ONLINE' : 'OFFLINE';
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const p         = req.nextUrl.searchParams;
    const q         = p.get('q')?.trim() ?? '';
    const statusF   = p.get('status') ?? '';       // ONLINE | OFFLINE | PENDING
    const groupF    = p.get('groupName') ?? '';
    const storeIdF  = p.get('storeId')  ?? '';
    const cityF     = p.get('city')     ?? '';
    const linkedF   = p.get('linked')   ?? '';     // 'true' | 'false'
    const allF      = p.get('all')      ?? '';     // 'true' to include unconfirmed devices
    const cursor    = p.get('cursor')   ?? '';
    const take      = Math.min(200, Math.max(1, Number(p.get('take') ?? DEFAULT_TAKE)));

    // Build Prisma where clause (fields we can filter server-side)
    // Default: only show devices that have been admin-confirmed (pairedAt IS NOT NULL).
    // Pass ?all=true to include devices waiting for pairing confirmation.
    const where: Prisma.DeviceWhereInput = allF === 'true' ? {} : { pairedAt: { not: null } };
    if (q) {
      where.OR = [
        { name:        { contains: q, mode: 'insensitive' } },
        { hardwareKey: { contains: q, mode: 'insensitive' } },
        { id:          { contains: q } },
        { store: { storeName: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (groupF)   where.groupName = groupF;
    if (storeIdF) where.storeId   = storeIdF;
    if (cityF)    where.store     = { city: { equals: cityF, mode: 'insensitive' } };
    if (linkedF === 'true')  where.storeId = { not: null };
    if (linkedF === 'false') where.storeId = null;

    const rows = await db.device.findMany({
      where,
      orderBy:  { claimedAt: 'desc' },
      take:     take + 1,            // fetch one extra to detect next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id:           true,
        hardwareKey:  true,
        name:         true,
        storeId:      true,
        linkedAt:     true,
        status:       true,
        lastSeen:     true,
        groupName:    true,
        orientation:  true,
        playsOriginal: true,
        claimedAt:    true,
        uptimePctD30: true,
        store: {
          select: {
            storeName:     true,
            lat:           true,
            lng:           true,
            city:          true,
            locality:      true,
            loopSlotCount: true,
          },
        },
      },
    });

    const hasMore    = rows.length > take;
    const pageRows   = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null;

    const now = new Date();

    // Fetch active schedules for all devices/groups in one query
    const deviceIds  = pageRows.map((d) => d.id);
    const groupNames = [...new Set(pageRows.map((d) => d.groupName).filter(Boolean))] as string[];
    const storeIds   = [...new Set(pageRows.map((d) => d.storeId).filter(Boolean))] as string[];
    const cities     = [...new Set(pageRows.map((d) => d.store?.city).filter(Boolean))] as string[];

    const orConditions: Prisma.ScheduleWhereInput[] = [];
    if (deviceIds.length)  orConditions.push({ deviceIds: { hasSome: deviceIds } });
    if (groupNames.length) orConditions.push({ groupName: { in: groupNames } });
    if (storeIds.length)   orConditions.push({ storeIds:  { hasSome: storeIds } });
    if (cities.length)     orConditions.push({ cityFilter: { in: cities } });

    const activeSchedules = orConditions.length ? await db.schedule.findMany({
      where: {
        startAt: { lte: now },
        endAt:   { gte: now },
        OR: orConditions,
      },
      select: {
        id:         true,
        name:       true,
        playlistId: true,
        priority:   true,
        deviceIds:  true,
        groupName:  true,
        storeIds:   true,
        cityFilter: true,
        startAt:    true,
        endAt:      true,
        playlist:   { select: { name: true } },
      },
      orderBy: [{ priority: 'desc' }, { startAt: 'asc' }],
    }) : [];

    // Fetch last play event per device
    const lastEvents = await db.playEvent.groupBy({
      by:    ['deviceId'],
      where: { deviceId: { in: deviceIds } },
      _max:  { startedAt: true },
    });
    const lastPlayMap = new Map(lastEvents.map((e) => [e.deviceId, e._max.startedAt]));

    function currentScheduleFor(deviceId: string, devGroupName: string | null, devStoreId: string | null, devCity: string | null) {
      return activeSchedules.find(
        (s) =>
          (s.deviceIds as string[]).includes(deviceId) ||
          (devGroupName && s.groupName === devGroupName) ||
          (devStoreId   && (s.storeIds as string[]).includes(devStoreId)) ||
          (devCity      && s.cityFilter === devCity),
      ) ?? null;
    }

    // Client-side status filter (computed from lastSeen)
    const allDevices = pageRows.map((d) => {
      const computedStatus = effectiveStatus(d.lastSeen, d.status);
      const sched          = currentScheduleFor(d.id, d.groupName, d.storeId, d.store?.city ?? null);
      return {
        id:          d.id,
        hardwareKey: d.hardwareKey,
        storeName:   d.name,
        storeId:     d.storeId,
        linkedAt:    d.linkedAt?.toISOString() ?? null,
        linkedStoreName: d.store?.storeName ?? null,
        groupName:   d.groupName,
        orientation: d.orientation,
        playsOriginal: d.playsOriginal,
        status:      computedStatus,
        uptimePct:   d.uptimePctD30,
        lastSeen:    d.lastSeen?.toISOString() ?? null,
        lastPlayAt:  lastPlayMap.get(d.id)?.toISOString() ?? null,
        claimedAt:   d.claimedAt.toISOString(),
        lat:         d.store?.lat ?? null,
        lng:         d.store?.lng ?? null,
        city:        d.store?.city ?? null,
        locality:    d.store?.locality ?? null,
        slotMode:    d.store?.loopSlotCount != null,
        currentSchedule: sched ? {
          id:           sched.id,
          name:         sched.name,
          playlistName: sched.playlist?.name ?? null,
          endsAt:       sched.endAt.toISOString(),
        } : null,
      };
    });

    // Apply computed status filter
    const devices = statusF ? allDevices.filter((d) => d.status === statusF) : allDevices;

    // Summary counts (over the unfiltered page for the stat chips)
    const total = await db.device.count({ where });

    return NextResponse.json({ devices, nextCursor, total });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
