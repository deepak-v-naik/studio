// GET /api/device/update-check
// Auth: Authorization: Bearer <device-jwt>
// Returns the latest released player APK version + download info for OTA.
// Configured via env vars set at release time (see CLAUDE.md "Env Vars"):
//   PLAYER_LATEST_VERSION_CODE, PLAYER_LATEST_VERSION_NAME, PLAYER_APK_URL, PLAYER_APK_SHA256
// The player compares versionCode against its own BuildConfig.VERSION_CODE — this
// route always reports the latest configured build, it doesn't know per-device state.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as jose from 'jose';

type ReleaseInfo = {
  versionCode: number;
  versionName: string | null;
  apkUrl:      string;
  sha256:      string;
};

// The release workflow publishes latest.json next to the APK on the sideload-latest
// GitHub Release, so the OTA target updates itself on every build. Previously this came
// from three Vercel env vars that had to be edited by hand per release — when they
// drifted this endpoint just answered "no update" and OTA silently stopped working.
const DEFAULT_MANIFEST_URL =
  'https://github.com/vanillasomethin/ALIVE-Player/releases/download/sideload-latest/latest.json';

function envRelease(): ReleaseInfo | null {
  const versionCode = Number(process.env.PLAYER_LATEST_VERSION_CODE ?? 0);
  const apkUrl      = process.env.PLAYER_APK_URL ?? null;
  const sha256      = process.env.PLAYER_APK_SHA256 ?? null;
  if (!versionCode || !apkUrl || !sha256) return null;
  return { versionCode, versionName: process.env.PLAYER_LATEST_VERSION_NAME ?? null, apkUrl, sha256 };
}

async function resolveLatestRelease(): Promise<ReleaseInfo | null> {
  // Explicit env vars win, so a bad release can be pinned/rolled back without reverting
  // the build. Otherwise read the published manifest.
  const pinned = envRelease();
  if (pinned) return pinned;

  const url = process.env.PLAYER_OTA_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
  try {
    // Cached briefly: every screen polls this every 6h, and the manifest only changes on
    // release. Keeps a GitHub outage or rate limit from stalling update checks fleet-wide.
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const m = await res.json() as Partial<ReleaseInfo>;
    if (!m.versionCode || !m.apkUrl || !m.sha256) return null;
    return {
      versionCode: Number(m.versionCode),
      versionName: m.versionName ?? null,
      apkUrl:      m.apkUrl,
      sha256:      m.sha256,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const deviceToken = auth.replace(/^Bearer\s+/i, '').trim();
  if (!deviceToken) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
  }

  try {
    const decoded = jose.decodeJwt(deviceToken);
    const deviceId = decoded.sub as string | undefined;
    if (!deviceId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const device = await db.device.findUnique({ where: { id: deviceId }, select: { id: true, jwtSecret: true } });
    if (!device) {
      // 410, matching /api/device/plan and /api/device/events: a well-formed token
      // for a nonexistent device means the screen was deleted in the admin panel,
      // and the player decommissions on this signal.
      return NextResponse.json({ error: 'Device deleted' }, { status: 410 });
    }

    await jose.jwtVerify(deviceToken, new TextEncoder().encode(device.jwtSecret));

    const release = await resolveLatestRelease();
    if (!release) return NextResponse.json({ updateAvailable: false });

    return NextResponse.json({ updateAvailable: true, ...release });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
