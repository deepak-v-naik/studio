// Playlist CRUD.
// GET  /api/playlists   → { playlists: Playlist[] }
// POST /api/playlists   → { playlist: Playlist }   body: { name, items?: { contentId, durationMs }[] }
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePlaylist(pl: any) {
  return {
    ...pl,
    createdAt: (pl.createdAt as Date).toISOString(),
    items: (pl.items ?? []).map((item: any) => ({
      ...item,
      content: {
        id:         item.content.id,
        name:       item.content.name,
        type:       (item.content.type as string).toLowerCase() as 'image' | 'video',
        objectKey:  item.content.objectKey,
        url:        publicUrl(item.content.objectKey as string),
        md5:        item.content.md5,
        sizeBytes:  Number(item.content.sizeBytes),
        durationMs: item.content.durationMs ?? undefined,
        createdAt:  (item.content.uploadedAt as Date).toISOString(),
      },
    })),
  };
}

const CONTENT_SELECT = {
  id: true, name: true, type: true, objectKey: true,
  md5: true, sizeBytes: true, durationMs: true, uploadedAt: true,
};

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = await db.playlist.findMany({
      include: { items: { include: { content: { select: CONTENT_SELECT } }, orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ playlists: rows.map(normalizePlaylist) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { name, items = [], transition } = await req.json() as {
      name: string;
      items?: { contentId: string; durationMs: number }[];
      transition?: 'NONE' | 'FADE' | 'SLIDE';
    };
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const playlist = await db.playlist.create({
      data: {
        name: name.trim(),
        transition: transition ?? 'NONE',
        items: {
          create: items.map((item, idx) => ({
            contentId:  item.contentId,
            durationMs: item.durationMs,
            order:      idx,
          })),
        },
      },
      include: { items: { include: { content: { select: CONTENT_SELECT } }, orderBy: { order: 'asc' } } },
    });

    return NextResponse.json({ playlist: normalizePlaylist(playlist) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
