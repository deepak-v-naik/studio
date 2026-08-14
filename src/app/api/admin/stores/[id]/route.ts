import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Redis } from '@upstash/redis';
import { pushDecommission } from '@/lib/fcm';

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
    };

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

    // Delete store (cascades to StorePayment, StoreOffer, Bill, Device via FK)
    await db.$executeRaw`DELETE FROM "Store" WHERE "id" = ${id}`;
    // Delete the user account
    await db.$executeRaw`DELETE FROM "User" WHERE "id" = ${userId}`;

    await pushDecommission(doomedDevices.map((d) => d.fcmToken!));

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
