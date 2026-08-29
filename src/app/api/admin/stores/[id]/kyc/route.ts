// Admin KYC review: approve or reject submitted KYC docs for a store.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { action: 'approve' | 'reject'; reason?: string };

  if (body.action === 'approve') {
    await db.$executeRaw`
      UPDATE "Store"
      SET "kycStatus" = 'approved', "kycVerifiedAt" = NOW(), "kycRejectedReason" = NULL, "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;
  } else if (body.action === 'reject') {
    await db.$executeRaw`
      UPDATE "Store"
      SET "kycStatus" = 'rejected', "kycRejectedReason" = ${body.reason ?? 'Documents need correction.'}, "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;
  } else {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
