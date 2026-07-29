import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoreId } from '@/lib/store-partner-auth';

export async function GET(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payments = await db.storePayment.findMany({
    where: { storeId },
    select: { month: true, status: true, amountPaise: true, paidAt: true, payRef: true },
    orderBy: { month: 'asc' },
  });
  return NextResponse.json(payments);
}
