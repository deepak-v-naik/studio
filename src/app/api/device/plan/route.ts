// Device plan — returns the active schedule + content manifest for the next 72 hours.
// Player polls this every 72 h (Xibo-style). On change: md5 differs → re-download.
//
// GET /api/device/plan
// Auth: Authorization: Bearer <device-jwt>
// Returns: { planHash, validUntil, scheduleId, items: [...], timeline: [...] }
//
// Schedule priority enforcement: when two schedules overlap in time, the higher-priority
// schedule wins for the overlapping window. resolveConflicts() implements this logic.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import crypto from 'crypto';
import { getOrCreateCorrelationId, hashStack, recordError } from '@/lib/telemetry';

async function authenticate(req: NextRequest) {
  const auth  = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  // We need the device to look up its secret — first decode sub without verifying
  // (safe because we verify immediately after with the correct secret)
  const parts  = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const deviceId = payload?.sub as string | undefined;
    if (!deviceId) return null;

    const device = await db.device.findUnique({ where: { id: deviceId } });
    if (!device) return null;

    const { verifyDeviceToken: verify } = await import('@/lib/device-auth');
    const result = await verify(token, device.jwtSecret);
    if (!result) return null;

    return device;
  } catch {
    return null;
  }
}

// ── Schedule conflict resolution ─────────────────────────────────────────────
// Given a list of schedules with overlapping time windows, produce a non-overlapping
// timeline where higher priority always wins. Equal priority: earlier startAt wins.
type ScheduleWindow = {
  scheduleId: string;
  priority:   number;
  startAt:    Date;
  endAt:      Date;
};

type ResolvedSlot = ScheduleWindow;

/**
 * Resolves conflicts between overlapping schedules.
 * Returns a list of non-overlapping slots in chronological order.
 * Higher `priority` value wins over lower; ties are broken by earlier `startAt`.
 */
function resolveConflicts(schedules: ScheduleWindow[]): ResolvedSlot[] {
  if (schedules.length === 0) return [];

  // Collect all boundary timestamps
  const boundaries = new Set<number>();
  for (const s of schedules) {
    boundaries.add(s.startAt.getTime());
    boundaries.add(s.endAt.getTime());
  }
  const times = Array.from(boundaries).sort((a, b) => a - b);

  const slots: ResolvedSlot[] = [];

  // For each adjacent pair of timestamps, find the highest-priority active schedule
  for (let i = 0; i < times.length - 1; i++) {
    const slotStart = times[i];
    const slotEnd   = times[i + 1];

    // Find schedules that cover this sub-interval
    const active = schedules.filter(
      (s) => s.startAt.getTime() <= slotStart && s.endAt.getTime() >= slotEnd,
    );
    if (active.length === 0) continue;

    // Pick the winner: highest priority, then earliest startAt as tiebreak
    active.sort((a, b) =>
      b.priority !== a.priority
        ? b.priority - a.priority
        : a.startAt.getTime() - b.startAt.getTime(),
    );
    const winner = active[0];

    // Merge with previous slot if same schedule and contiguous
    const prev = slots[slots.length - 1];
    if (prev && prev.scheduleId === winner.scheduleId && prev.endAt.getTime() === slotStart) {
      prev.endAt = new Date(slotEnd);
    } else {
      slots.push({
        scheduleId: winner.scheduleId,
        priority:   winner.priority,
        startAt:    new Date(slotStart),
        endAt:      new Date(slotEnd),
      });
    }
  }

  return slots;
}

export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers.get('x-correlation-id'));
  const route = '/api/device/plan';
  const device = await authenticate(req);
  if (!device) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now       = new Date();
  const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  try {
    // Load device's store info for city/store targeting
    const deviceWithStore = device.storeId
      ? await db.store.findUnique({ where: { id: device.storeId }, select: { id: true, city: true } })
      : null;

    // Find all schedules active in the next 72-hr window for this device, group, store, or city.
    const scheduleOrConditions = [
      { deviceIds: { has: device.id } },
      ...(device.groupName       ? [{ groupName:  device.groupName }]              : []),
      ...(device.storeId         ? [{ storeIds:   { has: device.storeId } }]       : []),
      ...(deviceWithStore?.city  ? [{ cityFilter:  deviceWithStore.city }]          : []),
    ];
    const schedules = await db.schedule.findMany({
      where: {
        startAt: { lte: windowEnd },
        endAt:   { gte: now },
        OR: scheduleOrConditions,
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
        recurrence: true,
        playlist: {
          select: {
            transition: true,
            items: {
              select: {
                durationMs: true,
                order:      true,
                content: {
                  select: {
                    id:         true,
                    objectKey:  true,
                    md5:        true,
                    type:       true,
                    durationMs: true,
                  },
                },
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { startAt: 'asc' }],
    });

    // Resolve priority conflicts across the 72-hr window
    const windows: ScheduleWindow[] = schedules.map((s) => ({
      scheduleId: s.id,
      priority:   s.priority,
      startAt:    s.startAt,
      endAt:      s.endAt,
    }));
    const resolvedSlots = resolveConflicts(windows);

    // Build a map for quick lookup of schedule data
    const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

    // For backward-compat: primary schedule is the one active right now (or first upcoming)
    const nowMs = now.getTime();
    const currentSlot = resolvedSlots.find(
      (sl) => sl.startAt.getTime() <= nowMs && sl.endAt.getTime() > nowMs,
    ) ?? resolvedSlots[0];
    const schedule = currentSlot ? scheduleMap.get(currentSlot.scheduleId) : undefined;

    const items = schedule?.playlist.items.map((item) => ({
      contentId:  item.content.id,
      objectKey:  item.content.objectKey,
      url:        publicUrl(item.content.objectKey),
      md5:        item.content.md5,
      type:       item.content.type,
      durationMs: item.durationMs,
      order:      item.order,
    })) ?? [];

    // Build the full timeline for the 72-hr window
    const timeline = resolvedSlots.map((slot) => {
      const s = scheduleMap.get(slot.scheduleId);
      return {
        scheduleId: slot.scheduleId,
        priority:   slot.priority,
        startAt:    slot.startAt.toISOString(),
        endAt:      slot.endAt.toISOString(),
        playlistId: s?.playlistId ?? null,
        name:       s?.name ?? null,
      };
    });

    // ── Resolve active overlays for this device ─────────────────────────────
    const overlayOrConditions: Record<string, unknown>[] = [
      { deviceIds: { has: device.id } },
    ];
    if (device.groupName)      overlayOrConditions.push({ groupName:  device.groupName });
    if (device.storeId)        overlayOrConditions.push({ storeIds:   { has: device.storeId } });
    if (deviceWithStore?.city) overlayOrConditions.push({ cityFilter: deviceWithStore.city });
    // "all screens" overlays — none of the targeting fields set
    overlayOrConditions.push({
      AND: [
        { deviceIds: { isEmpty: true } },
        { groupName: null },
        { storeIds:  { isEmpty: true } },
        { cityFilter: null },
      ],
    });

    const overlaysRaw = await db.overlay.findMany({
      where: {
        enabled: true,
        OR: overlayOrConditions,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt:   null }, { endAt:   { gte: now } }] },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    const overlays = overlaysRaw.map((o) => ({
      id:          o.id,
      name:        o.name,
      type:        o.type,
      text:        o.text,
      feedUrl:     o.feedUrl,
      imageUrl:    o.imageUrl,
      feedItems:   o.feedItems,
      position:    o.position,
      bgColor:     o.bgColor,
      fgColor:     o.fgColor,
      speedPxSec:  o.speedPxSec,
      heightPct:   o.heightPct,
      dailyStart:  o.dailyStart,
      dailyEnd:    o.dailyEnd,
      requireWifi: o.requireWifi,
      priority:    o.priority,
    }));

    const transition = schedule?.playlist.transition ?? 'NONE';

    // Hash the plan so the player can detect changes without re-downloading.
    // transition is included (unlike orientation, which is device-level and applied
    // outside this pipeline) since it flows through the same cached-plan-JSON path as
    // items -- a transition-only change is a real schedule update worth refreshing for.
    const planHash = crypto
      .createHash('md5')
      .update(JSON.stringify({ items, timeline, overlays, transition, forceSyncAt: device.forceSyncAt?.toISOString() ?? null }))
      .digest('hex');

    // Update device heartbeat
    await db.device.update({
      where: { id: device.id },
      data:  { lastSeen: now, status: 'ONLINE' },
    });

    return NextResponse.json({
      planHash,
      scheduleId: schedule?.id ?? null,
      validUntil: windowEnd.toISOString(),
      forceSyncAt: device.forceSyncAt?.toISOString() ?? null,
      orientation: device.orientation,
      transition,
      items,
      timeline,
      overlays,
    });
  } catch (e) {
    const error = e as Error;
    await recordError({
      route,
      errorClass: error.name,
      message: error.message,
      stackHash: hashStack(error.stack),
      requestMeta: { correlationId, method: req.method },
      actorType: 'device',
      deviceId: device.id,
      correlationId,
    });
    return NextResponse.json({ error: error.message, correlationId }, { status: 500 });
  }
}
