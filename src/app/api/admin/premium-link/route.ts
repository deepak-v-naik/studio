// GET /api/admin/premium-link
// Surfaces the premium store signup link so it's visible in admin instead of only
// existing as an env var nobody but a developer can read. PREMIUM_SIGNUP_KEY is a
// shareable invite code, not a server-access secret -- admins are meant to hand this
// exact URL to premium partners, so returning it to an authenticated admin is the
// intended use, not a leak.
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = process.env.PREMIUM_SIGNUP_KEY ?? null;
  // Same default as /api/stores/premium-validate -- keep these in sync.
  const monthlyPaise = Number(process.env.PREMIUM_MONTHLY_PAISE ?? 100000);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wearealive.in';

  return NextResponse.json({
    configured: !!key,
    link: key ? `${origin}/store?premium=${key}` : null,
    monthlyRupees: Math.round(monthlyPaise / 100),
  });
}
