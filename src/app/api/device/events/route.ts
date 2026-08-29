// Device play-event ingest — player POSTs proof-of-play rows in batches.
// Idempotent by id: duplicate submissions are silently ignored.
// Each row gets a SHA-256 rowHash and prevHash for tamper-evident chain (Xibo T2 pattern).
//
// POST /api/device/events
// Auth: Authorization: Bearer <device-jwt>
// Body: { events: PlayEventInput[] }
// Returns: { accepted: number }

import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { verifyDeviceToken, isDevicePaired } from '@/lib/device-auth';
import crypto from 'crypto';
import { getOrCreateCorrelationId, hashStack, recordError } from '@/lib/telemetry';
import { respond } from '@/lib/api-envelope';
import { resolveOfflineAlerts, backfillMissedOutage } from '@/lib/device-alerts';

type PlayEventInput = {
  id:          string;   // client-generated UUID for dedup
  mediaId:     string;   // Content.id
  scheduleId?: string;
  campaignId?: string;
  tag?:        string;
  startedAt:   string;   // ISO
  endedAt:     string;   // ISO
  durationMs:  number;
  // Slot-loop attribution, echoed from the plan's slot items (slot-mode stores only):
  // which loop position played and whether it was a bonus/filler play.
  slotPosition?: number;
  isFiller?:     boolean;
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
  // Outage forensics — see Device.bootedAt. Time since boot (SystemClock.elapsedRealtime,
  // deep sleep included), converted to a boot instant on arrival.
  uptimeMs?:        number;
  // Time since the player PROCESS started, same clock as uptimeMs — see Device.appStartedAt.
  appUptimeMs?:     number;
};

// Player-side incident records (crash stacks, decoder stalls, watchdog fallbacks),
// batched up from the device's local Room table with each heartbeat. Stored as
// TelemetryEvent rows (route 'player/incident') so they surface in the existing admin
// telemetry viewer with no extra UI.
type IncidentInput = {
  type?:     string;  // UNCAUGHT_EXCEPTION | STUCK_PLAYBACK | FALLBACK_TRIGGERED
  atMs?:     number;
  metadata?: string;
};

const clampStr = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

async function storeIncidents(deviceId: string, correlationId: string, incidents: unknown): Promise<number> {
  if (!Array.isArray(incidents) || incidents.length === 0) return 0;
  let stored = 0;
  for (const raw of (incidents as IncidentInput[]).slice(0, 50)) {
    const type = clampStr(raw?.type, 60);
    if (!type) continue;
    const atMs = typeof raw?.atMs === 'number' && raw.atMs > 0 ? raw.atMs : null;
    try {
      await recordError({
        route:       'player/incident',
        errorClass:  type,
        message:     clampStr(raw?.metadata, 4000) ?? type,
        stackHash:   type === 'UNCAUGHT_EXCEPTION' ? hashStack(clampStr(raw?.metadata, 4000)) : undefined,
        actorType:   'device',
        deviceId,
        correlationId,
        requestMeta: atMs ? { occurredAt: new Date(atMs).toISOString() } : undefined,
      });
      stored++;
    } catch { /* one bad incident must not fail the heartbeat */ }
  }
  return stored;
}

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Maps a telemetry payload onto Device columns. Shared by the telemetry-only and
 *  events+telemetry paths so the two can't drift. */
function telemetryToDeviceData(t: TelemetryInput) {
  const aliveAt = typeof t.playbackAliveMs === 'number' && t.playbackAliveMs > 0
    ? new Date(t.playbackAliveMs) : null;
  const stallAt = typeof t.lastStallMs === 'number' && t.lastStallMs > 0
    ? new Date(t.lastStallMs) : null;
  // uptimeMs is time-since-boot on the device; store the derived boot instant instead,
  // because an uptime is stale the moment it is written while a boot instant stays true.
  // Recomputed on every heartbeat, so it drifts by network latency — treat only a shift
  // of minutes as a genuine reboot, not a few seconds. Bounded to a sane range so a
  // garbage reading can't write an absurd timestamp.
  const bootedAt = typeof t.uptimeMs === 'number'
    && Number.isFinite(t.uptimeMs)
    && t.uptimeMs >= 0
    && t.uptimeMs < TEN_YEARS_MS
    ? new Date(Date.now() - t.uptimeMs) : null;
  // Same treatment for the process start. A process cannot predate its own device, so
  // an appUptime longer than the device uptime is a bad reading and is dropped rather
  // than stored — it would otherwise read as "the app never restarted" forever.
  const appStartedAt = typeof t.appUptimeMs === 'number'
    && Number.isFinite(t.appUptimeMs)
    && t.appUptimeMs >= 0
    && t.appUptimeMs < TEN_YEARS_MS
    && (typeof t.uptimeMs !== 'number' || t.appUptimeMs <= t.uptimeMs + 60_000)
    ? new Date(Date.now() - t.appUptimeMs) : null;
  return {
    ...(typeof t.cpuTempC      === 'number' ? { cpuTempC: t.cpuTempC, cpuTempUpdatedAt: new Date() } : {}),
    ...(typeof t.freeStorageMb === 'number' ? { freeStorageMb: t.freeStorageMb } : {}),
    ...(t.androidVersion  ? { androidVersion:  t.androidVersion  } : {}),
    ...(t.appVersion      ? { appVersion:      t.appVersion      } : {}),
    ...(aliveAt           ? { playbackAliveAt: aliveAt           } : {}),
    ...(t.lastStallReason ? { lastStallReason: t.lastStallReason } : {}),
    ...(stallAt           ? { lastStallAt:     stallAt           } : {}),
    ...(bootedAt          ? { bootedAt:        bootedAt          } : {}),
    ...(appStartedAt      ? { appStartedAt:    appStartedAt      } : {}),
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
    // Well-formed token, no device row → the screen was deleted in the admin panel.
    // See /api/device/plan: the caller answers 410 so the player decommissions
    // instead of re-claiming and resurrecting the deleted screen.
    if (!device) return 'gone' as const;
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
  if (device === 'gone') {
    const envelope = await respond({ error: 'Device deleted' }, { route, request: { correlationId }, outcome: 'unauthorized', policyFlags: ['device_deleted'], errorCategory: 'auth' });
    return NextResponse.json(envelope, { status: 410 });
  }
  if (!device) {
    const envelope = await respond({ error: 'Unauthorized' }, { route, request: { correlationId }, outcome: 'unauthorized', policyFlags: ['auth_failed'], errorCategory: 'auth' });
    return NextResponse.json(envelope, { status: 401 });
  }

  try {
    const body = await req.json() as { events: PlayEventInput[]; telemetry?: TelemetryInput; incidents?: IncidentInput[] };
    const { events, telemetry } = body;
    // Incidents ride along on any heartbeat/event batch; store before branching so the
    // telemetry-only path gets them too. Best-effort — never fails the request.
    await storeIncidents(device.id, correlationId, body.incidents).catch(() => 0);
    // `device` is the row as it was BEFORE this request's heartbeat write, so
    // this captures the recovery edge. Only resolve on paths that actually set
    // status ONLINE — resolving without the flip would leave the alert closed
    // while the device still reads OFFLINE, and the next sweep would re-open it.
    const wasOffline = device.status === 'OFFLINE';
    // Same pre-write row, so this is the last heartbeat before the update below —
    // the far edge of any gap the health sweep slept through (backfillMissedOutage).
    const previousLastSeen = device.lastSeen;
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
        // after(), not a bare void — see the note in /api/device/plan: this is the
        // only writer of RESOLVED, and a promise dropped at response-flush would
        // strand the alert OPEN and silence the device for good.
        // Backfill runs even after a resolve, not as its else-branch — see the note
        // on backfillMissedOutage: it also covers a sweep that flipped the status
        // but never wrote a row, and it no-ops when the gap is already recorded.
        after(async () => {
          if (wasOffline) await resolveOfflineAlerts(device.id);
          await backfillMissedOutage(device, previousLastSeen);
        });
        const envelope = await respond({ accepted: 0, telemetry: true }, { route, request: { correlationId, eventsCount: 0 }, outcome: 'success', policyFlags: ['telemetry_only'], startedAtMs });
        return NextResponse.json(envelope);
      }
      const envelope = await respond({ accepted: 0 }, { route, request: { correlationId, eventsCount: 0 }, outcome: 'invalid_request', policyFlags: ['empty_batch'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope);
    }

    // Proof-of-play is billable evidence, so an unpaired device must not be able
    // to write it. The heartbeat/telemetry path above deliberately still runs for
    // unpaired devices — an operator needs to see a screen is alive in order to
    // confirm its pairing code — but the ledger stays closed until it is.
    if (!isDevicePaired(device)) {
      const envelope = await respond({ accepted: 0, error: 'Device not paired' }, { route, request: { correlationId, eventsCount: events.length }, outcome: 'unauthorized', policyFlags: ['device_unpaired'], errorCategory: 'auth', startedAtMs });
      return NextResponse.json(envelope, { status: 403 });
    }

    // Cap batch size to prevent abuse
    const batch = events.slice(0, 500);

    // Reject physically impossible timings before they reach the ledger. The
    // client supplies these, so without bounds a device could book a single
    // "play" lasting a year, or backdate/forward-date plays to land in whichever
    // billing period suited it. Small skew is tolerated — screens run their own
    // clocks and NTP repair is best-effort.
    const nowMs = Date.now();
    const MAX_DURATION_MS = 6 * 60 * 60 * 1000;   // 6 h — far above any real item
    const MAX_FUTURE_MS   = 60 * 60 * 1000;       // 1 h of forward clock skew
    const MAX_AGE_MS      = 30 * 24 * 60 * 60 * 1000; // 30 d of offline backlog
    const plausible = (ev: PlayEventInput): boolean => {
      const s = new Date(ev.startedAt).getTime();
      const e = new Date(ev.endedAt).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
      if (s > nowMs + MAX_FUTURE_MS) return false;
      if (s < nowMs - MAX_AGE_MS) return false;
      if (e < s) return false;
      const d = Number(ev.durationMs);
      return Number.isFinite(d) && d >= 0 && d <= MAX_DURATION_MS;
    };

    // Campaign attribution decides who gets invoiced, so it cannot be taken on
    // the device's word. A play may only be credited to a campaign that actually
    // holds a slot booking at this device's store (or is the store's house
    // filler). Anything else still gets recorded as a play — the screen did show
    // something — but with no campaign attached, so a compromised or modified
    // player cannot inflate an advertiser's bill or forge another brand's
    // proof-of-play.
    const claimedCampaignIds = [...new Set(
      batch.map((e) => e.campaignId).filter((c): c is string => typeof c === 'string' && !!c),
    )];
    let attributable = new Set<string>();
    if (claimedCampaignIds.length && device.storeId) {
      const [booked, store] = await Promise.all([
        db.slotBooking.findMany({
          where:  { storeId: device.storeId, campaignId: { in: claimedCampaignIds } },
          select: { campaignId: true },
          distinct: ['campaignId'],
        }).catch(() => []),
        db.store.findUnique({
          where: { id: device.storeId }, select: { fillerCampaignId: true },
        }).catch(() => null),
      ]);
      attributable = new Set(booked.map((b) => b.campaignId));
      if (store?.fillerCampaignId) attributable.add(store.fillerCampaignId);
    }

    // Fetch the last event for this device to chain hashes
    const lastEvent = await db.playEvent.findFirst({
      where:   { deviceId: device.id },
      orderBy: { startedAt: 'desc' },
      select:  { rowHash: true },
    });

    let chainHash: string | null = lastEvent?.rowHash ?? null;
    let accepted = 0;
    let duplicates = 0;

    // Re-sent batches are NORMAL, not exceptional: the player keeps proof-of-play in a
    // local queue and only deletes a row after it sees a 200, so any 200 lost to a
    // dropped connection — exactly what happens on the flaky links these screens sit on —
    // makes it send the same events again. The PlayEvent upsert below already absorbs
    // that (update: {} is a no-op on a duplicate id), but HourlyPop does not: its
    // increments would fire a second time and silently inflate playCount, totalMs and
    // campaignIds — the numbers advertisers are billed from.
    //
    // So find the ids we already hold, in ONE query per batch, and skip them entirely.
    // Skipping is safe for the hash chain too: an event that is already stored was
    // chained when it was first accepted, and re-chaining it here would rewrite history.
    //
    // Scoped to this device: PlayEvent.id is client-supplied, so a global lookup
    // answers "does any device hold this id?" — an existence oracle across the
    // whole fleet, and a way for one device to have another's ids silently
    // treated as already-stored.
    const batchIds = batch.map((e) => e.id).filter((id): id is string => !!id);
    const alreadyStored = new Set(
      batchIds.length
        ? (await db.playEvent.findMany({
            where:  { id: { in: batchIds }, deviceId: device.id },
            select: { id: true },
          }).catch(() => [])).map((r) => r.id)
        : [],
    );

    for (const ev of batch) {
      if (!ev.id || !ev.mediaId || !ev.startedAt || !ev.endedAt) continue;
      if (alreadyStored.has(ev.id)) { duplicates++; continue; }
      if (!plausible(ev)) continue;
      // Drop an attribution this device is not entitled to make; keep the play.
      const attributedCampaignId =
        ev.campaignId && attributable.has(ev.campaignId) ? ev.campaignId : null;
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
            campaignId: attributedCampaignId,
            tag:        ev.tag        ?? null,
            startedAt:  new Date(ev.startedAt),
            endedAt:    new Date(ev.endedAt),
            durationMs: ev.durationMs,
            slotPosition: typeof ev.slotPosition === 'number' ? ev.slotPosition : null,
            isFiller:     ev.isFiller === true,
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
            campaignIds: attributedCampaignId ? [attributedCampaignId] : [],
          },
          update: {
            playCount: { increment: 1 },
            totalMs:   { increment: created.durationMs },
            ...(attributedCampaignId ? { campaignIds: { push: attributedCampaignId } } : {}),
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
    // after(), not a bare void — see the note in /api/device/plan: this is the
    // only writer of RESOLVED, and a promise dropped at response-flush would
    // strand the alert OPEN and silence the device for good.
    // Backfill runs even after a resolve, not as its else-branch — see the note
    // on backfillMissedOutage: it also covers a sweep that flipped the status but
    // never wrote a row, and it no-ops when the gap is already recorded.
    after(async () => {
      if (wasOffline) await resolveOfflineAlerts(device.id);
      await backfillMissedOutage(device, previousLastSeen);
    });

    // `duplicates` is reported so a re-sent backlog is visible rather than silent — a
    // device stuck re-sending the same events (a queue that never drains) otherwise
    // looks identical to a healthy one, since both return 200.
    const envelope = await respond(
      { accepted, ...(duplicates ? { duplicates } : {}) },
      { route, request: { correlationId, eventsCount: batch.length }, outcome: 'success', policyFlags: duplicates ? ['had_duplicates'] : [], startedAtMs },
    );
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
