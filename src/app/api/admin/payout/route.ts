import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAdmin(req: NextRequest) {
  // Fail CLOSED: a missing ADMIN_PASSWORD must authorize nobody (see admin-auth.ts).
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { storeId, month, mode = 'upi', amount = 50000 } = await req.json() as {
    storeId: string; month: string; mode?: string; amount?: number;
  };

  if (!storeId || !month) {
    return NextResponse.json({ error: 'storeId and month are required' }, { status: 400 });
  }

  // Fetch store details via raw query (schema drift safe)
  const rows = await db.$queryRaw<Array<{
    storeName: string; ownerName: string; upiId: string | null;
    bankAccountNo: string | null; bankIfsc: string | null; bankAccountName: string | null;
  }>>`
    SELECT "storeName", "ownerName", "upiId", "bankAccountNo", "bankIfsc", "bankAccountName"
    FROM "Store" WHERE "id" = ${storeId}
  `;
  if (!rows.length) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  const store = rows[0];

  const xKeyId     = process.env.RAZORPAY_X_KEY_ID;
  const xKeySecret = process.env.RAZORPAY_X_KEY_SECRET;
  const now = new Date();
  const amountRupees = Math.round(amount / 100); // convert paise to rupees

  let payRef: string | null = null;
  let status = 'pending';
  let message = '';

  if (xKeyId && xKeySecret) {
    // Razorpay X Payouts API
    try {
      const payoutBody: Record<string, unknown> = {
        account_number: process.env.RAZORPAY_X_ACCOUNT_NUMBER ?? '',
        amount,  // in paise
        currency: 'INR',
        mode: mode.toUpperCase(),  // UPI / NEFT / IMPS
        purpose: 'payout',
        narration: `ALIVE Monthly Payout ${month}`,
        fund_account: mode === 'upi' ? {
          account_type: 'vpa',
          vpa: { address: store.upiId },
          contact: {
            name: store.ownerName,
            type: 'vendor',
            reference_id: storeId,
          },
        } : {
          account_type: 'bank_account',
          bank_account: {
            name: store.bankAccountName ?? store.ownerName,
            ifsc: store.bankIfsc,
            account_number: store.bankAccountNo,
          },
          contact: {
            name: store.ownerName,
            type: 'vendor',
            reference_id: storeId,
          },
        },
      };

      const rzpRes = await fetch('https://api.razorpay.com/v1/payouts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${xKeyId}:${xKeySecret}`).toString('base64')}`,
          'X-Payout-Idempotency': `${storeId}-${month}`,
        },
        body: JSON.stringify(payoutBody),
      });
      const rzpData = await rzpRes.json() as { id?: string; status?: string; error?: { description?: string } };
      if (!rzpRes.ok) throw new Error(rzpData.error?.description ?? 'Razorpay payout failed');
      payRef  = rzpData.id ?? null;
      status  = 'paid';
      message = `Payout initiated via Razorpay: ${payRef}`;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  } else {
    // No Razorpay X — just record as pending with UPI link
    status  = 'pending';
    message = store.upiId
      ? `UPI: ${store.upiId} · ₹${amountRupees} · Add RAZORPAY_X_KEY_ID to automate`
      : `No UPI/bank details. Ask store to update their payout details.`;
  }

  // Upsert StorePayment record
  await db.$executeRaw`
    INSERT INTO "StorePayment" ("id", "storeId", "month", "amountPaise", "status", "paidAt", "payRef", "note", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${storeId}, ${month}, ${amount}, ${status}, ${status === 'paid' ? now : null}, ${payRef}, ${message}, ${now}, ${now})
    ON CONFLICT ("storeId", "month") DO UPDATE SET
      "status" = EXCLUDED."status",
      "paidAt" = EXCLUDED."paidAt",
      "payRef" = EXCLUDED."payRef",
      "note"   = EXCLUDED."note",
      "updatedAt" = NOW()
  `;

  // Build UPI deep link for manual payment (always return this as fallback)
  const upiLink = store.upiId
    ? `upi://pay?pa=${encodeURIComponent(store.upiId)}&pn=${encodeURIComponent(store.ownerName)}&am=${amountRupees}&tn=${encodeURIComponent(`ALIVE ${month}`)}&cu=INR`
    : null;

  return NextResponse.json({ ok: true, status, message, payRef, upiLink, amountRupees });
}
