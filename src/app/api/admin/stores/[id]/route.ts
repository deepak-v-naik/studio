import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Redis } from '@upstash/redis';
import { pushDecommission } from '@/lib/fcm';
import { deleteObject, publicUrl } from '@/lib/r2';

/** R2 object key for a stored verification-photo URL, or null if it isn't one. */
function verificationKeyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const prefix = publicUrl('');
  if (!prefix || !url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return key.startsWith('verification/') ? key : null;
}

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await req.json() as {
      liveAt?: string | null;
      onboardingStage?: string;
      payoutStatus?: string;
      payoutNotes?: string;
      // Installation & hardware (see the Store model) — ops fills these at the site visit.
      tvBrand?: string | null;
      tvSizeInches?: number | string | null;
      tvTag?: string | null;
      tvInstalledAt?: string | null;
      espSwitchName?: string | null;
      wifiSsid?: string | null;
      wifiPassword?: string | null;
      installNotes?: string | null;
    };

    // ── GPS-photo gates on stage advancement ─────────────────────────────────
    // The onboarding pipeline requires field evidence before milestones pass:
    // a GPS-tagged shop-front photo to cross INTO 'contacted' (Team
    // verification), and a GPS-tagged installed-TV photo to cross INTO
    // 'physically_onboarded' or beyond (Site visit & install). Gates fire only
    // on FORWARD crossings of those milestones — re-saving the current stage
    // (the admin Save button always sends it), demoting, 'rejected', and
    // stores already past a milestone (the pre-feature fleet) are unaffected.
    const STAGE_RANK: Record<string, number> = {
      new: 0, contacted: 1, physically_onboarded: 2, digitally_onboarded: 3, live: 4,
    };
    const targetRank = body.onboardingStage ? STAGE_RANK[body.onboardingStage] : undefined;
    if (targetRank !== undefined && targetRank >= 1) {
      try {
        const rows = await db.$queryRaw<{ onboardingStage: string | null; shopPhotoUrl: string | null; installPhotoUrl: string | null }[]>`
          SELECT "onboardingStage", "shopPhotoUrl", "installPhotoUrl" FROM "Store" WHERE "id" = ${id} LIMIT 1
        `;
        const p = rows[0];
        const currentRank = p ? (STAGE_RANK[p.onboardingStage ?? 'new'] ?? 0) : 0;
        if (p && currentRank < 1 && targetRank >= 1 && !p.shopPhotoUrl) {
          return NextResponse.json(
            { error: 'Cannot advance stage: the partner has not uploaded the GPS shop-front photo yet (required for Team verification).' },
            { status: 409 },
          );
        }
        if (p && currentRank < 2 && targetRank >= 2 && !p.installPhotoUrl) {
          return NextResponse.json(
            { error: 'Cannot advance stage: the GPS photo of the installed TV has not been uploaded yet (required for Site visit & install).' },
            { status: 409 },
          );
        }
      } catch (e) {
        // Fail open ONLY for the not-yet-migrated-columns case; any other DB
        // error must not silently disable the gate — rethrow so the save fails
        // loudly instead of advancing ungated.
        const msg = (e as Error).message ?? '';
        if (!/column .* does not exist|42703/i.test(msg)) throw e;
        console.error('photo-gate: columns missing, failing open:', msg.slice(0, 200));
      }
    }

    // Build only the columns we're allowed to update
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if ('liveAt' in body) {
      setClauses.push(`"liveAt" = $${values.length + 1}`);
      values.push(body.liveAt ? new Date(body.liveAt) : null);
    }
    if (body.onboardingStage) {
      setClauses.push(`"onboardingStage" = $${values.length + 1}`);
      values.push(body.onboardingStage);
    }
    if (body.payoutStatus) {
      setClauses.push(`"payoutStatus" = $${values.length + 1}`);
      values.push(body.payoutStatus);
    }
    if ('payoutNotes' in body) {
      setClauses.push(`"payoutNotes" = $${values.length + 1}`);
      values.push(body.payoutNotes ?? null);
    }

    // ── Installation & hardware ──────────────────────────────────────────────
    // Column names come from this fixed map, never from the request, so the raw
    // UPDATE stays injection-safe. Blank strings are stored as NULL so clearing
    // a field in the panel actually clears it.
    const TEXT_COLS = ['tvBrand', 'tvTag', 'espSwitchName', 'wifiSsid', 'wifiPassword', 'installNotes'] as const;
    for (const col of TEXT_COLS) {
      if (col in body) {
        const raw = body[col];
        setClauses.push(`"${col}" = $${values.length + 1}`);
        values.push(typeof raw === 'string' && raw.trim() ? raw.trim() : null);
      }
    }
    if ('tvSizeInches' in body) {
      const n = Number(body.tvSizeInches);
      // Reject nonsense sizes rather than storing them; blank clears the field.
      const size = Number.isFinite(n) && n > 0 && n <= 200 ? Math.round(n) : null;
      setClauses.push(`"tvSizeInches" = $${values.length + 1}`);
      values.push(size);
    }
    if ('tvInstalledAt' in body) {
      const d = body.tvInstalledAt ? new Date(body.tvInstalledAt) : null;
      setClauses.push(`"tvInstalledAt" = $${values.length + 1}`);
      values.push(d && !isNaN(d.getTime()) ? d : null);
    }

    if (setClauses.length === 0) return NextResponse.json({ ok: true });

    setClauses.push(`"updatedAt" = NOW()`);
    values.push(id);

    await db.$queryRawUnsafe(
      `UPDATE "Store" SET ${setClauses.join(', ')} WHERE "id" = $${values.length}`,
      ...values
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    // Find the store to get userId before deleting
    const rows = await db.$queryRaw<Array<{ userId: string; whatsapp: string }>>`
      SELECT "userId", "whatsapp" FROM "Store" WHERE "id" = ${id}
    `;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { userId } = rows[0];

    // The store's devices are about to cascade away with it — capture their FCM
    // tokens first so we can tell those screens to decommission (wipe + re-pair)
    // immediately, same as a direct screen delete via /api/devices/bulk. Screens
    // that miss the push converge via the 410 the device API answers next poll.
    const doomedDevices = await db.device.findMany({
      where:  { storeId: id, fcmToken: { not: null } },
      select: { fcmToken: true },
    });

    // Capture verification-photo keys before the row vanishes so the R2
    // objects can be removed too (tolerant of the columns not existing yet).
    let photoKeys: string[] = [];
    try {
      const ph = await db.$queryRaw<{ shopPhotoUrl: string | null; installPhotoUrl: string | null }[]>`
        SELECT "shopPhotoUrl", "installPhotoUrl" FROM "Store" WHERE "id" = ${id} LIMIT 1
      `;
      photoKeys = [verificationKeyFromUrl(ph[0]?.shopPhotoUrl ?? null), verificationKeyFromUrl(ph[0]?.installPhotoUrl ?? null)]
        .filter((k): k is string => !!k);
    } catch { /* columns not yet migrated */ }

    // Delete store (cascades to StorePayment, StoreOffer, Bill, Device via FK)
    // and the user account atomically — a surviving User with no Store leaves
    // a login that 401s on every store API forever.
    await db.$transaction([
      db.$executeRaw`DELETE FROM "Store" WHERE "id" = ${id}`,
      db.$executeRaw`DELETE FROM "User" WHERE "id" = ${userId}`,
    ]);

    await pushDecommission(doomedDevices.map((d) => d.fcmToken!));
    for (const key of photoKeys) await deleteObject(key).catch(() => { /* best-effort */ });

    // Remove from Redis index (non-fatal)
    try {
      const kv = getRedis();
      if (kv) {
        const ids: string[] = (await kv.get<string[]>('stores:index')) ?? [];
        await kv.set('stores:index', ids.filter((x) => x !== id));
        await kv.del(`store:${id}`);
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
