// One-time remediation: every existing Content row was hashed by the old,
// buggy client-side md5Hex() (content-tab.tsx), which truncated a SHA-256
// digest to 32 hex chars instead of computing a real MD5. The player's
// AssetDownloader.hashMatches() picks MD5 vs SHA-256 purely by string length
// (<=32 chars -> MD5), so it misread these as real MD5 digests and could
// never verify a download — media never became playable.
//
// The uploaded files on R2 are untouched and correct; only the stored hash
// metadata is wrong. This re-fetches each object's bytes from its existing
// public URL and recomputes the real SHA-256 (matching the fixed client),
// so no re-upload is needed.
//
// POST /api/admin/content/rehash
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';
import crypto from 'crypto';

export const maxDuration = 60;

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const items = await db.content.findMany({ select: { id: true, objectKey: true, md5: true } });

  let updated = 0;
  const failed: { id: string; objectKey: string; error: string }[] = [];

  for (const item of items) {
    try {
      const url = publicUrl(item.objectKey);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (hash !== item.md5) {
        await db.content.update({ where: { id: item.id }, data: { md5: hash } });
        updated++;
      }
    } catch (e) {
      failed.push({ id: item.id, objectKey: item.objectKey, error: (e as Error).message });
    }
  }

  return NextResponse.json({ total: items.length, updated, failed });
}
