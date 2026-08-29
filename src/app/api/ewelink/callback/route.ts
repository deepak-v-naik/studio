// eWeLink OAuth redirect target. eWeLink sends ?code=&region=&state= here after
// the admin approves access; we exchange the code (valid ~30s) for tokens and
// store them in the EwelinkAccount singleton, then bounce back to /admin.
// No admin-password guard: the request comes from the admin's own browser via
// eWeLink's redirect, and the HMAC state param proves the flow started from an
// authenticated login-url call. Nothing sensitive is echoed to the caller.

import { NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/with-api-handler';
import { db } from '@/lib/db';
import { exchangeCode, verifyOauthState, isValidRegion } from '@/lib/ewelink';

export const GET = withApiHandler('/api/ewelink/callback', 'admin', async (req) => {
  const code = req.nextUrl.searchParams.get('code');
  const region = req.nextUrl.searchParams.get('region');
  const state = req.nextUrl.searchParams.get('state');

  const fail = (reason: string) =>
    NextResponse.redirect(`${req.nextUrl.origin}/admin?ewelink=error&reason=${encodeURIComponent(reason)}`);

  if (!verifyOauthState(state)) return fail('invalid or expired state — retry Connect eWeLink');
  if (!code || !region) return fail('missing code or region');
  // Reject a forged region before it ever reaches the request host (SSRF guard).
  if (!isValidRegion(region)) return fail('invalid region');

  try {
    const redirectUrl = `${req.nextUrl.origin}/api/ewelink/callback`;
    const tokens = await exchangeCode(region, code, redirectUrl);
    const data = {
      region,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      atExpiresAt: tokens.atExpiredTime ? new Date(tokens.atExpiredTime) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      rtExpiresAt: tokens.rtExpiredTime ? new Date(tokens.rtExpiredTime) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      needsReauth: false,
    };
    await db.ewelinkAccount.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    return NextResponse.redirect(`${req.nextUrl.origin}/admin?ewelink=connected`);
  } catch (e) {
    return fail((e as Error).message);
  }
});
