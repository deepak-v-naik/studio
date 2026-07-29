'use client';

import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Loader2, Wifi, WifiOff, Clock, AlertCircle, RefreshCw, Bell, LayoutGrid, Map } from 'lucide-react';
import { getDevices, type Device } from '@/lib/backend-api';
import PlayerConfigPanel from './player-config-panel';

const FleetMap = lazy(() => import('./fleet-map'));

function timeSince(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

function SectionLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="admin-section-label">
      <span className="admin-section-label__n">N°{String(n).padStart(2, '0')}</span>
      <span className="admin-section-label__rule" />
      <span className="admin-section-label__lbl">{label}</span>
    </div>
  );
}

type View = 'grid' | 'map';

export default function MonitoringTab() {
  const [devices,    setDevices]    = useState<Device[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [lastFetch,  setLastFetch]  = useState<Date | null>(null);
  const [alertState, setAlertState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [view,       setView]       = useState<View>('grid');

  const sendTestAlert = useCallback(async () => {
    setAlertState('sending');
    const pw = typeof window !== 'undefined' ? (sessionStorage.getItem('alive_admin_pw') ?? '') : '';
    try {
      const res = await fetch('/api/admin/test-alert', { method: 'POST', headers: pw ? { 'admin-password': pw } : {} });
      setAlertState(res.ok ? 'ok' : 'err');
    } catch { setAlertState('err'); }
    setTimeout(() => setAlertState('idle'), 3000);
  }, []);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    getDevices()
      .then((r) => { setDevices(r.devices); setLastFetch(new Date()); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  if (error) return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 flex gap-3">
      <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-foreground">Could not load monitoring data</p>
        <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
      </div>
    </div>
  );

  const online  = devices.filter((d) => d.status === 'ONLINE').length;
  const offline = devices.filter((d) => d.status === 'OFFLINE').length;
  const pending = devices.filter((d) => d.status === 'PENDING').length;

  const withUptime = devices.filter((d) => d.uptimePct != null);
  const avgUptime  = withUptime.length > 0
    ? withUptime.reduce((s, d) => s + (d.uptimePct ?? 0), 0) / withUptime.length
    : null;

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="mb-2">
        <p className="admin-font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-primary mb-0.5">Live network</p>
        <h1 className="admin-font-display text-3xl font-bold text-foreground tracking-tight">
          <em className="not-italic text-primary">{loading ? '—' : online}</em> of {loading ? '—' : devices.length} screens online.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {offline > 0 ? `${offline} offline · ` : 'All screens up · '}
          {pending > 0 ? `${pending} pending · ` : ''}
          Refreshes every 30 seconds · Mangaluru, Karnataka
        </p>
      </div>

      {/* Stats strip */}
      {!loading && devices.length > 0 && (
        <div className="admin-summary-row" style={{ marginBottom: 0 }}>
          {[
            { label: 'Online',     value: String(online),  color: '#16a34a' },
            { label: 'Offline',    value: String(offline), color: '#dc2626' },
            { label: 'Pending',    value: String(pending), color: '#b45309' },
            { label: 'Uptime avg', value: avgUptime != null ? `${avgUptime.toFixed(0)}%` : '—', color: 'var(--foreground)' },
          ].map((s) => (
            <div key={s.label} className="admin-summary-tile">
              <div className="admin-summary-tile__label">{s.label}</div>
              <div className="admin-summary-tile__value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['grid', 'map'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === 'grid' ? <LayoutGrid className="h-3 w-3" /> : <Map className="h-3 w-3" />}
              {v === 'grid' ? 'Grid' : 'Map'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && <span className="text-[10px] text-muted-foreground/50">Updated {lastFetch.toLocaleTimeString('en-IN')}</span>}
          <button onClick={sendTestAlert} disabled={alertState === 'sending'}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
              alertState === 'ok'  ? 'border-green-500/30 bg-green-500/10 text-green-700' :
              alertState === 'err' ? 'border-red-500/30 bg-red-500/10 text-red-600'       :
                                     'border-border text-muted-foreground hover:text-foreground'
            }`}>
            {alertState === 'sending' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
            {alertState === 'ok' ? 'Sent!' : alertState === 'err' ? 'Failed' : 'Test alert'}
          </button>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <SectionLabel n={1} label="Network" />

      {loading && !devices.length ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !devices.length ? (
        <p className="text-sm text-muted-foreground text-center py-10">No screens registered yet.</p>
      ) : view === 'map' ? (
        <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
          <FleetMap devices={devices} />
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
            Showing {devices.filter((d) => d.lat != null).length} of {devices.length} screens with known locations.
            Pin colour: green = online, red = offline, yellow = pending.
          </p>
        </Suspense>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {devices.map((d) => {
            const isOnline  = d.status === 'ONLINE';
            const isOffline = d.status === 'OFFLINE';
            return (
              <div key={d.id}
                className={`rounded-xl border p-4 space-y-2 transition-colors ${
                  isOnline  ? 'border-green-500/30 bg-green-500/5'  :
                  isOffline ? 'border-red-500/20 bg-red-500/5'      :
                              'border-yellow-500/20 bg-yellow-500/5'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-xs font-semibold text-foreground leading-tight line-clamp-2">{d.storeName}</p>
                  {isOnline  ? <Wifi    className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" /> :
                   isOffline ? <WifiOff className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5"   /> :
                               <Clock   className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />}
                </div>
                <div className="space-y-0.5">
                  {d.lastSeen && (
                    <p className="text-[10px] text-muted-foreground">
                      Last seen: <span className="font-semibold">{timeSince(d.lastSeen)}</span> ago
                    </p>
                  )}
                  {d.uptimePct != null && (
                    <p className="text-[10px] text-muted-foreground">
                      Uptime: <span className={`font-semibold ${d.uptimePct >= 98 ? 'text-green-600' : d.uptimePct >= 90 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {d.uptimePct.toFixed(1)}%
                      </span>
                    </p>
                  )}
                  {d.locality && <p className="text-[10px] text-muted-foreground/60">{d.locality}</p>}
                  <p className="text-[10px] font-mono text-muted-foreground/40">{d.id.slice(0, 8)}…</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionLabel n={2} label="Player config" />
      <PlayerConfigPanel />
    </div>
  );
}
