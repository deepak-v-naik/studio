import { createHmac, timingSafeEqual } from 'crypto';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

// ─── Signed store API tokens ─────────────────────────────────────────────────
//
// A bare storeId is NOT a credential — store ids are enumerable (public map,
// URLs, referrals). Callers that pass an explicit storeId must prove they're
// allowed to act on that store, one of:
//   • `x-store-token` header — HMAC token minted at login / registration /
//     /api/stores/me sync (mobile app SecureStore, web localStorage cache),
//     or via /api/admin/store-token (admin impersonation)
//   • next-auth session whose user owns that store (web dashboard)

const TOKEN_PREFIX = 'st1';
// Refreshed on every successful /api/stores/me fetch, so any partner who opens
// the dashboard/app at least once per window keeps a live token.
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function sign(storeId: string, expMs: number): string | null {
  const key = process.env.AUTH_SECRET;
  if (!key) return null;
  return createHmac('sha256', key).update(`${TOKEN_PREFIX}.${storeId}.${expMs}`).digest('base64url');
}

/** Mints `st1.<storeId>.<expiryMs>.<hmac>` — null only if AUTH_SECRET is unset. */
export function mintStoreToken(storeId: string): string | null {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = sign(storeId, exp);
  return sig ? `${TOKEN_PREFIX}.${storeId}.${exp}.${sig}` : null;
}

/** Returns the storeId a token vouches for, or null if malformed/expired/forged. */
export function verifyStoreToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const [, storeId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!storeId || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = sign(storeId, exp);
  if (!expected) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return storeId;
}

/**
 * Resolves the store a partner-facing request is acting on.
 *
 * Web store-dashboard: no storeId passed — falls back to the next-auth
 * session (phone+password Credentials), matching how it's always worked.
 *
 * Mobile app / cookieless web / admin impersonation: pass storeId explicitly
 * AND a matching `x-store-token` header. An explicit storeId without proof of
 * ownership (token or session owner match) resolves to null.
 *
 * Returns null if the caller isn't authorized for a real store.
 */
export async function resolveStoreId(explicitStoreId?: string | null): Promise<string | null> {
  // Signed token path (mobile app, cookieless web dashboard, impersonation)
  const hdrs = await headers();
  const tokenStoreId = verifyStoreToken(hdrs.get('x-store-token'));
  if (tokenStoreId && (!explicitStoreId || explicitStoreId === tokenStoreId)) {
    const store = await db.store.findUnique({ where: { id: tokenStoreId }, select: { id: true } });
    if (store) return store.id;
  }

  // next-auth session path (web dashboard). An explicit storeId must match the
  // session owner's store — it is never trusted on its own.
  const session = await auth();
  if (!session?.user?.id) return null;
  const store = await db.store.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!store) return null;
  if (explicitStoreId && explicitStoreId !== store.id) return null;
  return store.id;
}
