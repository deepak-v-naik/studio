// POST /api/admin/transcode-callback — called by the transcode Lambda (transcode-lambda/)
// when a re-encode finishes (or fails). Not admin-password gated (the Lambda has no
// admin session) — authenticated instead via a shared secret header, since this
// endpoint can overwrite a Content row's objectKey/md5.
//
// Body (success): { contentId, status: 'done', objectKey, md5, sizeBytes, durationMs, width?, height?,
//                    hevcObjectKey?, hevcMd5?, hevcSizeBytes? }
// Body (failure): { contentId, status: 'error', message }
//
// hevc* fields are present only when the Lambda's best-effort HEVC pass succeeded —
// absent means this content has no HEVC rendition (yet).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function transcodeGuard(req: NextRequest) {
  const secret = req.headers.get('x-transcode-secret') ?? '';
  return !!process.env.TRANSCODE_CALLBACK_SECRET && secret === process.env.TRANSCODE_CALLBACK_SECRET;
}

type Body =
  | {
      contentId: string; status: 'done'; objectKey: string; md5: string; sizeBytes: number;
      durationMs?: number; width?: number; height?: number;
      hevcObjectKey?: string; hevcMd5?: string; hevcSizeBytes?: number;
    }
  | { contentId: string; status: 'error'; message: string };

export async function POST(req: NextRequest) {
  if (!transcodeGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as Body | null;
  if (!body?.contentId) return NextResponse.json({ error: 'contentId required' }, { status: 400 });

  try {
    if (body.status === 'error') {
      try {
        await db.content.update({
          where: { id: body.contentId },
          data:  { transcodeStatus: 'error', transcodeError: body.message },
        });
      } catch {
        await db.$executeRaw`UPDATE "Content" SET "transcodeStatus" = 'error', "transcodeError" = ${body.message} WHERE id = ${body.contentId}`;
      }
      return NextResponse.json({ ok: true });
    }

    try {
      await db.content.update({
        where: { id: body.contentId },
        data: {
          objectKey:       body.objectKey,
          md5:             body.md5,
          sizeBytes:       body.sizeBytes,
          durationMs:      body.durationMs ?? undefined,
          width:           body.width ?? undefined,
          height:          body.height ?? undefined,
          transcodeStatus: 'done',
          transcodeError:  null,
          hevcObjectKey:   body.hevcObjectKey ?? undefined,
          hevcMd5:         body.hevcMd5 ?? undefined,
          hevcSizeBytes:   body.hevcSizeBytes ?? undefined,
        },
      });
    } catch {
      await db.$executeRaw`
        UPDATE "Content"
        SET "objectKey" = ${body.objectKey}, md5 = ${body.md5}, "sizeBytes" = ${body.sizeBytes},
            "durationMs" = ${body.durationMs ?? null}, width = ${body.width ?? null}, height = ${body.height ?? null},
            "transcodeStatus" = 'done', "transcodeError" = NULL,
            "hevcObjectKey" = ${body.hevcObjectKey ?? null}, "hevcMd5" = ${body.hevcMd5 ?? null},
            "hevcSizeBytes" = ${body.hevcSizeBytes ?? null}
        WHERE id = ${body.contentId}
      `;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
