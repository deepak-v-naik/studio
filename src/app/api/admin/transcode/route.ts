// POST /api/admin/transcode — kicks off background re-encode of a video Content row
// to H.264 Main@4.1 (see transcode-lambda/). Fire-and-forget: the Lambda calls back
// /api/admin/transcode-callback when done. Body: { contentId }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import { triggerTranscode } from '@/lib/transcode-lambda';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contentId } = await req.json().catch(() => ({})) as { contentId?: string };
  if (!contentId) return NextResponse.json({ error: 'contentId required' }, { status: 400 });

  try {
    const content = await db.content.findUnique({ where: { id: contentId } });
    if (!content) return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    if (content.type !== 'VIDEO') return NextResponse.json({ error: 'Only video content can be transcoded' }, { status: 400 });

    // Transcode from the preserved original when there is one — re-encoding the
    // rendition would stack generation loss.
    await triggerTranscode(contentId, publicUrl(content.originalObjectKey ?? content.objectKey));

    try {
      await db.content.update({
        where: { id: contentId },
        data:  { transcodeStatus: 'pending', transcodeError: null },
      });
    } catch {
      // Fallback: ORM fails if this DB hasn't run the transcodeStatus migration yet.
      await db.$executeRaw`UPDATE "Content" SET "transcodeStatus" = 'pending', "transcodeError" = NULL WHERE id = ${contentId}`;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
