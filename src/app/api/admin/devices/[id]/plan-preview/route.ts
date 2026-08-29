// Admin diagnostic: simulate GET /api/device/plan for any device without needing the device JWT.
// GET /api/admin/devices/[id]/plan-preview
// Auth: admin-password header
// Returns: { device, plan, diagnostics }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import crypto from 'crypto';
import { buildSlotLoop, isOpenOn, istToday } from '@/lib/slots';
import { resolveFillerCampaign } from '@/lib/slots-db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const device = await db.device.findUnique({
      where: { id },
      select: {
        id: true, name: true, hardwareKey: true, groupName: true, status: true, lastSeen: true,
        uptimePctD30: true, storeId: true,
        store: { select: { storeName: true, city: true, loopSlotCount: true, openDays: true, fillerCampaignId: true } },
      },
    });
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });

    // Optional telemetry columns — may not exist on older DBs
    let telemetry: { cpuTempC: number | null; cpuTempUpdatedAt: string | null; freeStorageMb: number | null; androidVersion: string | null; appVersion: string | null; bootedAt: string | null; uptimeMs: number | null } | null = null;
    try {
      const t = await db.$queryRaw<{ cpuTempC: number | null; cpuTempUpdatedAt: Date | null; freeStorageMb: number | null; androidVersion: string | null; appVersion: string | null; bootedAt: Date | null }[]>`
        SELECT "cpuTempC", "cpuTempUpdatedAt", "freeStorageMb", "androidVersion", "appVersion", "bootedAt"
        FROM "Device" WHERE "id" = ${id} LIMIT 1
      `;
      const r = t[0];
      if (r) telemetry = {
        cpuTempC:         r.cpuTempC,
        cpuTempUpdatedAt: r.cpuTempUpdatedAt instanceof Date ? r.cpuTempUpdatedAt.toISOString() : null,
        freeStorageMb:    r.freeStorageMb,
        androidVersion:   r.androidVersion,
        appVersion:       r.appVersion,
        bootedAt:         r.bootedAt instanceof Date ? r.bootedAt.toISOString() : null,
        // Uptime as of NOW, derived per request rather than stored — see Device.bootedAt.
        uptimeMs:         r.bootedAt instanceof Date ? Date.now() - r.bootedAt.getTime() : null,
      };
    } catch { /* columns not yet migrated */ }

    // Last-7-day performance
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const perf = await db.playEvent.aggregate({
      where:  { deviceId: id, startedAt: { gte: sevenDaysAgo } },
      _count: { id: true },
      _sum:   { durationMs: true },
    }).catch(() => ({ _count: { id: 0 }, _sum: { durationMs: 0 } }));

    const performance = {
      plays7d:    perf._count.id ?? 0,
      watchMs7d:  perf._sum.durationMs ?? 0,
      uptimePct:  device.uptimePctD30 ?? null,
    };

    const now       = new Date();
    const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    const schedules = await db.schedule.findMany({
      where: {
        startAt: { lte: windowEnd },
        endAt:   { gte: now },
        OR: [
          { deviceIds: { has: device.id } },
          ...(device.groupName ? [{ groupName: device.groupName }] : []),
        ],
      },
      select: {
        id: true, name: true, playlistId: true, priority: true,
        deviceIds: true, groupName: true, startAt: true, endAt: true, recurrence: true,
        playlist: {
          select: {
            name: true,
            items: {
              select: {
                durationMs: true,
                order:      true,
                content: { select: { id: true, name: true, objectKey: true, md5: true, type: true, durationMs: true } },
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { startAt: 'asc' }],
    });

    // Find all schedules ever, to give diagnostic context
    const allSchedules = await db.schedule.findMany({
      where: { endAt: { gte: now } },
      select: {
        id: true, name: true, deviceIds: true, groupName: true,
        startAt: true, endAt: true,
      },
      orderBy: { startAt: 'asc' },
      take: 20,
    });

    // Pick current active schedule
    const nowMs = now.getTime();
    const activeSchedule = schedules.find(
      (s) => s.startAt.getTime() <= nowMs && s.endAt.getTime() > nowMs,
    ) ?? schedules[0];

    // Nested-playlist items (content null) are omitted from this diagnostic preview —
    // the real plan route flattens them via resolvePlaylistTree; here only the direct
    // media items are listed.
    const items = activeSchedule?.playlist.items
      .filter((item): item is typeof item & { content: NonNullable<typeof item.content> } => item.content != null)
      .map((item) => ({
        contentId:  item.content.id,
        name:       item.content.name,
        objectKey:  item.content.objectKey,
        url:        publicUrl(item.content.objectKey),
        md5:        item.content.md5,
        type:       item.content.type,
        durationMs: item.durationMs,
        order:      item.order,
      })) ?? [];

    const planHash = crypto
      .createHash('md5')
      .update(JSON.stringify({ items }))
      .digest('hex');

    // ── Slot-mode context ────────────────────────────────────────────────────
    // A slot-mode store plays its fixed ad loop, not schedules. Without this the
    // checklist would cry "no matching schedule" at healthy slot screens — and say
    // nothing when a slot day resolves to zero playable items, the one failure mode
    // that blanks a screen all day (schedules are only the fallback then).
    const slotMode = device.store?.loopSlotCount != null;
    let slotOpenToday = true;
    let slotSold      = 0;
    let slotPlayable  = 0;      // loop positions that play today
    let slotHasFiller = false;
    if (slotMode && device.storeId) {
      const store = device.store!;
      const today = istToday(now);
      slotOpenToday = isOpenOn(store.openDays, today);
      const filler  = await resolveFillerCampaign(store.fillerCampaignId);
      slotHasFiller = filler != null;
      if (slotOpenToday) {
        const bookings = await db.slotBooking.findMany({
          where:  { storeId: device.storeId, date: new Date(`${today}T00:00:00Z`) },
          select: { slotPosition: true, campaignId: true, campaign: { select: { slotContentId: true } } },
        });
        slotSold = bookings.length;
        slotPlayable = buildSlotLoop(
          store.loopSlotCount!,
          bookings.map((b) => ({ slotPosition: b.slotPosition, campaignId: b.campaignId, slotContentId: b.campaign.slotContentId })),
          filler,
        ).length;
      }
    }

    // ── Diagnostics ──────────────────────────────────────────────────────────
    type DiagIssue = { level: 'ok' | 'warn' | 'error'; message: string };
    const issues: DiagIssue[] = [];

    if (slotMode) {
      const n = device.store!.loopSlotCount;
      if (!slotOpenToday) {
        issues.push({ level: 'warn', message: `Slot mode (${n} slots): store is closed today per its open-days setting — the screen falls back to the schedules below.` });
      } else if (slotPlayable > 0) {
        issues.push({ level: 'ok', message: `Slot mode: ${slotPlayable}/${n} loop positions play today (${slotSold} sold). Schedules below only apply if a day's loop is empty.` });
      } else {
        issues.push({ level: 'error', message: `Slot mode with nothing playable today — ${slotSold} booking(s), none with a usable 10s creative, and no filler campaign. The screen falls back to the schedules below; assign a filler campaign in the Slots tab.` });
      }
      if (slotOpenToday && !slotHasFiller) {
        issues.push({ level: slotPlayable > 0 ? 'warn' : 'error', message: 'No playable filler campaign (store or global default) — zero-booking days depend entirely on schedules.' });
      }
    }

    if (!device.lastSeen) {
      issues.push({ level: 'error', message: 'Device has never polled the plan API — it has not called GET /api/device/plan yet.' });
    } else {
      const minsAgo = Math.floor((now.getTime() - new Date(device.lastSeen).getTime()) / 60000);
      if (minsAgo > 10) {
        issues.push({ level: 'warn', message: `Last heartbeat was ${minsAgo} minutes ago. Device may be offline or not polling.` });
      } else {
        issues.push({ level: 'ok', message: `Device polled ${minsAgo} minute(s) ago — connection looks healthy.` });
      }
    }

    // Power-cut vs app-exit, after the fact. Plays and heartbeats stop together in both
    // cases, so the only way to tell them apart used to be a site visit. A recent boot
    // means the device lost power (or was restarted); a long uptime across a known
    // outage means it stayed powered and something else broke — the app exited, or the
    // network dropped.
    if (telemetry?.uptimeMs != null) {
      const upMins  = Math.floor(telemetry.uptimeMs / 60000);
      const upHours = Math.floor(upMins / 60);
      const upDays  = Math.floor(upHours / 24);
      const pretty  = upDays > 0 ? `${upDays}d ${upHours % 24}h`
                    : upHours > 0 ? `${upHours}h ${upMins % 60}m`
                    : `${upMins}m`;
      if (upMins < 15) {
        issues.push({ level: 'warn', message: `Device booted ${pretty} ago — it lost power or was restarted recently. A screen that went dark without a reboot points at the app or the network instead.` });
      } else {
        issues.push({ level: 'ok', message: `Powered on for ${pretty} (booted ${new Date(telemetry.bootedAt!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST) — no reboot in that window, so any outage inside it was not a power cut.` });
      }
    }

    if (schedules.length === 0) {
      // For a slot screen whose loop plays today, no schedules is normal — but it
      // still means a zero-booking day with no filler would go dark, so keep it
      // visible as a warning rather than dropping it entirely.
      const schedGapLevel = slotMode && slotPlayable > 0 ? 'warn' as const : 'error' as const;
      issues.push({
        level: schedGapLevel,
        message: slotMode
          ? 'No matching schedule found — nothing to fall back to if a slot day has nothing playable.'
          : 'No matching schedule found for this device.',
      });
      const groupMatches = allSchedules.filter((s) => s.groupName && device.groupName && s.groupName === device.groupName);
      const deviceMatches = allSchedules.filter((s) => (s.deviceIds as string[]).includes(device.id));
      if (groupMatches.length === 0 && deviceMatches.length === 0) {
        issues.push({
          level: schedGapLevel,
          message: device.groupName
            ? `Device group "${device.groupName}" does not match any active schedule. Assign this device's group to a schedule, or add this device ID directly.`
            : 'Device has no group name set. Either set a groupName on this device (rename → group field) or add this deviceId to a schedule directly.',
        });
      }
      if (allSchedules.length > 0) {
        const futureMatch = allSchedules.find(
          (s) => s.startAt.getTime() > nowMs &&
            ((s.deviceIds as string[]).includes(device.id) || (device.groupName && s.groupName === device.groupName)),
        );
        if (futureMatch) {
          issues.push({ level: 'warn', message: `A matching schedule starts at ${futureMatch.startAt.toISOString()} — content will play from then.` });
        }
      }
    } else if (!activeSchedule) {
      issues.push({ level: 'warn', message: 'Schedules exist but none is currently active (check start/end times).' });
    } else {
      issues.push({ level: 'ok', message: `Active schedule: "${activeSchedule.name}" — ${items.length} content item(s).` });
    }

    if (items.length === 0 && activeSchedule) {
      issues.push({ level: 'error', message: 'Active schedule found but playlist has 0 items. Add content to the playlist.' });
    }

    if (device.status === 'PENDING' && !device.lastSeen) {
      issues.push({ level: 'warn', message: 'Device is still PENDING — it has never connected. Install the ALIVE Player APK and boot the device to auto-register.' });
    }

    return NextResponse.json({
      device: {
        id:        device.id,
        name:      device.name,
        hardwareKey: device.hardwareKey,
        groupName: device.groupName,
        status:    device.status,
        lastSeen:  device.lastSeen?.toISOString() ?? null,
        storeName: device.store?.storeName ?? null,
        city:      device.store?.city ?? null,
      },
      telemetry,
      performance,
      plan: {
        planHash,
        scheduleId:  activeSchedule?.id ?? null,
        scheduleName: activeSchedule?.name ?? null,
        playlistName: activeSchedule?.playlist?.name ?? null,
        items,
        scheduleCount: schedules.length,
        validUntil:  windowEnd.toISOString(),
      },
      diagnostics: { issues },
      curl: `curl "${process.env.NEXT_PUBLIC_APP_URL ?? 'https://wearealive.in'}/api/device/plan" -H "Authorization: Bearer <device-token>"`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
