// CSV export of hourly footfall data for a store.
// GET /api/footfall/:storeId/export/csv?from=&to=
// Auth: admin-password header or query param.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? req.nextUrl.searchParams.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

function esc(v: string | number | null | undefined) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { storeId } = await params;

  const { searchParams } = new URL(req.url);
  const to   = searchParams.get('to')   ? new Date(searchParams.get('to')!)   : new Date();
  const from = searchParams.get('from') ? new Date(searchParams.get('from')!) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  const hourly = await db.footfallHourly.findMany({
    where: { storeId, hourBucket: { gte: from, lte: to } },
    orderBy: { hourBucket: 'asc' },
  });

  const header = ['hour_utc', 'customer_count', 'unconfirmed_count', 'avg_confidence', 'excluded_count'];
  const rows = hourly.map((h) => [
    esc(h.hourBucket.toISOString()),
    esc(h.customerCount),
    esc(h.unconfirmedCount),
    esc(h.avgConfidence?.toFixed(3) ?? ''),
    esc(h.excludedCount),
  ].join(','));

  const csv = [header.join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="footfall-${storeId}.csv"`,
    },
  });
}
