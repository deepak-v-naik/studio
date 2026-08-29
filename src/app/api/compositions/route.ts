// GET  /api/compositions — list all compositions (presets first)
// POST /api/compositions — create a new composition
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const compositions = await db.composition.findMany({
      orderBy: [{ isPreset: 'desc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ compositions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      name:         string;
      description?: string;
      zones:        unknown;
      isPreset?:    boolean;
    };
    if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!Array.isArray(body.zones) || body.zones.length === 0)
      return NextResponse.json({ error: 'At least one zone is required' }, { status: 400 });

    const composition = await db.composition.create({
      data: {
        name:        body.name.trim(),
        description: body.description?.trim() || null,
        zones:       body.zones,
        isPreset:    body.isPreset ?? false,
      },
    });
    return NextResponse.json({ composition }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
