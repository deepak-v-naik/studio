// PATCH /api/playlists/[id]  — replace items (full replace, ordered)
// DELETE /api/playlists/[id] — delete playlist
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import { pushPlanUpdated, resolveScheduleDeviceIds } from '@/lib/fcm';
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const { name, items, transition } = await req.json() as {
      name?:       string;
      items?:      PlaylistItemInput[];
      transition?: 'NONE' | 'FADE' | 'SLIDE';
    };

    if (items !== undefined) {
      const nestingError = await validateNesting(id, items);
      if (nestingError) return NextResponse.json({ error: nestingError }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      if (name?.trim() || transition) {
        await tx.playlist.update({
          where: { id },
          data: {
            ...(name?.trim() ? { name: name.trim() } : {}),
            ...(transition   ? { transition }         : {}),
          },
        });
      }
      if (items !== undefined) {
        await tx.playlistItem.deleteMany({ where: { playlistId: id } });
        if (items.length) {
          await tx.playlistItem.createMany({
            data: items.map((item, idx) => ({
              playlistId:      id,
              contentId:       item.contentId ?? null,
              childPlaylistId: item.childPlaylistId ?? null,
              durationMs:      item.durationMs,
              order:           idx,
            })),
          });
        }
      }
    });

    const CONTENT_SELECT = {
      id: true, name: true, type: true, objectKey: true,
      md5: true, sizeBytes: true, durationMs: true, uploadedAt: true,
      width: true, height: true,
    };
    const updated = await db.playlist.findUnique({
      where:   { id },
      include: {
        items: {
          include: {
            content:       { select: CONTENT_SELECT },
            childPlaylist: { select: { id: true, name: true } },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    // Push plan_updated to all devices scheduled via this playlist — including
    // schedules that reach it through NESTING (best-effort, non-blocking). A child
    // playlist is flattened into its parents at plan time, so editing it changes
    // plans served for schedules that only reference a parent; matching on the
    // edited id alone missed those entirely. Walk up the parent chain (max nesting
    // depth 3, cycles rejected at write time) and match schedules on the whole set.
    if (items !== undefined || transition !== undefined) {
      (async () => {
        const affected = new Set<string>([id]);
        let frontier = [id];
        for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
          const parents = await db.playlistItem.findMany({
            where:  { childPlaylistId: { in: frontier } },
            select: { playlistId: true },
          });
          frontier = parents.map((p) => p.playlistId).filter((p) => !affected.has(p));
          frontier.forEach((p) => affected.add(p));
        }
        const schedules = await db.schedule.findMany({
          where: { playlistId: { in: Array.from(affected) } },
          select: { deviceIds: true, groupName: true, storeIds: true, cityFilter: true },
        });
        const idSet = new Set<string>();
        for (const s of schedules) {
          const ids = await resolveScheduleDeviceIds({
            deviceIds:  s.deviceIds,
            groupName:  s.groupName,
            storeIds:   (s as { storeIds?: string[] }).storeIds,
            cityFilter: (s as { cityFilter?: string | null }).cityFilter,
          });
          for (const did of ids) idSet.add(did);
        }
        return pushPlanUpdated(Array.from(idSet));
      })().catch(() => {});
    }

    return NextResponse.json({ playlist: updated ? normalizePlaylist(updated) : null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await db.playlist.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
