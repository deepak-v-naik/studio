// Content library — list, initiate upload, and manage metadata.
// GET   /api/content          → { content: Content[], totalBytes }  (optional ?folder= ?tag=)
// POST  /api/content          → { id, uploadUrl, objectKey }
// PATCH /api/content          → bulk update tags/folder by id
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { signedUploadUrl, publicUrl } from '@/lib/r2';
import { randomUUID } from 'crypto';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

const BASE_CONTENT_SELECT = {
  id: true, name: true, type: true, objectKey: true,
  md5: true, sizeBytes: true, durationMs: true, uploadedAt: true,
};

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const folder = req.nextUrl.searchParams.get('folder');
    const tag    = req.nextUrl.searchParams.get('tag');

    // Fetch base rows without tags/folder (columns may not exist yet in DB)
    const rows = await db.content.findMany({
      select: BASE_CONTENT_SELECT,
      orderBy: { uploadedAt: 'desc' },
    });

    // Attempt to fetch tags/folder/transcodeStatus separately — safe to fail
    type TagRow = { id: string; tags: string[]; folder: string | null; transcodeStatus: string | null; transcodeError: string | null };
    let tagMap = new Map<string, TagRow>();
    try {
      const tagRows = await db.$queryRaw<TagRow[]>`
        SELECT id, tags, folder, "transcodeStatus", "transcodeError" FROM "Content"
      `;
      tagMap = new Map(tagRows.map((r) => [r.id, r]));
    } catch { /* columns not yet migrated — tags/folder/transcodeStatus will be empty */ }

    // Filter by folder/tag if requested (post-query, since WHERE may fail without columns)
    const filtered = rows.filter((c) => {
      const extra = tagMap.get(c.id);
      if (folder && extra?.folder !== folder) return false;
      if (tag    && !(extra?.tags ?? []).includes(tag)) return false;
      return true;
    });

    const totalBytes = filtered.reduce((s, c) => s + Number(c.sizeBytes), 0);
    const content = filtered.map((c) => {
      const extra = tagMap.get(c.id);
      return {
        id:         c.id,
        name:       c.name,
        type:       c.type.toLowerCase() as 'image' | 'video',
        objectKey:  c.objectKey,
        url:        publicUrl(c.objectKey),
        md5:        c.md5,
        sizeBytes:  Number(c.sizeBytes),
        durationMs: c.durationMs ?? undefined,
        createdAt:  c.uploadedAt.toISOString(),
        tags:       extra?.tags ?? [],
        folder:     extra?.folder ?? undefined,
        transcodeStatus: (extra?.transcodeStatus as 'pending' | 'done' | 'error' | null) ?? undefined,
        transcodeError:  extra?.transcodeError ?? undefined,
      };
    });
    return NextResponse.json({ content, totalBytes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { name, type, sizeBytes, md5, durationMs, mimeType } = await req.json() as {
      name: string;
      type: 'image' | 'video';
      sizeBytes: number;
      md5: string;
      durationMs?: number;
      mimeType?: string;
    };
    if (!name || !type || !sizeBytes || !md5) {
      return NextResponse.json({ error: 'name, type, sizeBytes, md5 required' }, { status: 400 });
    }

    const MIME_TO_EXT: Record<string, string> = {
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    };
    const ext         = MIME_TO_EXT[mimeType ?? ''] ?? (type === 'video' ? 'mp4' : 'jpg');
    const contentType = mimeType ?? (type === 'video' ? 'video/mp4' : 'image/jpeg');
    const objectKey   = `content/${randomUUID()}.${ext}`;
    const dbType      = type === 'video' ? 'VIDEO' : 'IMAGE';

    const uploadUrl = await signedUploadUrl(objectKey, contentType, 900);

    const content = await db.content.create({
      data: { name, type: dbType, objectKey, md5, sizeBytes, durationMs: durationMs ?? null },
    });

    return NextResponse.json({ id: content.id, uploadUrl, objectKey });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, tags, folder } = await req.json() as { id: string; tags?: string[]; folder?: string | null };
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    try {
      const updated = await db.content.update({
        where: { id },
        data: {
          ...(tags   !== undefined ? { tags }   : {}),
          ...(folder !== undefined ? { folder } : {}),
        },
      });
      return NextResponse.json({ id: updated.id, tags: (updated as { tags?: string[] }).tags ?? [], folder: (updated as { folder?: string | null }).folder ?? null });
    } catch {
      // Fallback: update via raw SQL if ORM fails on missing column
      if (tags !== undefined) {
        await db.$executeRaw`UPDATE "Content" SET tags = ${tags}::text[] WHERE id = ${id}`;
      }
      if (folder !== undefined) {
        await db.$executeRaw`UPDATE "Content" SET folder = ${folder} WHERE id = ${id}`;
      }
      return NextResponse.json({ id, tags: tags ?? [], folder: folder ?? null });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
