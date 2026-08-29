// POST /api/bills/[billRef]/claim  — no auth
// Body: { phone, name }
// Returns: { token, name, phone }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import { notifyStoreWA, billClaimedMsg } from '@/lib/notify';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ billRef: string }> },
) {
  const { billRef } = await params;

  try {
    const { phone, name } = await req.json() as { phone: string; name: string };

    if (!phone?.trim() || !name?.trim()) {
      return NextResponse.json({ error: 'phone and name required' }, { status: 400 });
    }

    const bill = await db.bill.findUnique({ where: { billRef } });
    if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    // A bill may only be claimed once. Without this, anyone who can guess a
    // billRef (they are time-based and enumerable) could re-point an already
    // claimed bill onto another customer's history.
    if (bill.customerId) {
      return NextResponse.json({ error: 'This bill has already been claimed.' }, { status: 409 });
    }

    // The Customer.token is a permanent bearer credential for the whole
    // purchase history at /api/customer/bills. It must therefore NEVER be
    // returned for a customer that already exists — a phone number is not a
    // secret, so doing so would hand any caller that customer's account.
    // A new customer is safe: the caller just proved possession of an unclaimed
    // bill, and the number has no history attached to it yet.
    const existing = await db.customer.findUnique({
      where:  { phone },
      select: { id: true },
    });

    if (existing) {
      // Attach the bill so it is not lost, but issue no credential. The shopper
      // signs in on the device that already holds their token.
      await db.bill.update({ where: { billRef }, data: { customerId: existing.id } });
      return NextResponse.json({
        ok: true,
        alreadyRegistered: true,
        message: 'This bill has been added to your ALIVE account. Open it on the phone where you first registered.',
      });
    }

    const customer = await db.customer.create({
      data: { phone, name, token: randomUUID() },
    });

    const updated = await db.bill.update({
      where:   { billRef },
      data:    { customerId: customer.id },
      include: { store: { select: { whatsapp: true } } },
    });

    // Notify store owner (non-fatal)
    if (updated.store?.whatsapp) {
      void notifyStoreWA(updated.store.whatsapp, billClaimedMsg(
        updated.storeName, customer.name, customer.phone, billRef,
      ));
    }

    return NextResponse.json({ token: customer.token, name: customer.name, phone: customer.phone });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
