import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { resolveStoreId } from '@/lib/store-partner-auth';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Flyer = {
  id:          string;
  storeId?:    string;
  storeName:   string;
  title:       string;
  description: string;
  validUntil:  string;
  imageBase64: string;
  createdAt:   string;
};

// ─── Redis ───────────────────────────────────────────────────────────────────

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

const INDEX_KEY = 'flyers:index'; // string[] of IDs — no images, stays tiny

// ─── POST — save a flyer ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Omit<Flyer, 'id' | 'createdAt'>;

    // Two callers: the admin panel (admin-password header) uploading on a store's
    // behalf, and the store partner app (storeId — no session, same as every other
    // store-partner route, see resolveStoreId).
    const pw = req.headers.get('admin-password') ?? '';
    const isAdmin = !process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD;
    const storeId = isAdmin ? null : await resolveStoreId(body.storeId);
    if (!isAdmin && !storeId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const kv = getRedis();
    if (!kv) return NextResponse.json({ success: true, id: 'demo', note: 'Redis not configured' });

    const flyer: Flyer = {
      ...body,
      storeId:   storeId ?? body.storeId,
      id:        `flyer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };

    // Store each flyer under its own key — avoids hitting value-size limits
    await kv.set(`flyer:${flyer.id}`, flyer);

    // Prepend ID to the index list (index holds no images — stays small)
    const index = (await kv.get<string[]>(INDEX_KEY)) ?? [];
    await kv.set(INDEX_KEY, [flyer.id, ...index]);

    return NextResponse.json({ success: true, id: flyer.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? 'Failed to save flyer' }, { status: 500 });
  }
}

// ─── GET — list all flyers ────────────────────────────────────────────────────

export async function GET() {
  const kv = getRedis();
  if (!kv) return NextResponse.json([]);

  try {
    const index = (await kv.get<string[]>(INDEX_KEY)) ?? [];
    if (!index.length) return NextResponse.json([]);

    // Fetch all flyers in one mget call
    const keys    = index.map((id) => `flyer:${id}`);
    const results = await kv.mget<Flyer[]>(...keys);
    const flyers  = (results as (Flyer | null)[]).filter((f): f is Flyer => f !== null);

    // Strip storeId: this endpoint is public (deals page + dashboards filter by
    // storeName), and storeId doubles as the store partner's API bearer
    // credential — leaking it here would let anyone write to that store's
    // KYC/payout/verification-photo endpoints.
    return NextResponse.json(flyers.map(({ storeId: _storeId, ...pub }) => pub));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? 'Failed to fetch flyers' }, { status: 500 });
  }
}
