// Admin product catalogue CRUD.
// GET  /api/admin/products?q=&category=&page=
// POST /api/admin/products  — create (auto-assigns product_id)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { makeGroupId, makeProductId } from '@/lib/product-id';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p        = req.nextUrl.searchParams;
  const q        = p.get('q')?.trim() ?? '';
  const category = p.get('category') ?? undefined;
  const page     = Math.max(1, Number(p.get('page') ?? 1));
  const limit    = 50;

  const products = await db.product.findMany({
    where: {
      isActive: true,
      ...(category ? { category } : {}),
      ...(q ? {
        OR: [
          { productName: { contains: q, mode: 'insensitive' } },
          { brand:       { contains: q, mode: 'insensitive' } },
          { id:          { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
    },
    orderBy: [{ category: 'asc' }, { brand: 'asc' }, { id: 'asc' }],
    take:    limit,
    skip:    (page - 1) * limit,
  });

  const total = await db.product.count({
    where: {
      isActive: true,
      ...(category ? { category } : {}),
      ...(q ? {
        OR: [
          { productName: { contains: q, mode: 'insensitive' } },
          { brand:       { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
    },
  });

  return NextResponse.json({ products, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    productName: string; brand: string; category: string;
    sizeVariant: string; unitType: string; mrp?: number;
    barcodeEan?: string;
  };

  if (!body.productName || !body.brand || !body.category || !body.sizeVariant || !body.unitType)
    return NextResponse.json({ error: 'productName, brand, category, sizeVariant, unitType required' }, { status: 400 });

  const groupId = makeGroupId(body.category, body.brand);

  // Find next sequence number for this group
  const existing = await db.product.findMany({
    where:   { groupId },
    select:  { id: true },
    orderBy: { id: 'asc' },
  });
  const seq = existing.length + 1;
  const id  = makeProductId(body.category, body.brand, seq);

  const product = await db.product.create({
    data: {
      id,
      groupId,
      productName: body.productName.trim(),
      brand:       body.brand.trim(),
      category:    body.category.toUpperCase(),
      sizeVariant: body.sizeVariant.trim(),
      unitType:    body.unitType,
      mrp:         body.mrp ?? null,
      barcodeEan:  body.barcodeEan?.trim() || null,
    },
  });

  return NextResponse.json({ product }, { status: 201 });
}
