// POST /api/payout-claim — store partner requests monthly payout
// Auth: storeId (mobile app) or store session (web dashboard) — see resolveStoreId
// Logs to AuditLog + notifies admin via WhatsApp

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { notifyAdminWA, payoutClaimMsg } from '@/lib/notify';
import { withApiHandler } from '@/lib/with-api-handler';
import { resolveStoreId } from '@/lib/store-partner-auth';

export const POST = withApiHandler('/api/payout-claim', 'user', async (req: NextRequest) => {
  const { month, storeId: bodyStoreId } = await req.json() as { month?: string; storeId?: string };

  const storeId = await resolveStoreId(bodyStoreId);
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const store = await db.store.findUnique({
    where:   { id: storeId },
    include: { user: { select: { phone: true } } },
  });
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const claimMonth = month ?? new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const monthlyRupees = Math.round((store.monthlyCompensationPaise ?? 50000) / 100);

  await db.auditLog.create({
    data: {
      actorId: store.userId,
      action:  'PAYOUT_CLAIM',
      target:  store.id,
      meta:    { storeName: store.storeName, month: claimMonth, amount: `₹${monthlyRupees.toLocaleString('en-IN')} + electricity` },
    },
  });

  void notifyAdminWA(payoutClaimMsg({
    storeName: store.storeName,
    ownerName: store.ownerName,
    phone:     store.user?.phone ?? store.whatsapp,
    month:     claimMonth,
  }));

  return NextResponse.json({ ok: true, month: claimMonth });
});
