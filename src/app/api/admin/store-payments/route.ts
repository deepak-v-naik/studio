import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

// GET — list all store payments with store info
export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('storeId');

  try {
    const where = storeId ? { storeId } : {};
    const payments = await db.storePayment.findMany({
      where,
      include: { store: { select: { storeName: true, ownerName: true, whatsapp: true, city: true, upiId: true, payoutMethod: true, liveAt: true } } },
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(payments);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST — upsert a payment record (mark paid, pending, skipped)
export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as {
      storeId: string; month: string; status: string;
      amountPaise?: number; paidAt?: string; paidBy?: string; payRef?: string; note?: string;
    };
    if (!body.storeId || !body.month || !body.status) {
      return NextResponse.json({ error: 'storeId, month, status required' }, { status: 400 });
    }

    const payment = await db.storePayment.upsert({
      where: { storeId_month: { storeId: body.storeId, month: body.month } },
      create: {
        storeId: body.storeId,
        month:   body.month,
        status:  body.status,
        amountPaise: body.amountPaise ?? 50000,
        paidAt:  body.paidAt ? new Date(body.paidAt) : (body.status === 'paid' ? new Date() : null),
        paidBy:  body.paidBy ?? null,
        payRef:  body.payRef ?? null,
        note:    body.note ?? null,
      },
      update: {
        status:  body.status,
        amountPaise: body.amountPaise ?? 50000,
        paidAt:  body.paidAt ? new Date(body.paidAt) : (body.status === 'paid' ? new Date() : undefined),
        paidBy:  body.paidBy ?? null,
        payRef:  body.payRef ?? null,
        note:    body.note ?? null,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(payment);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
