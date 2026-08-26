import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteObject, putObject, publicUrl } from '@/lib/r2';
import { resolveStoreId } from '@/lib/store-partner-auth';
import crypto from 'crypto';

/** R2 object key for a stored verification-photo URL, or null if it isn't one. */
function verificationKeyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const prefix = publicUrl('');
  if (!prefix || !url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return key.startsWith('verification/') ? key : null;
}

export const maxDuration = 30;

// POST /api/stores/verification-photo — GPS-verified onboarding photo upload.
// Auth: storeId (form field or ?storeId=, mobile-style) or next-auth session (web).
//
// FormData fields:
//   file    File     required — JPEG/PNG/WebP, max 4 MB (client downscales larger)
//   kind    string   required — 'shop' (storefront, gates Team verification)
//                               | 'install' (installed TV, gates Site visit & install)
//   lat/lng string   required — decimal degrees; from the photo's EXIF GPS when
//                               present, else the device's geolocation at upload
//   source  string   required — 'exif' | 'device' (which of the two provided them)
//
// The coordinates are stored alongside the image URL on the Store row and shown
// in the admin panel next to the registered map pin, so the team can verify the
// photo was really taken at the shop before advancing the onboarding stage —
// /api/admin/stores/[id] refuses to advance past 'new' without a shop photo and
// past 'contacted' without an install photo.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const kind = form.get('kind') as string | null;
    const lat  = Number(form.get('lat'));
    const lng  = Number(form.get('lng'));
    const source = (form.get('source') as string | null) ?? 'device';
    // Optional, install photo only: the TV number / ID pin marked on the unit,
    // captured at the moment the installed screen is photographed. Ops can
    // correct it later from the admin panel.
    const tvTagRaw = (form.get('tvTag') as string | null) ?? '';
    const tvTag = tvTagRaw.trim().slice(0, 40) || null;

    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (kind !== 'shop' && kind !== 'install') {
      return NextResponse.json({ error: "kind must be 'shop' or 'install'" }, { status: 400 });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      return NextResponse.json({ error: 'Valid GPS coordinates are required. Enable location and try again.' }, { status: 400 });
    }
    if (source !== 'exif' && source !== 'device') {
      return NextResponse.json({ error: "source must be 'exif' or 'device'" }, { status: 400 });
    }

    const storeId = await resolveStoreId((form.get('storeId') as string | null) ?? req.nextUrl.searchParams.get('storeId'));
    if (!storeId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const MAX_BYTES = 4 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max 4 MB.` }, { status: 413 });
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images allowed.' }, { status: 400 });
    }

    const ext   = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const key   = `verification/${storeId}/${kind}-${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();

    // Remember the photo being replaced (if any) so its R2 object can be
    // removed once the new one is committed — otherwise re-uploads orphan
    // objects in the bucket forever.
    let oldKey: string | null = null;
    try {
      const col  = kind === 'shop' ? 'shopPhotoUrl' : 'installPhotoUrl';
      const prev = await db.$queryRawUnsafe<{ url: string | null }[]>(
        `SELECT "${col}" AS url FROM "Store" WHERE "id" = $1 LIMIT 1`, storeId,
      );
      oldKey = verificationKeyFromUrl(prev[0]?.url ?? null);
    } catch { /* columns not yet migrated — nothing to replace */ }

    await putObject(key, Buffer.from(bytes), file.type);
    const url = publicUrl(key);

    // Raw UPDATE with explicit columns, matching the KYC route's schema-drift
    // tolerance: on a DB where the migration hasn't run yet this fails cleanly
    // without touching the row (the just-uploaded object is removed below).
    const now = new Date();
    try {
      if (kind === 'shop') {
        await db.$executeRaw`
          UPDATE "Store" SET
            "shopPhotoUrl" = ${url}, "shopPhotoLat" = ${lat}, "shopPhotoLng" = ${lng},
            "shopPhotoSource" = ${source}, "shopPhotoAt" = ${now}, "updatedAt" = ${now}
          WHERE "id" = ${storeId}
        `;
      } else {
        await db.$executeRaw`
          UPDATE "Store" SET
            "installPhotoUrl" = ${url}, "installPhotoLat" = ${lat}, "installPhotoLng" = ${lng},
            "installPhotoSource" = ${source}, "installPhotoAt" = ${now}, "updatedAt" = ${now}
          WHERE "id" = ${storeId}
        `;
        // TV number is written separately and only when supplied, so an app that
        // doesn't send it can never blank a tag ops already recorded. Tolerated
        // if the hardware columns aren't migrated yet — the photo still counts.
        if (tvTag) {
          try {
            await db.$executeRaw`
              UPDATE "Store" SET "tvTag" = ${tvTag}, "updatedAt" = ${now} WHERE "id" = ${storeId}
            `;
          } catch (e) {
            console.error('verification-photo: tvTag not stored:', (e as Error).message.slice(0, 120));
          }
        }
      }
    } catch (e) {
      // DB write failed — don't leave the fresh object orphaned in R2.
      await deleteObject(key).catch(() => { /* best-effort */ });
      throw e;
    }

    if (oldKey && oldKey !== key) await deleteObject(oldKey).catch(() => { /* best-effort */ });

    return NextResponse.json({ ok: true, url, lat, lng, source });
  } catch (e) {
    // Never surface raw DB/R2 error text to partners (env-var names, SQL
    // column errors); log it server-side instead.
    console.error('verification-photo upload failed:', (e as Error).message);
    return NextResponse.json({ error: 'Upload failed on our side. Please try again in a moment.' }, { status: 500 });
  }
}
