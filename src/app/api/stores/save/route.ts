import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { notifyAdminWA, storeRegistrationMsg } from '@/lib/notify';
import { mintStoreToken } from '@/lib/store-partner-auth';
import { respond } from '@/lib/api-envelope';

// ─── Redis (dual-write for admin panel backward compat during migration) ──────

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

// ─── GET — list all stores (admin) ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const route = '/api/stores/save';
  const startedAtMs = Date.now();
  const pw = req.headers.get('admin-password') ?? '';
  if (process.env.ADMIN_PASSWORD && pw !== process.env.ADMIN_PASSWORD) {
    const envelope = await respond({ error: 'Unauthorized' }, { route, request: { hasAdminPassword: !!pw }, outcome: 'unauthorized', policyFlags: ['admin_guard'], errorCategory: 'auth', startedAtMs });
    return NextResponse.json(envelope, { status: 401 });
  }
  try {
    // Base columns always present
    const stores = await db.$queryRaw<Array<{
      id: string; storeName: string; ownerName: string; whatsapp: string;
      address: string | null; locality: string | null; city: string | null;
      pincode: string | null; lat: number | null; lng: number | null;
      gstin: string | null; referralCode: string; referredBy: string | null;
      agreedAt: Date | null; createdAt: Date; updatedAt: Date;
      phone: string | null; email: string | null;
      deviceCount: number;
    }>>`
      SELECT
        s."id", s."storeName", s."ownerName", s."whatsapp",
        s."address", s."locality", s."city", s."pincode",
        s."lat", s."lng", s."gstin",
        s."referralCode", s."referredBy", s."agreedAt",
        s."createdAt", s."updatedAt",
        u."phone", u."email",
        (SELECT COUNT(*) FROM "Device" d WHERE d."storeId" = s."id")::int AS "deviceCount"
      FROM "Store" s
      LEFT JOIN "User" u ON u."id" = s."userId"
      ORDER BY s."createdAt" DESC
    `;

    // Optional columns added by migrations — fetched separately so base query never fails
    type ExtraRow = {
      id: string;
      onboardingStage: string | null; payoutStatus: string | null;
      payoutNotes: string | null; liveAt: Date | null;
      upiId: string | null; payoutMethod: string | null;
      tier: string | null; monthlyCompensationPaise: number | null;
    };
    let extraMap = new Map<string, ExtraRow>();
    try {
      const extraRows = await db.$queryRaw<ExtraRow[]>`
        SELECT "id", "onboardingStage", "payoutStatus", "payoutNotes", "liveAt",
               "upiId", "payoutMethod", "tier", "monthlyCompensationPaise"
        FROM "Store"
      `;
      extraMap = new Map(extraRows.map((r) => [r.id, r]));
    } catch { /* columns not yet migrated — omit gracefully */ }

    // GPS-verified onboarding photos — separate query so a missing migration
    // can't hide the stage/payout columns above.
    type PhotoRow = {
      id: string;
      shopPhotoUrl: string | null; shopPhotoLat: number | null; shopPhotoLng: number | null;
      shopPhotoSource: string | null; shopPhotoAt: Date | null;
      installPhotoUrl: string | null; installPhotoLat: number | null; installPhotoLng: number | null;
      installPhotoSource: string | null; installPhotoAt: Date | null;
    };
    let photoMap = new Map<string, PhotoRow>();
    try {
      const photoRows = await db.$queryRaw<PhotoRow[]>`
        SELECT "id", "shopPhotoUrl", "shopPhotoLat", "shopPhotoLng", "shopPhotoSource", "shopPhotoAt",
               "installPhotoUrl", "installPhotoLat", "installPhotoLng", "installPhotoSource", "installPhotoAt"
        FROM "Store"
      `;
      photoMap = new Map(photoRows.map((r) => [r.id, r]));
    } catch { /* columns not yet migrated — omit gracefully */ }

    // Installation & hardware — again a separate tolerant query, so a missing
    // migration degrades to "no hardware recorded" instead of blanking the
    // stage/payout/photo columns above. Admin-gated route, so wifiPassword is
    // safe to include here (partner routes never return it).
    type InstallRow = {
      id: string;
      tvBrand: string | null; tvSizeInches: number | null; tvTag: string | null;
      tvInstalledAt: Date | null; espSwitchName: string | null;
      wifiSsid: string | null; wifiPassword: string | null; installNotes: string | null;
    };
    let installMap = new Map<string, InstallRow>();
    try {
      const installRows = await db.$queryRaw<InstallRow[]>`
        SELECT "id", "tvBrand", "tvSizeInches", "tvTag", "tvInstalledAt",
               "espSwitchName", "wifiSsid", "wifiPassword", "installNotes"
        FROM "Store"
      `;
      installMap = new Map(installRows.map((r) => [r.id, r]));
    } catch { /* columns not yet migrated — omit gracefully */ }

    const result = stores.map((s) => {
      const ex = extraMap.get(s.id);
      const ph = photoMap.get(s.id);
      const hw = installMap.get(s.id);
      return {
        ...s,
        tvBrand:       hw?.tvBrand       ?? null,
        tvSizeInches:  hw?.tvSizeInches  ?? null,
        tvTag:         hw?.tvTag         ?? null,
        tvInstalledAt: hw?.tvInstalledAt instanceof Date ? hw.tvInstalledAt.toISOString() : (hw?.tvInstalledAt ?? null),
        espSwitchName: hw?.espSwitchName ?? null,
        wifiSsid:      hw?.wifiSsid      ?? null,
        wifiPassword:  hw?.wifiPassword  ?? null,
        installNotes:  hw?.installNotes  ?? null,
        shopPhotoUrl:       ph?.shopPhotoUrl       ?? null,
        shopPhotoLat:       ph?.shopPhotoLat       ?? null,
        shopPhotoLng:       ph?.shopPhotoLng       ?? null,
        shopPhotoSource:    ph?.shopPhotoSource    ?? null,
        shopPhotoAt:        ph?.shopPhotoAt instanceof Date ? ph.shopPhotoAt.toISOString() : (ph?.shopPhotoAt ?? null),
        installPhotoUrl:    ph?.installPhotoUrl    ?? null,
        installPhotoLat:    ph?.installPhotoLat    ?? null,
        installPhotoLng:    ph?.installPhotoLng    ?? null,
        installPhotoSource: ph?.installPhotoSource ?? null,
        installPhotoAt:     ph?.installPhotoAt instanceof Date ? ph.installPhotoAt.toISOString() : (ph?.installPhotoAt ?? null),
        createdAt:       s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        updatedAt:       s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
        agreedAt:        s.agreedAt instanceof Date  ? s.agreedAt.toISOString()  : (s.agreedAt ?? null),
        onboardingStage: ex?.onboardingStage ?? null,
        payoutStatus:    ex?.payoutStatus    ?? null,
        payoutNotes:     ex?.payoutNotes     ?? null,
        liveAt:          ex?.liveAt instanceof Date ? ex.liveAt.toISOString() : (ex?.liveAt ?? null),
        upiId:           ex?.upiId           ?? null,
        payoutMethod:    ex?.payoutMethod    ?? null,
        tier:            ex?.tier ?? 'standard',
        monthlyCompensationPaise: Number(ex?.monthlyCompensationPaise ?? 50000),
        deviceCount:     Number(s.deviceCount),
      };
    });

    const envelope = await respond(result, { route, request: { operation: 'list_stores' }, outcome: 'success', startedAtMs });
    return NextResponse.json(envelope);
  } catch (e) {
    const envelope = await respond({ error: (e as Error).message }, { route, request: { operation: 'list_stores' }, outcome: 'server_error', policyFlags: ['exception'], errorCategory: 'runtime', startedAtMs });
    return NextResponse.json(envelope, { status: 500 });
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

async function checkRegistrationRateLimit(ip: string): Promise<boolean> {
  // Fail open on ANY Redis problem (bad URL, outage): rate limiting is
  // best-effort and must never take registration down with it.
  try {
    const kv = getRedis();
    if (!kv) return true;
    const key   = `rl:register:${ip}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, 3600); // 1 attempt per IP per hour
    return count <= 3;
  } catch {
    return true;
  }
}

// ─── POST — register a new store partner ─────────────────────────────────────

type RegistrationBody = {
  storeName:    string;
  ownerName:    string;
  whatsapp:     string;
  password:     string;
  address:      string;
  locality?:    string;
  city?:        string;
  pincode?:     string;
  lat?:         string;
  lng?:         string;
  gstin?:       string;
  referredBy?:  string;
  referralCode: string;
  agreedAt:     string;
  premiumKey?:  string; // secret from the gated premium signup link; validated server-side
};

export async function POST(req: NextRequest) {
  const route = '/api/stores/save';
  const startedAtMs = Date.now();

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await checkRegistrationRateLimit(ip))) {
    const envelope = await respond({ error: 'Too many registrations from this IP. Try again in an hour.' }, { route, request: { ip }, outcome: 'unauthorized', policyFlags: ['rate_limit'], errorCategory: 'auth', startedAtMs });
    return NextResponse.json(envelope, { status: 429 });
  }

  try {
    const body = await req.json() as RegistrationBody;

    if (!body.address?.trim()) {
      const envelope = await respond({ error: 'Shop address is required.' }, { route, request: { hasAddress: false }, outcome: 'invalid_request', policyFlags: ['missing_required_fields'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope, { status: 400 });
    }

    const phone = `+91${body.whatsapp.replace(/\D/g, '').slice(-10)}`;

    // Guard: duplicate phone — select only id to avoid schema drift issues
    const existing = await db.user.findUnique({ where: { phone }, select: { id: true } });
    if (existing) {
      const envelope = await respond({ error: 'An account with this number already exists.' }, { route, request: { phone }, outcome: 'conflict', policyFlags: ['duplicate_account'], errorCategory: 'duplicate', startedAtMs });
      return NextResponse.json(envelope, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const storeId      = crypto.randomUUID();
    const now          = new Date();
    const agreedAt     = body.agreedAt ? new Date(body.agreedAt) : now;
    const lat          = body.lat ? parseFloat(body.lat) : null;
    const lng          = body.lng ? parseFloat(body.lng) : null;

    // Premium tier is decided server-side from the secret key in the gated
    // premium signup link — never trusted from a client-set flag.
    const isPremium = !!process.env.PREMIUM_SIGNUP_KEY && body.premiumKey === process.env.PREMIUM_SIGNUP_KEY;
    const tier      = isPremium ? 'premium' : 'standard';
    const compPaise = isPremium ? Number(process.env.PREMIUM_MONTHLY_PAISE ?? 100000) : 50000;

    // Create user only — no nested store.create so Prisma doesn't touch Store at all
    const user = await db.user.create({
      data: { phone, passwordHash, name: body.ownerName, role: 'STORE_PARTNER' },
      select: { id: true },
    });

    // Raw INSERT — only the base columns from the init migration.
    // This bypasses Prisma's schema-aware INSERT which adds onboardingStage, payoutStatus, etc.
    await db.$executeRaw`
      INSERT INTO "Store" (
        "id", "userId", "storeName", "ownerName", "whatsapp", "address",
        "gstin", "locality", "city", "pincode", "lat", "lng",
        "referralCode", "referredBy", "agreedAt",
        "tier", "monthlyCompensationPaise", "createdAt", "updatedAt"
      ) VALUES (
        ${storeId}, ${user.id}, ${body.storeName}, ${body.ownerName},
        ${body.whatsapp}, ${body.address},
        ${body.gstin || null}, ${body.locality || null}, ${body.city || null},
        ${body.pincode || null}, ${lat}, ${lng},
        ${body.referralCode}, ${body.referredBy || null}, ${agreedAt},
        ${tier}, ${compPaise}, ${now}, ${now}
      )
    `;

    // Build result from known values — no follow-up SELECT needed
    const store = {
      id:           storeId,
      referralCode: body.referralCode,
      storeName:    body.storeName,
      ownerName:    body.ownerName,
      whatsapp:     body.whatsapp,
      address:      body.address,
      locality:     body.locality ?? '',
      city:         body.city ?? '',
      pincode:      body.pincode ?? '',
      lat,
      lng,
      referredBy:   body.referredBy ?? '',
      agreedAt:     agreedAt.toISOString(),
      createdAt:    now.toISOString(),
    };

    // Dual-write to Redis (non-fatal)
    try {
      const kv = getRedis();
      if (kv) {
        const ids: string[] = (await kv.get<string[]>('stores:index')) ?? [];
        if (!ids.includes(store.id)) await kv.set('stores:index', [store.id, ...ids]);
        await kv.set(`store:${store.id}`, { ...store, phone });
      }
    } catch {
      // Redis dual-write failure is non-fatal — Postgres is source of truth
    }

    void notifyAdminWA(storeRegistrationMsg({
      storeName: body.storeName,
      ownerName: body.ownerName,
      phone,
      city:    body.city    ?? null,
      address: body.address ?? null,
      gstin:   body.gstin   ?? null,
    }));

    // storeId + signed token let the just-registered client call store APIs
    // before its first next-auth login (web localStorage cache, mobile app).
    const envelope = await respond(
      { success: true, referralCode: store.referralCode, storeId: store.id, storeToken: mintStoreToken(store.id) ?? undefined },
      { route, request: { phone, storeName: body.storeName }, outcome: 'success', startedAtMs },
    );
    return NextResponse.json(envelope);
  } catch (e) {
    const msg = (e as Error).message ?? 'Failed to register store';
    const envelope = await respond({ error: msg }, { route, request: { operation: 'register_store' }, outcome: 'server_error', policyFlags: ['exception'], errorCategory: 'runtime', startedAtMs });
    return NextResponse.json(envelope, { status: 500 });
  }
}
