// GET /api/admin/store-payments/bulk-export?month=YYYY-MM
// Generates a NEFT bulk payment CSV for the given month's pending store payouts.
// Format compatible with: SBI YONO Business, HDFC NetBanking, ICICI CIB bulk upload.
// Admin downloads this file and uploads it to their bank portal.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month'); // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
  }

  try {
    // Get all stores that have a live date in or before this month
    const [y, mo] = month.split('-').map(Number);
    const monthStart = new Date(y, mo - 1, 1);
    const monthEnd   = new Date(y, mo, 1);

    const stores = await db.store.findMany({
      where: {
        OR: [
          { liveAt: { lte: monthEnd } },
          { agreedAt: { lte: monthEnd } },
        ],
      },
      select: {
        id: true, storeName: true, ownerName: true, whatsapp: true,
        upiId: true, bankAccountNo: true, bankIfsc: true, bankAccountName: true, payoutMethod: true,
        liveAt: true, agreedAt: true,
      },
    });

    // Exclude stores already paid this month
    const paidThisMonth = await db.storePayment.findMany({
      where: { month, status: 'paid' },
      select: { storeId: true },
    });
    const paidSet = new Set(paidThisMonth.map((p) => p.storeId));

    const pending = stores.filter((s) => {
      if (paidSet.has(s.id)) return false;
      const start = s.liveAt ?? s.agreedAt;
      if (!start) return false;
      return new Date(start) <= monthEnd;
    });

    if (pending.length === 0) {
      return NextResponse.json({ error: 'No pending stores for this month' }, { status: 404 });
    }

    const monthLabel = fmtMonth(month);
    const narration  = `ALIVE Partner ${monthLabel}`;

    // ── Build CSV rows ────────────────────────────────────────────────────────
    // Generic format compatible with most Indian bank bulk upload portals.
    // Columns: Sr No, Beneficiary Name, Account Number / UPI, IFSC, Amount, Mode, Narration
    const rows: string[] = [
      'Sr No,Beneficiary Name,Account / UPI ID,IFSC Code,Amount (INR),Mode,Narration,Phone',
    ];

    pending.forEach((store, i) => {
      const name    = `"${store.ownerName || store.storeName}"`;
      const account = store.upiId ?? store.bankAccountNo ?? '';
      const ifsc    = store.bankIfsc ?? '';
      const mode    = store.upiId ? 'UPI' : 'NEFT';
      const amount  = '500.00';
      const note    = `"${narration}"`;
      const phone   = store.whatsapp ?? '';
      rows.push([i + 1, name, account, ifsc, amount, mode, note, phone].join(','));
    });

    const csv = rows.join('\r\n');
    const filename = `alive-payments-${month}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
