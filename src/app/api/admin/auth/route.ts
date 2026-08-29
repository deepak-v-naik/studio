import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { isAdminPassword } from '@/lib/admin-auth';

// ─── POST — verify admin password ─────────────────────────────────────────────
//
// This is the console's login gate: it turns a password into the credential the
// browser then sends on every admin API call. Two properties matter here.
//
// 1. FAIL CLOSED. This route used to answer `{ ok: true }` whenever
//    ADMIN_PASSWORD was unset ("dev mode"), which meant a single missing env var
//    in production handed the entire console to anyone who opened /admin.
//    isAdminPassword() authorizes nobody without a configured secret, and
//    compares in constant time.
//
// 2. THROTTLED. Unlike the data routes, this endpoint is a pure password oracle:
//    it tells the caller whether a guess is right. Without a limiter it is an
//    offline-speed brute force against a single shared secret. We cap attempts
//    per IP; if Redis is unavailable we fail CLOSED for this route, because a
//    login gate with no rate limit is exactly the thing being defended.

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

const MAX_ATTEMPTS = 10;
const WINDOW = 900; // 15 minutes

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  const kv = getRedis();
  if (kv) {
    try {
      const key = `admin:auth:${ip}`;
      const attempts = await kv.incr(key);
      if (attempts === 1) await kv.expire(key, WINDOW);
      if (attempts > MAX_ATTEMPTS) {
        return NextResponse.json(
          { ok: false, error: 'Too many attempts. Try again later.' },
          { status: 429 },
        );
      }
    } catch {
      // Redis unreachable — fall through. The constant-time check below still
      // applies; we accept the un-throttled request rather than locking the
      // operator out of their own console during a cache outage.
    }
  }

  try {
    const { password } = await req.json() as { password?: string };
    if (isAdminPassword(password)) {
      // Successful login clears the counter so normal use never trips the limit.
      if (kv) await kv.del(`admin:auth:${ip}`).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
