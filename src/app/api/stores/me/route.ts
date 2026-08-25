import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { mintStoreToken, resolveStoreId } from '@/lib/store-partner-auth';

// Base columns guaranteed from init migration — no optional columns here
type StoreRow = {
  id: string; userId: string; storeName: string; ownerName: string;
  whatsapp: string; address: string | null; locality: string | null;
  city: string | null; pincode: string | null; lat: number | null; lng: number | null;
  gstin: string | null; referralCode: string; referredBy: string | null;
  agreedAt: Date | null; createdAt: Date; updatedAt: Date;
};

export async function GET(req: NextRequest) {
  try {
    const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
    if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Select only base columns that exist in the init migration.
    // liveAt is fetched separately so a missing column never breaks dashboard load.
    const rows = await db.$queryRaw<StoreRow[]>`
      SELECT
        s."id", s."userId", s."storeName", s."ownerName", s."whatsapp",
        s."address", s."locality", s."city", s."pincode", s."lat", s."lng",
        s."gstin", s."referralCode", s."referredBy", s."agreedAt",
        s."createdAt", s."updatedAt",
        u."email", u."phone"
      FROM "Store" s
      LEFT JOIN "User" u ON u."id" = s."userId"
      WHERE s."id" = ${storeId}
      LIMIT 1
    `;

    if (!rows.length) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    // Attempt to read optional columns separately — may not exist on older DBs
    let liveAt: string | null = null;
    let onboardingStage: string | null = null;
    let deviceCount = 0;
    let tier = 'standard';
    let monthlyCompensationPaise = 50000;
    let payout: { payoutMethod: string | null; upiId: string | null; bankAccountName: string | null; bankAccountNo: string | null; bankIfsc: string | null; bankName: string | null } =
      { payoutMethod: null, upiId: null, bankAccountName: null, bankAccountNo: null, bankIfsc: null, bankName: null };
    try {
      const extra = await db.$queryRaw<{ liveAt: Date | null; onboardingStage: string | null; tier: string | null; monthlyCompensationPaise: number | null; payoutMethod: string | null; upiId: string | null; bankAccountName: string | null; bankAccountNo: string | null; bankIfsc: string | null; bankName: string | null }[]>`
        SELECT "liveAt", "onboardingStage", "tier", "monthlyCompensationPaise",
               "payoutMethod", "upiId", "bankAccountName", "bankAccountNo", "bankIfsc", "bankName"
        FROM "Store" WHERE "id" = ${storeId} LIMIT 1
      `;
      const v = extra[0]?.liveAt;
      liveAt = v instanceof Date ? v.toISOString() : (v ?? null);
      onboardingStage = extra[0]?.onboardingStage ?? null;
      tier = extra[0]?.tier ?? 'standard';
      monthlyCompensationPaise = Number(extra[0]?.monthlyCompensationPaise ?? 50000);
      payout = {
        payoutMethod:    extra[0]?.payoutMethod    ?? null,
        upiId:           extra[0]?.upiId           ?? null,
        bankAccountName: extra[0]?.bankAccountName ?? null,
        bankAccountNo:   extra[0]?.bankAccountNo   ?? null,
        bankIfsc:        extra[0]?.bankIfsc        ?? null,
        bankName:        extra[0]?.bankName        ?? null,
      };
    } catch { /* column not yet migrated — safe default null */ }

    // GPS-verified onboarding photos — separate query so a missing migration
    // can't take the stage/payout fields down with it.
    type PhotoCols = {
      shopPhotoUrl: string | null; shopPhotoLat: number | null; shopPhotoLng: number | null;
      shopPhotoSource: string | null; shopPhotoAt: Date | null;
      installPhotoUrl: string | null; installPhotoLat: number | null; installPhotoLng: number | null;
      installPhotoSource: string | null; installPhotoAt: Date | null;
    };
    let photos: Partial<PhotoCols> = {};
    try {
      const rowsP = await db.$queryRaw<PhotoCols[]>`
        SELECT "shopPhotoUrl", "shopPhotoLat", "shopPhotoLng", "shopPhotoSource", "shopPhotoAt",
               "installPhotoUrl", "installPhotoLat", "installPhotoLng", "installPhotoSource", "installPhotoAt"
        FROM "Store" WHERE "id" = ${storeId} LIMIT 1
      `;
      photos = rowsP[0] ?? {};
    } catch { /* columns not yet migrated — omit gracefully */ }

    // Count linked devices for store overview
    try {
      const storeRow = rows[0];
      const devCount = await db.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM "Device" WHERE "storeId" = ${storeRow.id}
      `;
      deviceCount = Number(devCount[0]?.count ?? 0);
    } catch { /* Device.storeId may not exist yet */ }

    const s = rows[0];
    return NextResponse.json({
      id:           s.id,
      storeName:    s.storeName,
      ownerName:    s.ownerName,
      whatsapp:     s.whatsapp,
      address:      s.address,
      locality:     s.locality,
      city:         s.city,
      pincode:      s.pincode,
      lat:          s.lat,
      lng:          s.lng,
      gstin:        s.gstin,
      referralCode: s.referralCode,
      referredBy:   s.referredBy,
      agreedAt:        s.agreedAt instanceof Date ? s.agreedAt.toISOString() : s.agreedAt,
      liveAt,
      onboardingStage,
      deviceCount,
      tier,
      monthlyCompensationPaise,
      ...payout,
      shopPhotoUrl:     photos.shopPhotoUrl     ?? null,
      shopPhotoLat:     photos.shopPhotoLat     ?? null,
      shopPhotoLng:     photos.shopPhotoLng     ?? null,
      shopPhotoAt:      photos.shopPhotoAt instanceof Date ? photos.shopPhotoAt.toISOString() : (photos.shopPhotoAt ?? null),
      installPhotoUrl:  photos.installPhotoUrl  ?? null,
      installPhotoLat:  photos.installPhotoLat  ?? null,
      installPhotoLng:  photos.installPhotoLng  ?? null,
      installPhotoAt:   photos.installPhotoAt instanceof Date ? photos.installPhotoAt.toISOString() : (photos.installPhotoAt ?? null),
      createdAt:       s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
      // from User join
      email:        (s as unknown as { email?: string }).email ?? null,
      phone:        (s as unknown as { phone?: string }).phone ?? null,
      // Fresh signed token — clients cache it with the session payload so
      // explicit-storeId calls keep working without a next-auth cookie.
      token:        mintStoreToken(s.id) ?? undefined,
    });
  } catch (e) {
    console.error('stores/me GET error', e);
    return NextResponse.json({ error: 'Failed to load store' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
    if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
      email?: string;
      payoutMethod?: string; upiId?: string;
      bankAccountName?: string; bankAccountNo?: string; bankIfsc?: string; bankName?: string;
    };

    if (body.email !== undefined) {
      if (!body.email?.includes('@')) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
      const store = await db.store.findUnique({ where: { id: storeId }, select: { userId: true } });
      if (store) await db.user.update({ where: { id: store.userId }, data: { email: body.email } });
    }

    // Payout fields — try raw UPDATE, silently ignore if columns don't exist yet
    if (body.payoutMethod !== undefined) {
      try {
        await db.$executeRaw`
          UPDATE "Store"
          SET
            "payoutMethod"    = ${body.payoutMethod    || null},
            "upiId"           = ${body.upiId           || null},
            "bankAccountName" = ${body.bankAccountName || null},
            "bankAccountNo"   = ${body.bankAccountNo   || null},
            "bankIfsc"        = ${body.bankIfsc        || null},
            "bankName"        = ${body.bankName        || null},
            "updatedAt"       = NOW()
          WHERE "id" = ${storeId}
        `;
      } catch {
        // Payout columns may not exist yet — non-fatal, user data saved client-side
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('stores/me PATCH error', e);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
