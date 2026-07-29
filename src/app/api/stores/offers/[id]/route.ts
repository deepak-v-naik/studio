// DELETE /api/stores/offers/[id]  — soft-delete (set active=false)
// Auth: storeId (mobile app) or store session (web dashboard) — see resolveStoreId

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoreId } from '@/lib/store-partner-auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Verify ownership before deleting
  const offer = await db.storeOffer.findFirst({ where: { id, storeId } });
  if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.storeOffer.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
