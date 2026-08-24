'use client';

// "Power" card inside the screen-detail drawer (screens-tab DiagPanel): links a
// Sonoff smart plug (eWeLink) to the screen, shows relay/online state and
// power/energy, and can cut or restore mains power remotely.
//
// Metering plugs (POW/S31 class) show real watts + measured kWh. Relay-only
// plugs (BASICR4) have no metering chip, so energy is estimated from the
// admin-entered rated wattage × relay-on time and labeled as an estimate.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plug, PlugZap, Power, Unlink } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type PlugDto = {
  id: string;
  name: string;
  productModel: string | null;
  supportsEnergy: boolean;
  ratedWatts: number | null;
  online: boolean | null;
  switchOn: boolean | null;
  powerW: number | null;
  voltageV: number | null;
  currentA: number | null;
  lastPolledAt: string | null;
};

type Reading = { at: string; online: boolean; switchOn: boolean; powerW: number | null; energyWh: number | null; estimated: boolean };

type PowerResponse = {
  configured: boolean;
  connected: boolean;
  needsReauth: boolean;
  region: string | null;
  plug: PlugDto | null;
  series: Reading[];
  energy: { wh24h: number; wh7d: number; estimated: boolean } | null;
  error?: string;
};

type Candidate = {
  ewelinkDeviceId: string;
  name: string;
  productModel: string | null;
  online: boolean;
  supportsEnergy: boolean;
  linkedDeviceId: string | null;
  linkedDeviceName: string | null;
};

const adminHeaders = (): Record<string, string> => ({
  'admin-password': typeof window !== 'undefined' ? (sessionStorage.getItem('alive_admin_pw') ?? '') : '',
});

const fmtEnergy = (wh: number) => (wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${Math.round(wh)} Wh`);

function PowerSparkline({ series, metering }: { series: Reading[]; metering: boolean }) {
  if (series.length < 2) return null;
  const w = 288, h = 36;
  const step = w / series.length;
  const maxW = Math.max(...series.map((r) => r.powerW ?? 0), 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9" preserveAspectRatio="none" aria-hidden>
      {series.map((r, i) => {
        // Metering plugs: bar height ∝ watts. Relay-only: full bar when on.
        const value = metering ? (r.powerW ?? 0) / maxW : r.switchOn ? 1 : 0;
        const barH = Math.max(value * (h - 2), r.online ? 1.5 : 0);
        const fill = !r.online ? 'fill-border' : r.switchOn ? 'fill-green-500/70' : 'fill-muted-foreground/30';
        return <rect key={i} x={i * step} y={h - barH} width={Math.max(step - 0.4, 0.6)} height={barH} className={fill} />;
      })}
    </svg>
  );
}

export default function PowerPanel({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<PowerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pickedId, setPickedId] = useState('');
  const [watts, setWatts] = useState('');
  const [editingWatts, setEditingWatts] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/devices/${deviceId}/power`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((d: PowerResponse) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        if (d.connected && !d.needsReauth && !d.plug) {
          fetch('/api/admin/ewelink/devices', { headers: adminHeaders() })
            .then((r) => r.json())
            .then((list: { devices?: Candidate[] }) => setCandidates(list.devices ?? []))
            .catch(() => setCandidates([]));
        }
      })
      .catch((e: Error) => setData({ configured: false, connected: false, needsReauth: false, region: null, plug: null, series: [], energy: null, error: e.message }))
      .finally(() => setLoading(false));
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/ewelink/login-url', { headers: adminHeaders() });
      const d = (await r.json()) as { url?: string; error?: string };
      if (!d.url) throw new Error(d.error ?? 'Could not build login URL');
      window.location.href = d.url; // eWeLink redirects back to /admin after approval
    } catch (e) {
      toast({ title: 'eWeLink connect failed', description: (e as Error).message, variant: 'destructive' });
      setBusy(false);
    }
  };

  const link = async () => {
    if (!pickedId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/devices/${deviceId}/plug`, {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ewelinkDeviceId: pickedId, ratedWatts: watts ? Number(watts) : undefined }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast({ title: 'Plug linked' });
      setCandidates(null); setPickedId('');
      load();
    } catch (e) {
      toast({ title: 'Link failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!window.confirm('Unlink this plug? Its power history for this screen will be deleted.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/devices/${deviceId}/plug`, { method: 'DELETE', headers: adminHeaders() });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      load();
    } catch (e) {
      toast({ title: 'Unlink failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (on: boolean) => {
    if (!on && !window.confirm('Cut mains power to this screen? The TV will go dark until turned back on.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/devices/${deviceId}/plug/toggle`, {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast({ title: on ? 'Power turned on' : 'Power turned off' });
      load();
    } catch (e) {
      toast({ title: 'Toggle failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const saveWatts = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/devices/${deviceId}/plug`, {
        method: 'PATCH',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratedWatts: watts ? Number(watts) : null }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setEditingWatts(false);
      load();
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Power</p>
        <div className="rounded-xl border border-border bg-background p-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      </div>
    );
  }
  if (!data) return null;

  // Hide the card entirely when the integration isn't configured server-side —
  // no point showing dead UI on installs without eWeLink credentials.
  if (!data.configured) return null;

  const plug = data.plug;

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Power · Sonoff</p>
      <div className="rounded-xl border border-border bg-background p-3 space-y-2">

        {(!data.connected || data.needsReauth) && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {data.needsReauth ? 'eWeLink session expired — reconnect to resume polling.' : 'Link the ALIVE eWeLink account to control screen power.'}
            </p>
            <button onClick={connect} disabled={busy} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
              {data.needsReauth ? 'Reconnect eWeLink' : 'Connect eWeLink'}
            </button>
          </div>
        )}

        {data.connected && !data.needsReauth && !plug && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">No smart plug linked to this screen.</p>
            {candidates == null ? (
              <div className="flex justify-center py-1"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>
            ) : candidates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70 italic">No devices found on the eWeLink account.</p>
            ) : (
              <div className="space-y-2">
                <select value={pickedId} onChange={(e) => setPickedId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                  <option value="">Select a Sonoff device…</option>
                  {candidates.map((c) => (
                    <option key={c.ewelinkDeviceId} value={c.ewelinkDeviceId}>
                      {c.name}{c.productModel ? ` (${c.productModel})` : ''}{c.online ? '' : ' — offline'}{c.linkedDeviceId ? ` — linked to ${c.linkedDeviceName}` : ''}
                    </option>
                  ))}
                </select>
                {(() => {
                  const picked = candidates.find((c) => c.ewelinkDeviceId === pickedId);
                  return picked && !picked.supportsEnergy ? (
                    <div className="flex items-center gap-2">
                      <input type="number" min="1" placeholder="TV wattage (e.g. 90)" value={watts} onChange={(e) => setWatts(e.target.value)} className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
                      <span className="text-[10px] text-muted-foreground shrink-0">for energy estimates</span>
                    </div>
                  ) : null;
                })()}
                <button onClick={link} disabled={busy || !pickedId} className="w-full rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-1.5">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} Link plug
                </button>
              </div>
            )}
          </div>
        )}

        {plug && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{plug.name}{plug.productModel ? ` · ${plug.productModel}` : ''}</p>
                <p className="text-[10px] text-muted-foreground">
                  {plug.online == null ? 'Not polled yet' : plug.online ? 'Plug online' : 'Plug offline'}
                  {plug.lastPolledAt ? ` · updated ${new Date(plug.lastPolledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
              </div>
              <button
                onClick={() => toggle(!(plug.switchOn ?? false))}
                disabled={busy || plug.online === false}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors inline-flex items-center gap-1.5 disabled:opacity-40 ${plug.switchOn ? 'border-red-500/30 text-red-600 hover:bg-red-500/5' : 'border-green-600/30 text-green-700 hover:bg-green-500/5'}`}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                {plug.switchOn ? 'Turn off' : 'Turn on'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1">
              <div className="flex justify-between text-xs col-span-2">
                <span className="text-muted-foreground">Relay</span>
                <span className={`font-semibold ${plug.switchOn == null ? 'text-muted-foreground/50 italic font-normal' : plug.switchOn ? 'text-green-700' : 'text-red-600'}`}>
                  {plug.switchOn == null ? '—' : plug.switchOn ? 'On' : 'Off'}
                </span>
              </div>
              <div className="flex justify-between text-xs col-span-2">
                <span className="text-muted-foreground">Power draw</span>
                {plug.supportsEnergy ? (
                  <span className="font-semibold text-foreground">{plug.powerW != null ? `${plug.powerW.toFixed(1)} W` : <span className="text-muted-foreground/50 italic font-normal">—</span>}</span>
                ) : editingWatts ? (
                  <span className="inline-flex items-center gap-1">
                    <input type="number" min="1" value={watts} onChange={(e) => setWatts(e.target.value)} className="w-16 rounded border border-border bg-background px-1 py-0.5 text-xs text-right" />
                    <button onClick={saveWatts} disabled={busy} className="text-[10px] font-semibold text-foreground underline disabled:opacity-40">save</button>
                  </span>
                ) : (
                  <button onClick={() => { setWatts(plug.ratedWatts ? String(plug.ratedWatts) : ''); setEditingWatts(true); }} className="font-semibold text-foreground">
                    {plug.ratedWatts ? `~${plug.ratedWatts} W rated` : <span className="text-muted-foreground/50 italic font-normal">set wattage</span>}
                  </button>
                )}
              </div>
              {plug.supportsEnergy && plug.voltageV != null && (
                <div className="flex justify-between text-xs col-span-2">
                  <span className="text-muted-foreground">Voltage · Current</span>
                  <span className="font-semibold text-foreground">{plug.voltageV.toFixed(0)} V · {plug.currentA != null ? `${plug.currentA.toFixed(2)} A` : '—'}</span>
                </div>
              )}
              {data.energy && (
                <>
                  <div className="flex justify-between text-xs col-span-2">
                    <span className="text-muted-foreground">Energy · 24 h</span>
                    <span className="font-semibold text-foreground">{fmtEnergy(data.energy.wh24h)}</span>
                  </div>
                  <div className="flex justify-between text-xs col-span-2">
                    <span className="text-muted-foreground">Energy · 7 d</span>
                    <span className="font-semibold text-foreground">{fmtEnergy(data.energy.wh7d)}</span>
                  </div>
                </>
              )}
            </div>

            {data.series.length > 1 && (
              <div className="pt-1">
                <PowerSparkline series={data.series} metering={plug.supportsEnergy} />
                <p className="text-[10px] text-muted-foreground mt-0.5">{plug.supportsEnergy ? 'Power draw · last 24 h' : 'Relay on-time · last 24 h'}</p>
              </div>
            )}

            {!plug.supportsEnergy && (
              <p className="text-[10px] rounded-lg bg-amber-500/5 border border-amber-500/20 text-amber-800 px-2 py-1.5">
                {plug.productModel ?? 'This model'} has no metering chip — energy is estimated from rated wattage × on-time, not measured.
              </p>
            )}

            <div className="flex justify-end pt-0.5">
              <button onClick={unlink} disabled={busy} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-red-600 disabled:opacity-40 transition-colors">
                <Unlink className="h-2.5 w-2.5" /> Unlink plug
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
