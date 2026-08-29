// Playlist CRUD.
// GET  /api/playlists   → { playlists: Playlist[] }
// POST /api/playlists   → { playlist: Playlist }
//   body: { name, items?: { contentId? | childPlaylistId?, durationMs }[] }
//   (childPlaylistId nests another playlist — SMIL Master → Internal; validated in
//    lib/playlist-nesting.ts: XOR target, no cycles, max depth 3)
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import { validateNesting, type PlaylistItemInput } from '@/lib/playlist-nesting';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePlaylist(pl: any) {
  return {
    ...pl,
    createdAt: (pl.createdAt as Date).toISOString(),
    items: (pl.items ?? []).map((item: any) => ({
      ...item,
      content: item.content ? {
        id:         item.content.id,
        name:       item.content.name,
        type:       (item.content.type as string).toLowerCase() as 'image' | 'video',
        objectKey:  item.content.objectKey,
        url:        publicUrl(item.content.objectKey as string),
        md5:        item.content.md5,
        sizeBytes:  Number(item.content.sizeBytes),
        durationMs: item.content.durationMs ?? undefined,
        width:      item.content.width ?? undefined,
        height:     item.content.height ?? undefined,
        createdAt:  (item.content.uploadedAt as Date).toISOString(),
      } : null,
      childPlaylist: item.childPlaylist ?? null,
    })),
  };
}

const CONTENT_SELECT = {
  id: true, name: true, type: true, objectKey: true,
  md5: true, sizeBytes: true, durationMs: true, uploadedAt: true,
  width: true, height: true,
};

const ITEMS_INCLUDE = {
  items: {
    include: {
      content:       { select: CONTENT_SELECT },
      childPlaylist: { select: { id: true, name: true } },
    },
    orderBy: { order: 'asc' as const },
  },
};

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = await db.playlist.findMany({
      include: ITEMS_INCLUDE,
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
      items?: PlaylistItemInput[];
      transition?: 'NONE' | 'FADE' | 'SLIDE';
    };
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    // '__new__' placeholder: a not-yet-created playlist can't self-reference or close a
    // cycle, but its nested chain must still respect the depth cap.
    const nestingError = await validateNesting('__new__', items);
    if (nestingError) return NextResponse.json({ error: nestingError }, { status: 400 });

    const playlist = await db.playlist.create({
      data: {
        name: name.trim(),
        transition: transition ?? 'NONE',
        items: {
          create: items.map((item, idx) => ({
            contentId:       item.contentId ?? null,
            childPlaylistId: item.childPlaylistId ?? null,
            durationMs:      item.durationMs,
            order:           idx,
          })),
        },
      },
      include: ITEMS_INCLUDE,
    });

    return NextResponse.json({ playlist: normalizePlaylist(playlist) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
