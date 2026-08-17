// GET /api/bills/[billRef]  — public, no auth
// Returns: { bill: {...}, items: [...] }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ billRef: string }> },
) {
  const { billRef } = await params;

  const bill = await db.bill.findUnique({
    where: { billRef },
    include: { items: true },
  });

  if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Strip storeId: billRefs are guessable (time-based), this route is public,
  // and storeId doubles as the store partner's API bearer credential — leaking
  // it would let anyone write to that store's KYC/payout/verification-photo
  // endpoints.
  const { items, storeId: _storeId, ...billData } = bill;
  return NextResponse.json({ bill: billData, items });
}
