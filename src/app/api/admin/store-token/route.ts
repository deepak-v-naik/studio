import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { mintStoreToken } from '@/lib/store-partner-auth';

// Admin-only: mints a signed store API token for "Open as partner"
// impersonation — store-partner routes no longer trust a bare storeId.
export async function GET(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  if (!process.env.ADMIN_PASSWORD || pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const token = mintStoreToken(store.id);
  if (!token) return NextResponse.json({ error: 'AUTH_SECRET not configured' }, { status: 500 });
  return NextResponse.json({ token });
}
