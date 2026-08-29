// GET  /api/coupons — list all coupons (admin)
// POST /api/coupons — create a coupon (admin)
// Auth: admin-password header vs ADMIN_PASSWORD env.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const coupons = await db.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ coupons });
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as {
      code?: string; type?: string; value?: number;
      expiresAt?: string | null; maxRedemptions?: number | null; note?: string | null;
    };

    const code = (body.code ?? '').trim().toUpperCase();
    const type = body.type === 'PERCENT' ? 'PERCENT' : 'FLAT';
    const value = Math.floor(Number(body.value));

    if (!/^[A-Z0-9]{3,24}$/.test(code)) {
      return NextResponse.json({ error: 'Code must be 3–24 letters/numbers, no spaces.' }, { status: 400 });
    }
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ error: 'Discount value must be a positive number.' }, { status: 400 });
    }
    if (type === 'PERCENT' && value > 100) {
      return NextResponse.json({ error: 'Percent discount cannot exceed 100.' }, { status: 400 });
    }

    const coupon = await db.coupon.create({
      data: {
        code,
        type,
        value,
        expiresAt:      body.expiresAt ? new Date(body.expiresAt) : null,
        maxRedemptions: body.maxRedemptions != null && body.maxRedemptions > 0 ? Math.floor(body.maxRedemptions) : null,
        note:           body.note?.trim() || null,
      },
    });
    return NextResponse.json({ coupon });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'A coupon with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not create coupon.' }, { status: 500 });
  }
}
