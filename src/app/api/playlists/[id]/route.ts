// PATCH /api/playlists/[id]  — replace items (full replace, ordered)
// DELETE /api/playlists/[id] — delete playlist
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import { pushPlanUpdated, resolveScheduleDeviceIds } from '@/lib/fcm';

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const { name, items, transition } = await req.json() as {
      name?:       string;
      items?:      { contentId: string; durationMs: number }[];
      transition?: 'NONE' | 'FADE' | 'SLIDE';
    };

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
              playlistId: id,
              contentId:  item.contentId,
              durationMs: item.durationMs,
              order:      idx,
            })),
          });
        }
      }
    });

    const CONTENT_SELECT = {
      id: true, name: true, type: true, objectKey: true,
      md5: true, sizeBytes: true, durationMs: true, uploadedAt: true,
    };
    const updated = await db.playlist.findUnique({
      where:   { id },
      include: { items: { include: { content: { select: CONTENT_SELECT } }, orderBy: { order: 'asc' } } },
    });
    // Push plan_updated to all devices scheduled via this playlist (best-effort, non-blocking)
    if (items !== undefined || transition !== undefined) {
      db.schedule.findMany({
        where: { playlistId: id },
        select: { deviceIds: true, groupName: true, storeIds: true, cityFilter: true },
      }).then(async (schedules) => {
        const idSet = new Set<string>();
        for (const s of schedules) {
          const ids = await resolveScheduleDeviceIds({
            deviceIds:  s.deviceIds,
            groupName:  s.groupName,
            storeIds:   (s as { storeIds?: string[] }).storeIds,
            cityFilter: (s as { cityFilter?: string | null }).cityFilter,
          });
          for (const id of ids) idSet.add(id);
        }
        return pushPlanUpdated(Array.from(idSet));
      }).catch(() => {});
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
