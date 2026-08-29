import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { randomInt, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { notifyStoreWA } from '@/lib/notify';
import { isWhatsappOtpConfigured, sendWhatsappOtp } from '@/lib/msg91';

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}

const OTP_TTL = 600; // 10 minutes
// A 6-digit OTP is only ~1e6 wide, so without an attempt cap it is brute-forceable
// in minutes — which would be a full store-partner account takeover. Five tries
// per issued code, then the code is burned and a new one must be requested.
const MAX_OTP_ATTEMPTS = 5;
// Cap how often a code can be (re)issued for one number: stops OTP-bombing a
// partner's WhatsApp and stops an attacker cycling codes to widen the guess space.
const MAX_REQUESTS_PER_WINDOW = 5;
const REQUEST_WINDOW = 3600; // 1 hour

function otpKey(phone: string) {
  return `otp:store:${phone}`;
}
function attemptKey(phone: string) {
  return `otp:store:${phone}:attempts`;
}
function requestKey(phone: string) {
  return `otp:store:${phone}:requests`;
}

/** Constant-time OTP comparison — never leak the code a digit at a time. */
function otpMatches(stored: string, provided: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'request' | 'verify';
      phone: string;
      otp?: string;
      newPassword?: string;
    };

    const phone = `+91${body.phone.replace(/\D/g, '').slice(-10)}`;

    // ── Phase 1: send OTP ────────────────────────────────────────────────────
    if (body.action === 'request') {
      const user = await db.user.findUnique({ where: { phone } });
      if (!user) {
        // Don't reveal whether the number is registered
        return NextResponse.json({ ok: true });
      }

      // We generate + store the OTP ourselves (Redis) and deliver it over
      // WhatsApp. MSG91 WhatsApp is the preferred transport; if it isn't
      // configured (or the send fails) we fall back to Twilio WhatsApp.
      const kv = getRedis();
      if (!kv) return NextResponse.json({ error: 'Reset service unavailable. Contact hello@wearealive.in.' }, { status: 503 });

      // Throttle issuance per number. Reply with the same generic ok as the
      // unknown-number branch so this never becomes an enumeration oracle.
      const requests = await kv.incr(requestKey(phone));
      if (requests === 1) await kv.expire(requestKey(phone), REQUEST_WINDOW);
      if (requests > MAX_REQUESTS_PER_WINDOW) return NextResponse.json({ ok: true });

      // randomInt is CSPRNG-backed; Math.random is predictable from prior
      // outputs and must never generate a credential.
      const otp = String(randomInt(100000, 1000000));
      await kv.set(otpKey(phone), otp, { ex: OTP_TTL });
      await kv.del(attemptKey(phone)); // fresh code ⇒ fresh attempt budget

      let delivered = false;
      if (isWhatsappOtpConfigured()) {
        delivered = await sendWhatsappOtp(phone, otp);
      }
      if (!delivered) {
        await notifyStoreWA(phone, [
          `🔐 *ALIVE Password Reset*`,
          ``,
          `Your one-time code is: *${otp}*`,
          ``,
          `This code expires in 10 minutes.`,
          `If you did not request this, ignore this message.`,
        ].join('\n'));
      }

      return NextResponse.json({ ok: true });
    }

    // ── Phase 2: verify OTP + set new password ───────────────────────────────
    if (body.action === 'verify') {
      if (!body.otp || !body.newPassword) {
        return NextResponse.json({ error: 'OTP and new password are required.' }, { status: 400 });
      }
      if (body.newPassword.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
      }

      const kv = getRedis();
      if (!kv) return NextResponse.json({ error: 'Reset service unavailable.' }, { status: 503 });

      // Count the attempt BEFORE comparing, so a crash or a race can never hand
      // back a free guess. Burn the code once the budget is spent.
      const attempts = await kv.incr(attemptKey(phone));
      if (attempts === 1) await kv.expire(attemptKey(phone), OTP_TTL);
      if (attempts > MAX_OTP_ATTEMPTS) {
        await kv.del(otpKey(phone));
        return NextResponse.json(
          { error: 'Too many incorrect attempts. Request a new code.' },
          { status: 429 },
        );
      }

      const stored = await kv.get<string>(otpKey(phone));
      if (!stored || !otpMatches(String(stored), body.otp.trim())) {
        return NextResponse.json({ error: 'Invalid or expired code. Request a new one.' }, { status: 400 });
      }

      const user = await db.user.findUnique({ where: { phone } });
      if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

      const passwordHash = await bcrypt.hash(body.newPassword, 10);
      await db.user.update({ where: { phone }, data: { passwordHash } });
      await kv.del(otpKey(phone));
      await kv.del(attemptKey(phone));

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
