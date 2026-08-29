// GET /api/admin/products/suggestions
// Returns store offer product names that have no productId match (unrecognized)
// grouped by name + weight, with count of stores that submitted them.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await db.$queryRaw<{ productName: string; weight: string | null; count: number }[]>`
      SELECT "productName", "weight", COUNT(*)::int AS count
      FROM "StoreOffer"
      WHERE "productId" IS NULL
      GROUP BY "productName", "weight"
      ORDER BY count DESC
      LIMIT 100
    `;
    return NextResponse.json({ suggestions: rows });
  } catch {
    // StoreOffer table may not exist yet
    return NextResponse.json({ suggestions: [] });
  }
}
