// Screen liveness check — "is this screen actually working?"
//
// POST   /api/devices/[id]/test-play  → start a test: high-priority short takeover
//                                       schedule of the configured test playlist
// GET    /api/devices/[id]/test-play  → has the device reported playing it yet?
// Auth: admin-password header
//
// Why not just look at Device.status: a screen that is frozen, showing a black
// frame, or stuck mid-download still heartbeats and still reports ONLINE. The only
// evidence that a screen is genuinely alive is a proof-of-play row arriving for
// content we just asked it to show, which is what this verifies.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushPlanUpdated } from '@/lib/fcm';

const TEST_DURATION_MINS = 3;

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

/** Playlist used for tests: the admin-configured one, else the smallest playlist
 *  that has content (a short clip makes for the fastest confirmation). */
async function resolveTestPlaylistId(): Promise<string | null> {
  const cfg = await db.playerConfig.findUnique({ where: { id: 1 }, select: { testPlaylistId: true } });
  if (cfg?.testPlaylistId) {
    const exists = await db.playlist.findUnique({ where: { id: cfg.testPlaylistId }, select: { id: true } });
    if (exists) return exists.id;
  }
  const fallback = await db.playlist.findFirst({
    where:   { items: { some: {} } },
    orderBy: { createdAt: 'desc' },
    select:  { id: true },
  });
  return fallback?.id ?? null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const device = await db.device.findUnique({ where: { id }, select: { id: true } });
    if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });

    const playlistId = await resolveTestPlaylistId();
    if (!playlistId) {
      return NextResponse.json(
        { error: 'No playlist with content available to test with. Create one in Playlists first.' },
        { status: 400 },
      );
    }

    const startedAt = new Date();
    const schedule  = await db.schedule.create({
      data: {
        name:        `Screen test ${startedAt.toLocaleString('en-IN')}`,
        playlistId,
        deviceIds:   [device.id],
        priority:    9, // top priority so it overrides whatever is currently scheduled
        startAt:     startedAt,
        endAt:       new Date(startedAt.getTime() + TEST_DURATION_MINS * 60 * 1000),
        recurrence:  'ONCE',
        orientation: 'portrait',
      },
      select: { id: true, endAt: true },
    });

    // Nudge the device to re-fetch now rather than waiting for its next poll, so the
    // test resolves in seconds. Best-effort: without FCM it still works, just slower.
    await pushPlanUpdated([device.id]).catch(() => {});

    return NextResponse.json({
      scheduleId: schedule.id,
      playlistId,
      startedAt:  startedAt.toISOString(),
      expiresAt:  schedule.endAt.toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const since = req.nextUrl.searchParams.get('since');
  if (!since) return NextResponse.json({ error: 'since required' }, { status: 400 });

  try {
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: 'since must be an ISO timestamp' }, { status: 400 });
    }

    // Any play event started after the test began proves the screen is rendering.
    const play = await db.playEvent.findFirst({
      where:   { deviceId: id, startedAt: { gte: sinceDate } },
      orderBy: { startedAt: 'desc' },
      select:  { startedAt: true, durationMs: true },
    });

    const device = await db.device.findUnique({
      where:  { id },
      select: { lastSeen: true, playbackAliveAt: true, lastStallReason: true, lastStallAt: true },
    });

    return NextResponse.json({
      confirmed:       play != null,
      playedAt:        play?.startedAt?.toISOString() ?? null,
      durationMs:      play?.durationMs ?? null,
      lastSeen:        device?.lastSeen?.toISOString() ?? null,
      playbackAliveAt: device?.playbackAliveAt?.toISOString() ?? null,
      lastStallReason: device?.lastStallReason ?? null,
      lastStallAt:     device?.lastStallAt?.toISOString() ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
