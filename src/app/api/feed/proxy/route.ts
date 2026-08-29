// GET /api/feed/proxy?url=<rss-or-atom-url>
// Fetches an RSS/Atom feed server-side, returns normalized headlines.
// Cached in-memory for 5 min. Admin-guarded.

import { NextRequest, NextResponse } from 'next/server';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

type FeedItem = { title: string; link: string; pubDate: string | null };

const cache = new Map<string, { items: FeedItem[]; at: number }>();
const TTL_MS = 5 * 60 * 1000;

function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  // crude but robust RSS/Atom parser — pulls <item> or <entry> blocks
  const itemRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const matches = xml.match(itemRe) ?? [];

  for (const block of matches.slice(0, 30)) {
    const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM  = block.match(/<link[^>]*href="([^"]+)"/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const dateM  = block.match(/<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/i);
    const rawTitle = (titleM?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
    if (!rawTitle) continue;
    const link = (linkM?.[1] ?? '').trim();
    const date = (dateM?.[2] ?? '').trim();
    items.push({
      title:   rawTitle,
      link,
      pubDate: date || null,
    });
  }
  return items;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    new URL(url); // validate
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(url);
  if (cached && now - cached.at < TTL_MS) {
    return NextResponse.json({ items: cached.items, cached: true });
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AliveStudio/1.0 (+https://wearealive.in)' },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Feed responded ${res.status}` }, { status: 502 });
    }
    const text = await res.text();
    const items = parseRss(text);
    cache.set(url, { items, at: now });
    return NextResponse.json({ items, cached: false });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: `Couldn't fetch feed: ${msg}` }, { status: 502 });
  }
}
