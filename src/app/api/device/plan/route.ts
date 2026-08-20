// Device plan — returns the active schedule + content manifest for the next 72 hours.
// Player polls this every 72 h (Xibo-style). On change: md5 differs → re-download.
//
// GET /api/device/plan
// Auth: Authorization: Bearer <device-jwt>
// Returns: { planHash, validUntil, scheduleId, items: [...], timeline: [...] }
//
// Schedule priority enforcement: when two schedules overlap in time, the higher-priority
// schedule wins for the overlapping window. resolveConflicts() implements this logic.

import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import crypto from 'crypto';
import { getOrCreateCorrelationId, hashStack, recordError } from '@/lib/telemetry';
import { resolvePlaylistTree, type PlanMediaItem, type PlanNestedNode } from '@/lib/playlist-nesting';
import { istToday, isOpenOn, buildSlotLoop, SLOT_DURATION_MS } from '@/lib/slots';
import { resolveFillerCampaign } from '@/lib/slots-db';
import { resolveOfflineAlerts } from '@/lib/device-alerts';

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
    // A well-formed token whose device row no longer exists means the screen was
    // deleted in the admin panel. Distinguished from a bad token ('gone', not null)
    // so the caller can answer 410 and the player knows to decommission itself —
    // wipe its cache and return to pairing — instead of re-claiming and silently
    // resurrecting the deleted screen with its old cached content.
    if (!device) return 'gone' as const;

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

// ── Dayparting ───────────────────────────────────────────────────────────────
// Schedules can carry an optional daily window (dailyStart/dailyEnd, "HH:mm",
// IST). Expand each schedule into concrete daily sub-windows so resolveConflicts
// and the player's timeline honour it — previously these fields were stored by
// the admin UI but silently ignored here.

const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30, no DST
const DAY_MS = 86_400_000;

function parseHHmm(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return (h * 60 + min) * 60 * 1000;
}

function expandDaypart(
  s: { startAt: Date; endAt: Date; dailyStart: string | null; dailyEnd: string | null },
  horizonStart: Date,
  horizonEnd: Date,
): { startAt: Date; endAt: Date }[] {
  const rangeStart = Math.max(s.startAt.getTime(), horizonStart.getTime());
  const rangeEnd   = Math.min(s.endAt.getTime(),   horizonEnd.getTime());
  if (rangeStart >= rangeEnd) return [];

  const dayStartMs = parseHHmm(s.dailyStart);
  const dayEndMs   = parseHHmm(s.dailyEnd);
  if (dayStartMs == null || dayEndMs == null) {
    return [{ startAt: new Date(rangeStart), endAt: new Date(rangeEnd) }];
  }

  const out: { startAt: Date; endAt: Date }[] = [];
  // Walk IST calendar days, starting one day early so an overnight window
  // (dailyEnd <= dailyStart, e.g. 22:00–06:00) begun yesterday still covers
  // the start of the range.
  let dayIst = Math.floor((rangeStart + IST_OFFSET_MS) / DAY_MS) * DAY_MS - DAY_MS;
  const lastDayIst = Math.floor((rangeEnd + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  for (; dayIst <= lastDayIst; dayIst += DAY_MS) {
    const winStart = dayIst + dayStartMs - IST_OFFSET_MS;
    let   winEnd   = dayIst + dayEndMs   - IST_OFFSET_MS;
    if (dayEndMs <= dayStartMs) winEnd += DAY_MS; // overnight wrap
    const start = Math.max(winStart, rangeStart);
    const end   = Math.min(winEnd,   rangeEnd);
    if (start < end) out.push({ startAt: new Date(start), endAt: new Date(end) });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers.get('x-correlation-id'));
  const route = '/api/device/plan';
  const device = await authenticate(req);
  if (device === 'gone') return NextResponse.json({ error: 'Device deleted' }, { status: 410 });
  if (!device) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now       = new Date();
  const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  try {
    // Load device's store info: city for schedule/overlay targeting, plus the store's
    // slot-loop config (loopSlotCount set = slot mode, see the SlotBooking model).
    const deviceWithStore = device.storeId
      ? await db.store.findUnique({
          where:  { id: device.storeId },
          select: {
            id: true, city: true,
            loopSlotCount: true, openDays: true, hoursStart: true, hoursEnd: true,
            fillerCampaignId: true,
          },
        })
      : null;
    const slotMode = deviceWithStore?.loopSlotCount != null;

    // Plan items: an item may carry slot attribution (slot mode only) which the
    // player echoes back in proof-of-play events for guaranteed-vs-bonus reporting.
    type WireItem = PlanMediaItem & { slotPosition?: number; isFiller?: boolean; campaignId?: string };
    type TimelineSlot = {
      scheduleId: string; priority: number; startAt: string; endAt: string;
      playlistId: string | null; name: string | null;
    };
    let items:      WireItem[]       = [];
    let nested:     PlanNestedNode[] = [];
    let timeline:   TimelineSlot[]   = [];
    let transition: 'NONE' | 'FADE' | 'SLIDE' = 'NONE';
    let scheduleId: string | null    = null;

    if (slotMode) {
      // ── Slot mode: fixed loop of N 10s ad slots, sold by position+date ─────────
      // Today's loop only (bookings differ per day and the plan format shares one
      // item list across windows); the 15-min poll + midnight hash change roll the
      // loop over to the next day's bookings.
      const store = deviceWithStore!;
      const today = istToday(now);
      if (isOpenOn(store.openDays, today)) {
        const bookings = await db.slotBooking.findMany({
          where:  { storeId: store.id, date: new Date(`${today}T00:00:00Z`) },
          select: {
            slotPosition: true, campaignId: true,
            campaign: { select: { slotContentId: true } },
          },
        });
        const filler = await resolveFillerCampaign(store.fillerCampaignId);
        const loop = buildSlotLoop(
          store.loopSlotCount!,
          bookings.map((b) => ({
            slotPosition: b.slotPosition, campaignId: b.campaignId,
            slotContentId: b.campaign.slotContentId,
          })),
          filler,
        );

        const contentIds = [...new Set(loop.map((a) => a.contentId))];
        const contents = contentIds.length
          ? await db.content.findMany({
              where:  { id: { in: contentIds } },
              select: { id: true, objectKey: true, md5: true, type: true, hevcObjectKey: true, hevcMd5: true },
            })
          : [];
        const contentMap = new Map(contents.map((c) => [c.id, c]));

        items = loop.flatMap((a) => {
          const c = contentMap.get(a.contentId);
          if (!c) return [];
          return [{
            contentId:  c.id,
            objectKey:  c.objectKey,
            url:        publicUrl(c.objectKey),
            md5:        c.md5,
            type:       c.type,
            durationMs: SLOT_DURATION_MS,
            order:      a.slotPosition,
            hevcUrl:    c.hevcObjectKey ? publicUrl(c.hevcObjectKey) : undefined,
            hevcMd5:    c.hevcMd5 ?? undefined,
            slotPosition: a.slotPosition,
            isFiller:     a.isFiller,
            campaignId:   a.campaignId,
          }];
        });

        const winStart = new Date(`${today}T${store.hoursStart}:00+05:30`);
        const winEnd   = new Date(`${today}T${store.hoursEnd}:00+05:30`);
        if (items.length > 0 && winEnd > now) {
          scheduleId = `slotloop:${today}`;
          timeline = [{
            scheduleId, priority: 0,
            startAt: winStart.toISOString(), endAt: winEnd.toISOString(),
            playlistId: null, name: `Slot loop ${today}`,
          }];
        }
      }
    }
    // A slot-mode day can resolve to nothing playable: store closed, or zero
    // bookings with usable creatives AND no filler campaign. The spec promises
    // playback never goes dark, and serving an empty plan here has blanked a real
    // screen for a whole day — so fall back to the store's schedules instead of
    // idling. Slot loop with items always wins; schedules are the safety net.
    if (!slotMode || items.length === 0) {
      // ── Schedule mode (and the fallback when the slot loop is empty) ───────────
      // Find all schedules active in the next 72-hr window for this device, group, store, or city.
      const scheduleOrConditions: Record<string, unknown>[] = [
        { deviceIds: { has: device.id } },
        ...(device.groupName       ? [{ groupName:  device.groupName }]              : []),
        ...(device.storeId         ? [{ storeIds:   { has: device.storeId } }]       : []),
        ...(deviceWithStore?.city  ? [{ cityFilter:  deviceWithStore.city }]          : []),
        // "all screens" schedules — none of the targeting fields set. Same
        // contract as the overlay query below; without this branch the
        // Schedules tab's "All screens" target mode never matched any device.
        { AND: [
            { deviceIds:  { isEmpty: true } },
            { groupName:  null },
            { storeIds:   { isEmpty: true } },
            { cityFilter: null },
        ] },
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
          dailyStart: true,
          dailyEnd:   true,
          // Items come from resolvePlaylistTree below (handles nested playlists);
          // only the playlist-level transition is needed here.
          playlist: { select: { transition: true } },
        },
        orderBy: [{ priority: 'desc' }, { startAt: 'asc' }],
      });

      // Resolve priority conflicts across the 72-hr window, honouring dayparting
      const windows: ScheduleWindow[] = schedules.flatMap((s) =>
        expandDaypart(s, now, windowEnd).map((w) => ({
          scheduleId: s.id,
          priority:   s.priority,
          startAt:    w.startAt,
          endAt:      w.endAt,
        })),
      );
      const resolvedSlots = resolveConflicts(windows);

      // Build a map for quick lookup of schedule data
      const scheduleMap = new Map(schedules.map((s) => [s.id, s]));

      // For backward-compat: primary schedule is the one active right now (or first upcoming)
      const nowMs = now.getTime();
      const currentSlot = resolvedSlots.find(
        (sl) => sl.startAt.getTime() <= nowMs && sl.endAt.getTime() > nowMs,
      ) ?? resolvedSlots[0];
      const schedule = currentSlot ? scheduleMap.get(currentSlot.scheduleId) : undefined;
      scheduleId = schedule?.id ?? null;
      transition = schedule?.playlist.transition ?? 'NONE';

      // Resolve the active playlist including any nested (Master → Internal) playlists.
      // `items` stays the fully-flattened play order — identical semantics for legacy
      // players and doubles as the download manifest; `nested` carries the tree for
      // nesting-aware players (SMIL <seq>-in-<seq>: a nested playlist plays fully per visit).
      const tree = schedule ? await resolvePlaylistTree(schedule.playlistId) : { nested: [], flat: [] };
      items  = tree.flat;
      nested = tree.nested;

      // Build the full timeline for the 72-hr window
      timeline = resolvedSlots.map((slot) => {
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
    }

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


    // Fleet-wide player behavior knobs (retry interval, transition duration, kiosk key
    // lock, download timeouts, fallback playlist). The scalar knobs are device-level
    // like orientation and excluded from planHash; the fallback playlist is content
    // and IS hashed, so changing it triggers a refresh + download like any playlist.
    const playerConfig = await db.playerConfig.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });

    // Xibo-style default layout: content to play when no schedule window is active,
    // instead of the idle "waiting for content" screen. Flattened only — the fallback
    // loops in full anyway, so nesting adds nothing here.
    let fallback: typeof items = [];
    if (playerConfig.fallbackPlaylistId) {
      fallback = (await resolvePlaylistTree(playerConfig.fallbackPlaylistId)).flat;
    }

    // Hash the plan so the player can detect changes without re-downloading.
    // transition is included (unlike orientation, which is device-level and applied
    // outside this pipeline) since it flows through the same cached-plan-JSON path as
    // items -- a transition-only change is a real schedule update worth refreshing for.
    const planHash = crypto
      .createHash('md5')
      .update(JSON.stringify({ items, nested, timeline, overlays, transition, fallback, forceSyncAt: device.forceSyncAt?.toISOString() ?? null }))
      .digest('hex');

    // Update device heartbeat
    await db.device.update({
      where: { id: device.id },
      data:  { lastSeen: now, status: 'ONLINE' },
    });

    // `device` is the row as it was BEFORE that write, so this is the recovery
    // edge: a screen that was OFFLINE just came back. Close its alert (and tell
    // the partner, if they were told it broke).
    //
    // after() rather than a bare `void`: this is the ONLY code path that ever
    // sets an alert RESOLVED, and Vercel suspends the instance once the response
    // is flushed. A dropped promise would strand the alert OPEN forever — which
    // both leaves a false "screen has stopped" banner on the partner's dashboard
    // and permanently silences that device (openOfflineAlerts skips devices with
    // an OPEN alert). after() keeps the work alive past the response.
    if (device.status === 'OFFLINE') after(() => resolveOfflineAlerts(device.id, now));

    return NextResponse.json({
      planHash,
      scheduleId,
      validUntil: windowEnd.toISOString(),
      forceSyncAt: device.forceSyncAt?.toISOString() ?? null,
      orientation: device.orientation,
      transition,
      fallback,
      config: {
        retryIntervalMs:          playerConfig.retryIntervalMs,
        transitionDurationMs:     playerConfig.transitionDurationMs,
        kioskKeyLockEnabled:      playerConfig.kioskKeyLockEnabled,
        downloadConnectTimeoutMs: playerConfig.downloadConnectTimeoutMs,
        downloadReadTimeoutMs:    playerConfig.downloadReadTimeoutMs,
      },
      items,
      nested,
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
