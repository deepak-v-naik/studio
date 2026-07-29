import { NextRequest, NextResponse } from 'next/server';
import { putObject, publicUrl } from '@/lib/r2';
import { resolveStoreId } from '@/lib/store-partner-auth';
import crypto from 'crypto';

export const maxDuration = 30;

// POST — store partner image upload for product photos / offer images / KYC docs
// Body: FormData with 'file' (File) and, from the mobile app, 'storeId'. Max 4 MB.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const storeId = await resolveStoreId((form.get('storeId') as string | null) ?? req.nextUrl.searchParams.get('storeId'));
    if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const MAX_BYTES = 4 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max 4 MB.` }, { status: 413 });
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, WebP, or GIF images allowed.' }, { status: 400 });
    }

    const ext     = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const key     = `stores/${storeId}/${crypto.randomUUID()}.${ext}`;
    const bytes   = await file.arrayBuffer();
    await putObject(key, Buffer.from(bytes), file.type);

    return NextResponse.json({ url: publicUrl(key) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
