// Manual KYC for store partners.
// GET   — current status + doc URLs
// POST  — submit uploaded doc URLs + Aadhaar last 4 digits for admin review

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoreId } from '@/lib/store-partner-auth';

export async function GET(req: NextRequest) {
  const storeId = await resolveStoreId(req.nextUrl.searchParams.get('storeId'));
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db.$queryRaw<{
    kycStatus: string | null; kycPanUrl: string | null; kycAadhaarUrl: string | null;
    kycSelfieUrl: string | null; kycAadhaarLast4: string | null;
    kycSubmittedAt: Date | null; kycVerifiedAt: Date | null; kycRejectedReason: string | null;
  }[]>`
    SELECT "kycStatus", "kycPanUrl", "kycAadhaarUrl", "kycSelfieUrl",
           "kycAadhaarLast4", "kycSubmittedAt", "kycVerifiedAt", "kycRejectedReason"
    FROM "Store" WHERE "id" = ${storeId} LIMIT 1
  `.catch(() => []);

  const r = rows[0];
  return NextResponse.json({
    status:          r?.kycStatus ?? 'not_started',
    panUrl:          r?.kycPanUrl ?? null,
    aadhaarUrl:      r?.kycAadhaarUrl ?? null,
    selfieUrl:       r?.kycSelfieUrl ?? null,
    aadhaarLast4:    r?.kycAadhaarLast4 ?? null,
    submittedAt:     r?.kycSubmittedAt instanceof Date ? r.kycSubmittedAt.toISOString() : null,
    verifiedAt:      r?.kycVerifiedAt  instanceof Date ? r.kycVerifiedAt.toISOString()  : null,
    rejectedReason:  r?.kycRejectedReason ?? null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    storeId?: string;
    panUrl?: string; aadhaarUrl?: string; selfieUrl?: string; aadhaarLast4?: string;
  };

  const storeId = await resolveStoreId(body.storeId);
  if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!body.panUrl || !body.aadhaarUrl || !body.selfieUrl) {
    return NextResponse.json({ error: 'PAN, Aadhaar and selfie are all required.' }, { status: 400 });
  }
  if (body.aadhaarLast4 && !/^\d{4}$/.test(body.aadhaarLast4)) {
    return NextResponse.json({ error: 'Aadhaar last 4 must be 4 digits.' }, { status: 400 });
  }

  await db.$executeRaw`
    UPDATE "Store"
    SET "kycStatus"        = 'submitted',
        "kycPanUrl"        = ${body.panUrl},
        "kycAadhaarUrl"    = ${body.aadhaarUrl},
        "kycSelfieUrl"     = ${body.selfieUrl},
        "kycAadhaarLast4"  = ${body.aadhaarLast4 ?? null},
        "kycSubmittedAt"   = NOW(),
        "kycRejectedReason" = NULL,
        "updatedAt"        = NOW()
    WHERE "id" = ${storeId}
  `;

  return NextResponse.json({ ok: true });
}
