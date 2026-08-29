import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}
function checkAdmin(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const kv = getRedis();
  const media = kv ? ((await kv.get<Record<string, string>>('site:media')) ?? {}) : {};
  return NextResponse.json(media);
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { slot, url } = await req.json() as { slot: string; url: string };
  if (!slot || url === undefined) return NextResponse.json({ error: 'slot and url required' }, { status: 400 });
  const kv = getRedis();
  if (kv) {
    const existing = (await kv.get<Record<string, string>>('site:media')) ?? {};
    if (url === '') {
      const updated = { ...existing };
      delete updated[slot];
      await kv.set('site:media', updated);
    } else {
      await kv.set('site:media', { ...existing, [slot]: url });
    }
  }
  return NextResponse.json({ ok: true });
}
