// Device play-event ingest — player POSTs proof-of-play rows in batches.
// Idempotent by id: duplicate submissions are silently ignored.
// Each row gets a SHA-256 rowHash and prevHash for tamper-evident chain (Xibo T2 pattern).
//
// POST /api/device/events
// Auth: Authorization: Bearer <device-jwt>
// Body: { events: PlayEventInput[] }
// Returns: { accepted: number }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyDeviceToken } from '@/lib/device-auth';
import crypto from 'crypto';
import { getOrCreateCorrelationId, hashStack, recordError } from '@/lib/telemetry';
import { respond } from '@/lib/api-envelope';

type PlayEventInput = {
  id:          string;   // client-generated UUID for dedup
  mediaId:     string;   // Content.id
  scheduleId?: string;
  campaignId?: string;
  tag?:        string;
  startedAt:   string;   // ISO
  endedAt:     string;   // ISO
  durationMs:  number;
};

type TelemetryInput = {
  cpuTempC?:        number;
  freeStorageMb?:   number;
  androidVersion?:  string;
  appVersion?:      string;
  // Freeze diagnostics — see Device.playbackAliveAt
  playbackAliveMs?: number;  // epoch ms of last playback advance
  lastStallReason?: string;
  lastStallMs?:     number;  // epoch ms of last detected decoder stall
};

/** Maps a telemetry payload onto Device columns. Shared by the telemetry-only and
 *  events+telemetry paths so the two can't drift. */
function telemetryToDeviceData(t: TelemetryInput) {
  const aliveAt = typeof t.playbackAliveMs === 'number' && t.playbackAliveMs > 0
    ? new Date(t.playbackAliveMs) : null;
  const stallAt = typeof t.lastStallMs === 'number' && t.lastStallMs > 0
    ? new Date(t.lastStallMs) : null;
  return {
    ...(typeof t.cpuTempC      === 'number' ? { cpuTempC: t.cpuTempC, cpuTempUpdatedAt: new Date() } : {}),
    ...(typeof t.freeStorageMb === 'number' ? { freeStorageMb: t.freeStorageMb } : {}),
    ...(t.androidVersion  ? { androidVersion:  t.androidVersion  } : {}),
    ...(t.appVersion      ? { appVersion:      t.appVersion      } : {}),
    ...(aliveAt           ? { playbackAliveAt: aliveAt           } : {}),
    ...(t.lastStallReason ? { lastStallReason: t.lastStallReason } : {}),
    ...(stallAt           ? { lastStallAt:     stallAt           } : {}),
  };
}

async function authenticate(req: NextRequest) {
  const auth  = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload  = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const deviceId = payload?.sub as string | undefined;
    if (!deviceId) return null;
    const device = await db.device.findUnique({ where: { id: deviceId } });
    if (!device) return null;
    const result = await verifyDeviceToken(token, device.jwtSecret);
    if (!result) return null;
    return device;
  } catch {
    return null;
  }
}

function computeRowHash(id: string, deviceId: string, mediaId: string, startedAt: string, endedAt: string, durationMs: number, tag: string | null, prevHash: string | null): string {
  const data = [id, deviceId, mediaId, startedAt, endedAt, String(durationMs), tag ?? '', prevHash ?? ''].join('|');
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function POST(req: NextRequest) {
  const startedAtMs = Date.now();
  const correlationId = getOrCreateCorrelationId(req.headers.get('x-correlation-id'));
  const route = '/api/device/events';
  const device = await authenticate(req);
  if (!device) {
    const envelope = await respond({ error: 'Unauthorized' }, { route, request: { correlationId }, outcome: 'unauthorized', policyFlags: ['auth_failed'], errorCategory: 'auth' });
    return NextResponse.json(envelope, { status: 401 });
  }

  try {
    const body = await req.json() as { events: PlayEventInput[]; telemetry?: TelemetryInput };
    const { events, telemetry } = body;
    if (!Array.isArray(events) || events.length === 0) {
      // Allow empty event batches if telemetry-only heartbeat
      if (telemetry) {
        await db.device.update({
          where: { id: device.id },
          data:  {
            lastSeen: new Date(), status: 'ONLINE',
            ...telemetryToDeviceData(telemetry),
          },
        }).catch(() => { /* telemetry columns may not exist yet */ });
        const envelope = await respond({ accepted: 0, telemetry: true }, { route, request: { correlationId, eventsCount: 0 }, outcome: 'success', policyFlags: ['telemetry_only'], startedAtMs });
        return NextResponse.json(envelope);
      }
      const envelope = await respond({ accepted: 0 }, { route, request: { correlationId, eventsCount: 0 }, outcome: 'invalid_request', policyFlags: ['empty_batch'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope);
    }

    // Cap batch size to prevent abuse
    const batch = events.slice(0, 500);

    // Fetch the last event for this device to chain hashes
    const lastEvent = await db.playEvent.findFirst({
      where:   { deviceId: device.id },
      orderBy: { startedAt: 'desc' },
      select:  { rowHash: true },
    });

    let chainHash: string | null = lastEvent?.rowHash ?? null;
    let accepted = 0;

    for (const ev of batch) {
      if (!ev.id || !ev.mediaId || !ev.startedAt || !ev.endedAt) continue;
      try {
        const rowHash = computeRowHash(
          ev.id, device.id, ev.mediaId,
          ev.startedAt, ev.endedAt, ev.durationMs,
          ev.tag ?? null, chainHash,
        );

        const created = await db.playEvent.upsert({
          where:  { id: ev.id },
          update: {}, // already accepted — no-op
          create: {
            id:         ev.id,
            deviceId:   device.id,
            mediaId:    ev.mediaId,
            layoutId:   ev.scheduleId ?? null,
            campaignId: ev.campaignId ?? null,
            tag:        ev.tag        ?? null,
            startedAt:  new Date(ev.startedAt),
            endedAt:    new Date(ev.endedAt),
            durationMs: ev.durationMs,
            prevHash:   chainHash,
            rowHash,
          },
          select: { id: true, startedAt: true, durationMs: true, campaignId: true },
        });

        // Upsert hourly POP aggregation bucket
        const hour = new Date(created.startedAt);
        hour.setUTCMinutes(0, 0, 0);
        await db.hourlyPop.upsert({
          where:  { deviceId_hour: { deviceId: device.id, hour } },
          create: {
            deviceId:    device.id,
            hour,
            playCount:   1,
            totalMs:     created.durationMs,
            campaignIds: ev.campaignId ? [ev.campaignId] : [],
          },
          update: {
            playCount: { increment: 1 },
            totalMs:   { increment: created.durationMs },
            ...(ev.campaignId ? { campaignIds: { push: ev.campaignId } } : {}),
            updatedAt: new Date(),
          },
        });

        chainHash = rowHash;
        accepted++;
      } catch {
        // Skip malformed rows; don't fail the whole batch
      }
    }

    // Update device heartbeat + optional telemetry
    await db.device.update({
      where: { id: device.id },
      data:  {
        lastSeen: new Date(), status: 'ONLINE',
        ...(telemetry ? telemetryToDeviceData(telemetry) : {}),
      },
    }).catch(() => { /* telemetry columns may not exist yet */ });

    const envelope = await respond({ accepted }, { route, request: { correlationId, eventsCount: batch.length }, outcome: 'success', policyFlags: [], startedAtMs });
    return NextResponse.json(envelope);
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
    const envelope = await respond({ error: error.message, correlationId }, { route, request: { correlationId }, outcome: 'server_error', policyFlags: ['exception'], errorCategory: 'runtime', startedAtMs });
    return NextResponse.json(envelope, { status: 500 });
  }
}
