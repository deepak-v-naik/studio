// POST /api/admin/transcode-presign — presigned R2 PUT URLs for the transcode Lambda.
//
// The Lambda has no R2 credentials of its own (they're Vercel-Sensitive env vars, so
// they can never be exported to configure it — attempting that is how it ended up with
// literal "[SENSITIVE]" strings in its env and every upload failing "Invalid URL").
// Instead it asks this route to sign each upload; the studio runtime holds the real
// creds. Auth: the same x-transcode-secret shared secret as transcode-callback.
//
// Body: { objectKey, contentType } → { uploadUrl }
// The signature covers Content-Type, so the Lambda's PUT must send the same value.

import { NextRequest, NextResponse } from 'next/server';
import { signedUploadUrl } from '@/lib/r2';

function transcodeGuard(req: NextRequest) {
  const secret = req.headers.get('x-transcode-secret') ?? '';
  return !!process.env.TRANSCODE_CALLBACK_SECRET && secret === process.env.TRANSCODE_CALLBACK_SECRET;
}

export async function POST(req: NextRequest) {
  if (!transcodeGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { objectKey?: string; contentType?: string } | null;
  const objectKey = body?.objectKey ?? '';
  // Renditions only — this secret must not become a general-purpose bucket writer.
  // The pattern is the Lambda's exact output shape (content/<cuid>-transcoded[-hevc]-
  // <epoch>.mp4). Originals are content/<uuid>.<ext>, and a UUID can never contain
  // "-transcoded-" (non-hex letters), so this can never sign an overwrite of an
  // original. Content-Type is pinned for the same reason: no hosting arbitrary
  // attacker-typed files off the public bucket domain.
  if (!/^content\/[A-Za-z0-9]+-transcoded(?:-hevc)?-\d+\.mp4$/.test(objectKey)) {
    return NextResponse.json({ error: 'objectKey must be a transcode rendition key' }, { status: 400 });
  }

  try {
    const uploadUrl = await signedUploadUrl(objectKey, 'video/mp4');
    return NextResponse.json({ uploadUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
