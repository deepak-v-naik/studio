import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { Redis } from '@upstash/redis';
import { db } from '@/lib/db';
import { mintStoreToken } from '@/lib/store-partner-auth';

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

// Sliding-window rate limit: max 10 login attempts per IP per 60 seconds.
async function checkRateLimit(ip: string): Promise<boolean> {
  // Fail open on ANY Redis problem (bad URL, outage): rate limiting is
  // best-effort and must never take logins down with it.
  try {
    const kv = getRedis();
    if (!kv) return true; // allow if Redis unavailable

    const key    = `rl:login:${ip}`;
    const limit  = 10;
    const window = 60; // seconds

    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, window);
    return count <= limit;
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many login attempts. Please wait a minute.' }, { status: 429 });
  }

  try {
    const { phone, password } = await req.json() as { phone: string; password: string };
    if (!phone || !password) return NextResponse.json({ store: null });

    const normalized = `+91${phone.replace(/\D/g, '').slice(-10)}`;

    const user = await db.user.findUnique({
      where:  { phone: normalized },
      select: { id: true, passwordHash: true },
    });

    if (!user?.passwordHash) {
      return NextResponse.json({ store: null, error: 'Incorrect number or password.' }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ store: null, error: 'Incorrect number or password.' }, { status: 401 });
    }

    // Fetch store via raw query to avoid schema drift on missing columns
    const rows = await db.$queryRaw<Array<{
      id: string; userId: string; storeName: string; ownerName: string; whatsapp: string;
      address: string | null; locality: string | null; city: string | null; pincode: string | null;
      lat: number | null; lng: number | null; gstin: string | null;
      referralCode: string; referredBy: string | null; agreedAt: Date | null;
      createdAt: Date; updatedAt: Date;
    }>>`
      SELECT id, "userId", "storeName", "ownerName", whatsapp,
             address, locality, city, pincode, lat, lng, gstin,
             "referralCode", "referredBy", "agreedAt", "createdAt", "updatedAt"
      FROM "Store"
      WHERE "userId" = ${user.id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ store: null, error: 'Store not found.' }, { status: 404 });
    }

    const s = rows[0];
    // Signed token proves ownership of this storeId on later API calls —
    // the mobile app persists it in SecureStore with the rest of the session.
    const token = mintStoreToken(s.id);
    return NextResponse.json({
      store: {
        ...s,
        ...(token ? { token } : {}),
        agreedAt:  s.agreedAt  instanceof Date ? s.agreedAt.toISOString()  : (s.agreedAt ?? null),
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
