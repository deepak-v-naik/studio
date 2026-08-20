// Screen-offline alerts for the admin panel.
//   GET   → open alerts (newest first) + unread count, for the popup + bell badge
//   PATCH → mark alerts read ({ ids: string[] } or { all: true })
//
// Auth: strict admin-password. Deliberately NOT the `!process.env.ADMIN_PASSWORD ||`
// fail-open idiom used by /api/devices — this route exposes store names and
// mutates state, so an unset env var must lock it down, not open it up.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function adminGuard(req: NextRequest): boolean {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Resolved alerts stay visible briefly so an admin watching the panel sees
    // "came back online" rather than the alert just vanishing.
    const recentlyResolved = new Date(Date.now() - 60 * 60 * 1000);
    const alerts = await db.deviceAlert.findMany({
      where: {
        OR: [
          { status: 'OPEN' },
          { status: 'RESOLVED', resolvedAt: { gte: recentlyResolved } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const unread = alerts.filter((a) => a.status === 'OPEN' && !a.adminReadAt).length;
    return NextResponse.json({ alerts, unread });
  } catch {
    // Table not migrated yet — an empty list keeps the panel working.
    return NextResponse.json({ alerts: [], unread: 0 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({})) as { ids?: string[]; all?: boolean };
    const now = new Date();

    if (body.all) {
      await db.deviceAlert.updateMany({ where: { adminReadAt: null }, data: { adminReadAt: now } });
      return NextResponse.json({ ok: true });
    }
    if (Array.isArray(body.ids) && body.ids.length) {
      await db.deviceAlert.updateMany({ where: { id: { in: body.ids } }, data: { adminReadAt: now } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'ids or all required' }, { status: 400 });
  } catch (e) {
    console.error('admin/alerts PATCH failed:', (e as Error).message);
    return NextResponse.json({ error: 'Could not update alerts' }, { status: 500 });
  }
}
