// POST /api/admin/products/[id]/lookup-barcode
// Looks up this product's EAN barcode on Open Food Facts + Open Prices (free, no
// key). Returns verified product identity and any INR price candidates for admin
// review — does NOT auto-save the MRP.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { lookupByBarcode } from '@/lib/openfoodfacts';

export const runtime = 'nodejs';
export const maxDuration = 30;

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const product = await db.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  if (!product.barcodeEan) {
    return NextResponse.json({ error: 'This product has no EAN barcode. Add one to enable lookup.' }, { status: 400 });
  }

  const result = await lookupByBarcode(product.barcodeEan);
  return NextResponse.json(result);
}
