// DELETE /api/content/[id]  — remove from DB and R2
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteObject } from '@/lib/r2';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const content = await db.content.findUnique({ where: { id } });
    if (!content) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.content.delete({ where: { id } });
    // Best-effort R2 delete — current rendition, preserved original, HEVC rendition.
    await deleteObject(content.objectKey).catch(() => {});
    if (content.originalObjectKey && content.originalObjectKey !== content.objectKey) {
      await deleteObject(content.originalObjectKey).catch(() => {});
    }
    if (content.hevcObjectKey) await deleteObject(content.hevcObjectKey).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
