// POST /api/admin/products/import-mrp
// Bulk-updates MRP on EXISTING products from a pasted/uploaded list — the highest-
// leverage MRP source, since admin already receives distributor price lists (Excel/
// PDF) that map a product to its MRP. Each row keys on either the ALIVE product id
// (CAT-BRAND-SEQ) or the EAN barcode. Sets mrp + mrpCheckedAt; never creates rows.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

type ImportRow = { key: string; mrp: number };

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { rows?: ImportRow[] };
  const rows = (body.rows ?? []).filter((r) => r.key?.trim() && Number.isFinite(r.mrp) && r.mrp > 0);
  if (!rows.length) return NextResponse.json({ error: 'No valid rows' }, { status: 400 });

  const now = new Date();
  let updated = 0;
  const notFound: string[] = [];

  for (const row of rows) {
    const key = row.key.trim();
    const mrp = Math.round(row.mrp);
    // Match by product id first, then by EAN barcode.
    const product = await db.product.findFirst({
      where: { isActive: true, OR: [{ id: key }, { barcodeEan: key }] },
      select: { id: true },
    });
    if (!product) { notFound.push(key); continue; }
    await db.product.update({
      where: { id: product.id },
      data:  { mrp, mrpCheckedAt: now, updatedAt: now },
    });
    updated++;
  }

  return NextResponse.json({ updated, notFound, total: rows.length });
}
