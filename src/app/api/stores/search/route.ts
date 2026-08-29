// GET /api/stores/search?q=&city= — lightweight store autocomplete for admin tools
// Returns id, storeName, city, locality, loopSlotCount (slot mode), screen count (devices linked).
// Auth: admin-password header

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p    = req.nextUrl.searchParams;
  const q    = p.get('q')?.trim() ?? '';
  const city = p.get('city')?.trim() ?? '';

  try {
    const stores = await db.store.findMany({
      where: {
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
        ...(q ? {
          OR: [
            { storeName: { contains: q, mode: 'insensitive' } },
            { locality:  { contains: q, mode: 'insensitive' } },
            { city:      { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id:            true,
        storeName:     true,
        city:          true,
        locality:      true,
        loopSlotCount: true,
        _count:        { select: { devices: true } },
      },
      orderBy: [{ city: 'asc' }, { storeName: 'asc' }],
      take:    50,
    });

    // Distinct cities for filter chips
    const cities = await db.store.findMany({
      select:   { city: true },
      distinct: ['city'],
      where:    { city: { not: null } },
      orderBy:  { city: 'asc' },
    });

    return NextResponse.json({
      stores: stores.map((s) => ({
        id:            s.id,
        storeName:     s.storeName,
        city:          s.city,
        locality:      s.locality,
        loopSlotCount: s.loopSlotCount,
        screenCount:   s._count.devices,
      })),
      cities: cities.map((c) => c.city).filter(Boolean),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
