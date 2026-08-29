// PATCH  /api/coupons/[id] — update a coupon (toggle active, edit fields) (admin)
// DELETE /api/coupons/[id] — delete a coupon (admin)
// Auth: admin-password header vs ADMIN_PASSWORD env.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await req.json() as {
      active?: boolean; value?: number; expiresAt?: string | null;
      maxRedemptions?: number | null; note?: string | null;
    };

    const data: Record<string, unknown> = {};
    if (typeof body.active === 'boolean') data.active = body.active;
    if (body.value != null) {
      const v = Math.floor(Number(body.value));
      if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: 'Invalid value.' }, { status: 400 });
      data.value = v;
    }
    if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.maxRedemptions !== undefined) {
      data.maxRedemptions = body.maxRedemptions != null && body.maxRedemptions > 0 ? Math.floor(body.maxRedemptions) : null;
    }
    if (body.note !== undefined) data.note = body.note?.trim() || null;

    const coupon = await db.coupon.update({ where: { id }, data });
    return NextResponse.json({ coupon });
  } catch {
    return NextResponse.json({ error: 'Could not update coupon.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await db.coupon.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not delete coupon.' }, { status: 500 });
  }
}
