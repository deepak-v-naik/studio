// POST /api/admin/products/[id]/generate-video
// Renders an animated ALIVE offer video via Remotion Lambda, saves it to R2,
// creates a Content record, and optionally appends it to a playlist.
// Body: { offerText?: string; playlistId?: string }
// Returns: { content, url }

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { putObject, publicUrl } from '@/lib/r2';
import { renderOfferVideo } from '@/lib/remotion-render';

export const runtime = 'nodejs';
export const maxDuration = 120;

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const product = await db.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { offerText?: string; playlistId?: string };

  try {
    // 1. Render on Lambda — returns public S3 URL of the finished MP4
    const lambdaUrl = await renderOfferVideo({
      productName: product.productName,
      brand:       product.brand,
      sizeVariant: product.sizeVariant || undefined,
      price:       product.mrp,
      offerText:   body.offerText?.trim() || "TODAY'S OFFER",
      imageUrl:    product.imageUrl || undefined,
      accent:      '#ef4444',
    });

    // 2. Fetch MP4 bytes and copy to R2 so the player has a stable URL
    const resp = await fetch(lambdaUrl, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`Failed to download render (HTTP ${resp.status})`);
    const bytes = Buffer.from(await resp.arrayBuffer());
    const md5   = crypto.createHash('md5').update(bytes).digest('hex');

    const objectKey = `products/${id}/offer-${Date.now()}.mp4`;
    await putObject(objectKey, bytes, 'video/mp4');
    const url = publicUrl(objectKey);

    // 3. Create Content record (upsert via objectKey uniqueness — rerenders replace)
    const contentName = `${product.brand} ${product.productName} — Offer Video`;
    const content = await db.content.upsert({
      where:  { objectKey },
      create: {
        name:      contentName,
        type:      'VIDEO',
        objectKey,
        md5,
        sizeBytes: BigInt(bytes.length),
        durationMs: 8_000,   // 240 frames @ 30fps
        width:     1920,
        height:    1080,
        tags:      ['offer-video'],
        folder:    'Offer Videos',
      },
      update: { md5, sizeBytes: BigInt(bytes.length) },
    });

    // 4. Optionally append to a playlist
    if (body.playlistId) {
      const agg = await db.playlistItem.aggregate({
        where:  { playlistId: body.playlistId },
        _max:   { order: true },
      });
      const nextOrder = (agg._max.order ?? -1) + 1;
      await db.playlistItem.create({
        data: {
          playlistId: body.playlistId,
          contentId:  content.id,
          durationMs: 8_000,
          order:      nextOrder,
        },
      });
    }

    // Serialise BigInt before JSON
    return NextResponse.json({
      content: { ...content, sizeBytes: Number(content.sizeBytes) },
      url,
    });
  } catch (err) {
    const msg = (err as Error).message ?? 'Render failed';
    const status = msg.includes('not configured') ? 503 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
