// GET    /api/compositions/[id]
// PATCH  /api/compositions/[id]
// DELETE /api/compositions/[id]
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const composition = await db.composition.findUnique({ where: { id } });
    if (!composition) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ composition });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json() as {
      name?:        string;
      description?: string;
      zones?:       unknown;
    };
    const data: Record<string, unknown> = {};
    if (body.name?.trim()) data.name = body.name.trim();
    if ('description' in body) data.description = body.description?.trim() || null;
    if (Array.isArray(body.zones)) data.zones = body.zones;

    const composition = await db.composition.update({ where: { id }, data });
    return NextResponse.json({ composition });
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
    await db.composition.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
