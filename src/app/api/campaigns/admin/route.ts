import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  if (process.env.ADMIN_PASSWORD && pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const campaigns = await db.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { brand: { select: { id: true, brandName: true, trialOfferedAt: true, trialUsedAt: true } } },
    });

    // Resolve map-picked store ids to names for ops — unknown ids drop out.
    // Capped + chunked: campaigns/save is unauthenticated, so junk ids can pile
    // up across rows; never let attacker-controlled input form one giant IN().
    const pickedIds = [...new Set(campaigns.flatMap((c) => c.preferredStoreIds))].slice(0, 3000);
    const storeById = new Map<string, { id: string; storeName: string; locality: string | null }>();
    for (let i = 0; i < pickedIds.length; i += 500) {
      const batch = await db.store.findMany({
        where: { id: { in: pickedIds.slice(i, i + 500) } },
        select: { id: true, storeName: true, locality: true },
      });
      for (const s of batch) storeById.set(s.id, s);
    }

    const result = campaigns.map((c) => ({
      id:              c.id,
      brandId:         c.brand?.id ?? null,
      brandName:       c.brand?.brandName ?? c.name.split(' — ')[0],
      contactName:     c.contactName,
      email:           c.email,
      phone:           c.phone,
      screens:         c.screens,
      months:          c.months,
      startDate:       c.startDate.toISOString(),
      pricePerScreen:  c.pricePerScreen,
      totalAmount:     c.totalAmount,
      paymentId:       c.paymentId,
      orderId:         c.orderId ?? null,
      status:          c.status,
      createdAt:       c.createdAt.toISOString(),
      // Slot-loop 10s creative — a booked campaign without one can't render in a slot
      // (its positions fall through to bonus/filler redistribution).
      slotContentId:   c.slotContentId,
      // Brand's map picks — routing hint for slot assignment, not a reservation.
      preferredStores: c.preferredStoreIds
        .map((id) => storeById.get(id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ id: s.id, storeName: s.storeName, locality: s.locality })),
      trialOfferedAt:  c.brand?.trialOfferedAt?.toISOString() ?? null,
      trialUsedAt:     c.brand?.trialUsedAt?.toISOString()    ?? null,
    }));

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
