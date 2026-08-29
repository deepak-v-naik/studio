// Runs every 5 minutes via .github/workflows/ewelink-poll-cron.yml (same
// GitHub-Actions-as-cron pattern as device-health — Vercel Hobby only allows
// once-daily crons in vercel.json, and this one isn't registered there at all).
//
// One eWeLink cloud call fetches every device's online/switch/power params;
// each linked SmartPlug row gets its live state updated and a PlugReading
// appended. energyWh per reading = energy since the previous poll:
//   - metering plugs (POW/S31): measured watts × elapsed time
//   - relay-only plugs (BASICR4): ratedWatts × relay-on time, flagged estimated
// Elapsed time is capped at 30 min so missed polls don't fabricate energy.
// Readings older than 90 days are pruned on each run.
//
// GET /api/cron/ewelink-poll
// Auth: CRON_SECRET (Authorization: Bearer <secret>)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ewelinkConfigured, getLinkedAccount, listThings, readPowerParams } from '@/lib/ewelink';
import { isCronAuthorized } from '@/lib/cron-auth';

const MAX_INTERVAL_MS = 30 * 60 * 1000;
const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!isCronAuthorized(auth)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!ewelinkConfigured()) return NextResponse.json({ skipped: 'not configured' });

  const plugs = await db.smartPlug.findMany();
  if (plugs.length === 0) return NextResponse.json({ skipped: 'no plugs linked' });

  const account = await getLinkedAccount();
  if (!account) return NextResponse.json({ skipped: 'no account linked' });
  if (account.needsReauth) return NextResponse.json({ skipped: 'account needs re-auth' });

  try {
    const things = new Map((await listThings(account)).map((t) => [t.deviceid, t]));
    const now = new Date();
    let polled = 0;

    for (const plug of plugs) {
      const thing = things.get(plug.ewelinkDeviceId);
      // Plug deleted from the eWeLink account: record it as offline so the gap
      // is visible, rather than freezing the last-known state forever.
      const online = thing?.online ?? false;
      const snapshot = thing ? readPowerParams(thing.params, thing.uiid) : { switchOn: null, powerW: null, voltageV: null, currentA: null };
      const switchOn = online ? (snapshot.switchOn ?? false) : false;
      const powerW = online ? snapshot.powerW : null;

      const elapsedMs = plug.lastPolledAt ? Math.min(now.getTime() - plug.lastPolledAt.getTime(), MAX_INTERVAL_MS) : 0;
      let energyWh: number | null = null;
      let estimated = false;
      if (online && switchOn && elapsedMs > 0) {
        if (powerW != null) {
          energyWh = (powerW * elapsedMs) / 3_600_000;
        } else if (plug.ratedWatts) {
          energyWh = (plug.ratedWatts * elapsedMs) / 3_600_000;
          estimated = true;
        }
      }

      await db.$transaction([
        db.smartPlug.update({
          where: { id: plug.id },
          data: {
            online,
            switchOn: online ? switchOn : plug.switchOn,
            powerW,
            voltageV: online ? snapshot.voltageV : null,
            currentA: online ? snapshot.currentA : null,
            lastPolledAt: now,
            ...(thing ? { name: thing.name, uiid: thing.uiid, productModel: thing.productModel } : {}),
          },
        }),
        db.plugReading.create({
          data: { plugId: plug.id, at: now, online, switchOn, powerW, energyWh, estimated },
        }),
      ]);
      polled++;
    }

    const { count: pruned } = await db.plugReading.deleteMany({
      where: { at: { lt: new Date(now.getTime() - RETENTION_DAYS * 24 * 3_600_000) } },
    });

    return NextResponse.json({ polled, pruned });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
