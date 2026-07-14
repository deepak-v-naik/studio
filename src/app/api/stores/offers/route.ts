// GET  /api/stores/offers  — list my store's offers
// POST /api/stores/offers  — create an offer
// Auth: storeId (mobile app) or store session (web dashboard) — see resolveStoreId

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withApiHandler } from '@/lib/with-api-handler';
import { resolveStoreId } from '@/lib/store-partner-auth';

export const GET = withApiHandler('/api/stores/offers', 'user', async (req: NextRequest) => {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const offers = await db.storeOffer.findMany({
    where:   { storeId, active: true },
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { imageUrl: true, id: true } } },
  });

  return NextResponse.json(offers.map((o) => ({
    ...o,
    imageUrl:   o.product?.imageUrl ?? null,
    createdAt:  o.createdAt.toISOString(),
    updatedAt:  o.updatedAt.toISOString(),
    validUntil: o.validUntil?.toISOString() ?? null,
  })));
});

export const POST = withApiHandler('/api/stores/offers', 'user', async (req: NextRequest) => {
  const { productName, weight, mrp, offerPrice, validUntil, productId, storeId: bodyStoreId } = await req.json() as {
    productName: string; weight?: string; productId?: string;
    mrp: number; offerPrice: number; validUntil?: string; storeId?: string;
  };

  const storeId = await resolveStoreId(bodyStoreId);
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!productName?.trim()) return NextResponse.json({ error: 'Product name required' }, { status: 400 });
  if (!mrp || !offerPrice)  return NextResponse.json({ error: 'MRP and offer price required' }, { status: 400 });
  if (offerPrice >= mrp)    return NextResponse.json({ error: 'Offer price must be less than MRP' }, { status: 400 });

  const offer = await db.storeOffer.create({
    data: {
      storeId,
      productName: productName.trim(),
      weight:      weight?.trim() || null,
      mrp:         Math.round(mrp),
      offerPrice:  Math.round(offerPrice),
      validUntil:  validUntil ? new Date(validUntil) : null,
      productId:   productId || null,
    },
  });

  return NextResponse.json({
    ...offer,
    createdAt:  offer.createdAt.toISOString(),
    updatedAt:  offer.updatedAt.toISOString(),
    validUntil: offer.validUntil?.toISOString() ?? null,
  });
});
