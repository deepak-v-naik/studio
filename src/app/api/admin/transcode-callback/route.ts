// POST /api/admin/transcode-callback — called by the transcode Lambda (transcode-lambda/)
// when a re-encode finishes (or fails). Not admin-password gated (the Lambda has no
// admin session) — authenticated instead via a shared secret header, since this
// endpoint can rewrite a Content row's rendition pointers.
//
// Body (success): { contentId, status: 'done', objectKey, md5, sizeBytes, durationMs, width?, height?,
//                    hevcObjectKey?, hevcMd5?, hevcSizeBytes? }
// Body (failure): { contentId, status: 'error', message }
//
// The success body's objectKey/md5/sizeBytes describe the H.264 rendition. As the
// pipeline has always done, they OVERWRITE the row's objectKey/md5/sizeBytes — keeping
// that legacy shape means a Vercel rollback to pre-rendition code still serves the safe
// file everywhere. What's new: the pre-overwrite original is snapshotted into the
// original* columns first (COALESCE — a re-transcode never clobbers a real original),
// and the plan API serves it to Device.playsOriginal screens. hevc* fields are present
// only when the Lambda's best-effort HEVC pass succeeded — absent means this content
// has no HEVC rendition (yet).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pushPlanUpdated } from '@/lib/fcm';

function transcodeGuard(req: NextRequest) {
  const secret = req.headers.get('x-transcode-secret') ?? '';
  return !!process.env.TRANSCODE_CALLBACK_SECRET && secret === process.env.TRANSCODE_CALLBACK_SECRET;
}

// The Lambda only ever mints keys of this shape. Rejecting anything else keeps a
// leaked transcode secret from pointing rows at arbitrary bucket objects (the presign
// route enforces the same shape on upload, so both halves must agree).
const RENDITION_KEY = /^content\/[A-Za-z0-9]+-transcoded(?:-hevc)?-\d+\.mp4$/;

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

    if (!RENDITION_KEY.test(body.objectKey) || (body.hevcObjectKey && !RENDITION_KEY.test(body.hevcObjectKey))) {
      return NextResponse.json({ error: 'objectKey must be a transcode rendition key' }, { status: 400 });
    }

    // Single atomic statement: Postgres evaluates every RHS against the OLD row, so
    // COALESCE("originalObjectKey", "objectKey") snapshots the pre-overwrite original
    // even though objectKey is replaced in the same UPDATE. On legacy rows whose
    // original was overwritten before the original* columns existed, this records the
    // old rendition instead — harmless, it's what those screens were playing anyway.
    await db.$executeRaw`
      UPDATE "Content"
      SET "originalObjectKey" = COALESCE("originalObjectKey", "objectKey"),
          "originalMd5"       = COALESCE("originalMd5", "md5"),
          "originalSizeBytes" = COALESCE("originalSizeBytes", "sizeBytes"),
          "objectKey" = ${body.objectKey}, "md5" = ${body.md5}, "sizeBytes" = ${body.sizeBytes},
          "durationMs" = ${body.durationMs ?? null}, width = ${body.width ?? null}, height = ${body.height ?? null},
          "transcodeStatus" = 'done', "transcodeError" = NULL,
          "hevcObjectKey" = ${body.hevcObjectKey ?? null}, "hevcMd5" = ${body.hevcMd5 ?? null},
          "hevcSizeBytes" = ${body.hevcSizeBytes ?? null}
      WHERE id = ${body.contentId}
    `;

    // The rendition swap changed objectKey/md5, which changes every plan that
    // includes this content — without a push, screens keep playing (or failing on)
    // the original until their next 15-min poll. Empty target list = fleet-topic
    // broadcast only (see pushCommand); resolving exactly which schedules embed
    // this content through nested playlists isn't worth the precision at fleet
    // scale, and unaffected players refetch, see an unchanged planHash, and no-op.
    pushPlanUpdated([]).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
