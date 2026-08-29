// PATCH /api/admin/products/[id] — update product fields or image URL
// DELETE /api/admin/products/[id] — soft-delete (isActive=false)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as Partial<{
    productName: string; brand: string; sizeVariant: string;
    unitType: string; mrp: number | null; imageUrl: string | null;
    imageIsAi: boolean; mrpCheckedAt: string | null;
    barcodeEan: string | null; isActive: boolean;
  }>;

  const { mrpCheckedAt, ...rest } = body;

  const product = await db.product.update({
    where: { id },
    data:  {
      ...rest,
      ...(mrpCheckedAt !== undefined ? { mrpCheckedAt: mrpCheckedAt ? new Date(mrpCheckedAt) : null } : {}),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ product });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await db.product.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
