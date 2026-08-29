// GET /api/overlays — list all overlays (admin)
// POST /api/overlays — create an overlay
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

function normalize(o: Record<string, unknown>) {
  const obj = o as { startAt?: Date | null; endAt?: Date | null; createdAt: Date; updatedAt: Date; feedFetchedAt?: Date | null };
  return {
    ...o,
    startAt:       obj.startAt       ? obj.startAt.toISOString()       : null,
    endAt:         obj.endAt         ? obj.endAt.toISOString()         : null,
    feedFetchedAt: obj.feedFetchedAt ? obj.feedFetchedAt.toISOString() : null,
    createdAt:     obj.createdAt.toISOString(),
    updatedAt:     obj.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const overlays = await db.overlay.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    return NextResponse.json({ overlays: overlays.map(normalize) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      name:        string;
      type:        'TICKER' | 'NEWS_TICKER' | 'BANNER' | 'INFO_BAR';
      enabled?:    boolean;
      text?:       string | null;
      feedUrl?:    string | null;
      imageUrl?:   string | null;
      position?:   'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
      bgColor?:    string | null;
      fgColor?:    string | null;
      speedPxSec?: number;
      heightPct?:  number;
      deviceIds?:  string[];
      groupName?:  string | null;
      storeIds?:   string[];
      cityFilter?: string | null;
      startAt?:    string | null;
      endAt?:      string | null;
      dailyStart?: string | null;
      dailyEnd?:   string | null;
      requireWifi?: boolean;
      priority?:   number;
    };

    if (!body.name || !body.type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    const overlay = await db.overlay.create({
      data: {
        name:        body.name,
        type:        body.type,
        enabled:     body.enabled ?? true,
        text:        body.text ?? null,
        feedUrl:     body.feedUrl ?? null,
        imageUrl:    body.imageUrl ?? null,
        position:    body.position ?? 'BOTTOM',
        bgColor:     body.bgColor ?? null,
        fgColor:     body.fgColor ?? null,
        speedPxSec:  body.speedPxSec ?? 60,
        heightPct:   body.heightPct ?? 8,
        deviceIds:   body.deviceIds ?? [],
        groupName:   body.groupName ?? null,
        storeIds:    body.storeIds ?? [],
        cityFilter:  body.cityFilter ?? null,
        startAt:     body.startAt    ? new Date(body.startAt) : null,
        endAt:       body.endAt      ? new Date(body.endAt)   : null,
        dailyStart:  body.dailyStart ?? null,
        dailyEnd:    body.dailyEnd ?? null,
        requireWifi: body.requireWifi ?? false,
        priority:    body.priority ?? 0,
      },
    });

    return NextResponse.json({ overlay: normalize(overlay) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
