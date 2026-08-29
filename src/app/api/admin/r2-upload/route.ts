import { NextRequest, NextResponse } from 'next/server';
import { putObject, publicUrl } from '@/lib/r2';

export const maxDuration = 60; // allow up to 60s for large file uploads

function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

// POST — server-side upload (avoids browser CORS restrictions on R2)
// Body: FormData with 'file' (File) and 'key' (string) fields
export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const key  = (form.get('key') as string | null) ?? '';
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!key)  return NextResponse.json({ error: 'key required'  }, { status: 400 });

    const bytes = await file.arrayBuffer();
    await putObject(key, Buffer.from(bytes), file.type || 'application/octet-stream');

    return NextResponse.json({ publicUrl: `${publicUrl(key)}?v=${Date.now()}` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET — still available for signed URLs (used by device content upload elsewhere)
export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const key  = searchParams.get('key')  ?? '';
  const type = searchParams.get('type') ?? 'image/jpeg';
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  try {
    const { signedUploadUrl, publicUrl: pubUrl } = await import('@/lib/r2');
    const uploadUrl = await signedUploadUrl(key, type);
    return NextResponse.json({ uploadUrl, publicUrl: pubUrl(key) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
