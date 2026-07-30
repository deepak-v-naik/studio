'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Loader2, Tv2, Wifi, WifiOff, Clock, AlertCircle, Smartphone, Download, QrCode,
  ChevronDown, ChevronUp, Copy, Check, Play, CalendarDays, Pencil, Stethoscope, X,
  ExternalLink, CheckCircle2, TriangleAlert, Film, ImageIcon, Layers, Trash2,
  Store, Link2, Filter, SlidersHorizontal, LayoutList, LayoutGrid, ChevronLeft, ChevronRight,
  MapPin, RefreshCw, Monitor,
} from 'lucide-react';
import {
  getDevices, updateDevice, bulkUpdateDevices, bulkPushSchedule, getDeviceGroups, getPlaylists,
  searchStores, forceSyncDevice, confirmPairing,
  type Device, type DeviceGroup, type StoreSearchResult, type Playlist,
} from '@/lib/backend-api';
import ScreenTestButton from './screen-test-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';

// ─── Diagnostic panel (unchanged) ────────────────────────────────────────────
type DiagIssue = { level: 'ok' | 'warn' | 'error'; message: string };
type PlanPreview = {
  device:      { id: string; name: string; hardwareKey: string; groupName: string | null; status: string; lastSeen: string | null; storeName?: string | null; city?: string | null };
  telemetry?:  { cpuTempC: number | null; cpuTempUpdatedAt: string | null; freeStorageMb: number | null; androidVersion: string | null; appVersion: string | null } | null;
  performance?: { plays7d: number; watchMs7d: number; uptimePct: number | null };
  plan:        { planHash: string; scheduleId: string | null; scheduleName: string | null; playlistName: string | null; items: { name: string; url: string; type: string; durationMs: number; order: number }[]; scheduleCount: number; validUntil: string };
  diagnostics: { issues: DiagIssue[] };
  curl:        string;
};

function DiagPanel({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const [data,    setData]    = useState<PlanPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    const pw = typeof window !== 'undefined' ? (sessionStorage.getItem('alive_admin_pw') ?? '') : '';
    fetch(`/api/admin/devices/${deviceId}/plan-preview`, { headers: { 'admin-password': pw } })
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error as string); setData(d as PlanPreview); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);
  const copyCurl = () => { if (!data?.curl) return; navigator.clipboard.writeText(data.curl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const levelIcon = (level: DiagIssue['level']) => {
    if (level === 'ok')    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
    if (level === 'warn')  return <TriangleAlert className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />;
    return <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <Stethoscope className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{data?.device.storeName ? `${data.device.storeName}` : 'Screen detail'}</p>
              {data?.device && <p className="text-[10px] text-muted-foreground">{data.device.city ?? '—'} · Screen #{(data.device.hardwareKey ?? data.device.id).slice(-4).toUpperCase()}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refresh'}</button>
            <button onClick={onClose} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {error && <p className="text-xs text-red-500 bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          {data && (
            <>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Checklist</p>
                <div className="space-y-2">
                  {data.diagnostics.issues.map((issue, i) => (
                    <div key={i} className={`flex gap-2 rounded-xl px-3 py-2.5 text-xs ${issue.level === 'ok' ? 'bg-green-500/5 border border-green-500/15 text-green-800' : issue.level === 'warn' ? 'bg-yellow-500/5 border border-yellow-500/20 text-yellow-800' : 'bg-red-500/5 border border-red-500/20 text-red-700'}`}>
                      {levelIcon(issue.level)}<span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Performance over last 7 days */}
              {data.performance && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Performance · last 7 days</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-base font-bold text-foreground">{data.performance.plays7d.toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-muted-foreground">Plays</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-base font-bold text-foreground">{data.performance.watchMs7d < 60_000 ? `${Math.round(data.performance.watchMs7d / 1000)}s` : data.performance.watchMs7d < 3_600_000 ? `${Math.round(data.performance.watchMs7d / 60_000)}m` : `${(data.performance.watchMs7d / 3_600_000).toFixed(1)}h`}</p>
                      <p className="text-[10px] text-muted-foreground">Watch time</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-base font-bold text-foreground">{data.performance.uptimePct != null ? `${data.performance.uptimePct.toFixed(0)}%` : '—'}</p>
                      <p className="text-[10px] text-muted-foreground">Uptime (30d)</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Hardware telemetry */}
              {data.telemetry && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Hardware</p>
                  <div className="rounded-xl border border-border bg-background p-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <div className="flex justify-between text-xs col-span-2">
                      <span className="text-muted-foreground">CPU temperature</span>
                      <span className={`font-semibold ${data.telemetry.cpuTempC == null ? 'text-muted-foreground/50 italic font-normal' : data.telemetry.cpuTempC > 75 ? 'text-red-500' : data.telemetry.cpuTempC > 60 ? 'text-amber-500' : 'text-green-600'}`}>
                        {data.telemetry.cpuTempC != null ? `${data.telemetry.cpuTempC.toFixed(1)} °C` : 'Not reported'}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs col-span-2">
                      <span className="text-muted-foreground">Free storage</span>
                      <span className="font-semibold text-foreground">{data.telemetry.freeStorageMb != null ? `${(data.telemetry.freeStorageMb / 1024).toFixed(1)} GB` : <span className="text-muted-foreground/50 italic font-normal">—</span>}</span>
                    </div>
                    <div className="flex justify-between text-xs col-span-2">
                      <span className="text-muted-foreground">Android version</span>
                      <span className="font-semibold text-foreground">{data.telemetry.androidVersion ?? <span className="text-muted-foreground/50 italic font-normal">—</span>}</span>
                    </div>
                    <div className="flex justify-between text-xs col-span-2">
                      <span className="text-muted-foreground">Player version</span>
                      <span className="font-semibold text-foreground">{data.telemetry.appVersion ?? <span className="text-muted-foreground/50 italic font-normal">—</span>}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">What this device receives now</p>
                <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
                  {[['Schedule', data.plan.scheduleName], ['Playlist', data.plan.playlistName], ['Content items', data.plan.items.length], ['Schedules in window', data.plan.scheduleCount]].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-semibold text-foreground">{v ?? <span className="text-muted-foreground/50 font-normal italic">none</span>}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Plan hash</span><span className="font-mono text-[10px] text-muted-foreground/60">{data.plan.planHash.slice(0, 12)}…</span></div>
                </div>
              </div>
              {data.plan.items.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Content in active playlist</p>
                  <div className="space-y-1.5">
                    {data.plan.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.type === 'VIDEO' ? 'bg-purple-500/10' : 'bg-blue-500/10'}`}>
                          {item.type === 'VIDEO' ? <Film className="h-3.5 w-3.5 text-purple-600" /> : <ImageIcon className="h-3.5 w-3.5 text-blue-600" />}
                        </div>
                        <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-foreground truncate">{item.name}</p><p className="text-[10px] text-muted-foreground">{(item.durationMs / 1000).toFixed(0)}s · {item.type.toLowerCase()}</p></div>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"><ExternalLink className="h-3 w-3" /></a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Test from terminal</p>
                <div className="rounded-xl bg-muted/50 border border-border px-3 py-2.5 flex items-start gap-2">
                  <code className="flex-1 text-[10px] font-mono text-muted-foreground break-all leading-relaxed">{data.curl}</code>
                  <button onClick={copyCurl} className="shrink-0 rounded-lg border border-border bg-background p-1.5 hover:bg-muted/50 transition-colors">{copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Link-store dialog ────────────────────────────────────────────────────────
function LinkStoreDialog({
  deviceIds,
  onClose,
  onLinked,
}: {
  deviceIds: string[];
  onClose:   () => void;
  onLinked:  (storeId: string, storeName: string) => void;
}) {
  const [q,       setQ]       = useState('');
  const [results, setResults] = useState<StoreSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try { const r = await searchStores({ q: val }); setResults(r.stores); }
      finally { setLoading(false); }
    }, 300);
  }, []);

  useEffect(() => { search(''); }, [search]);

  const link = async (store: StoreSearchResult) => {
    setSaving(true);
    try {
      await Promise.all(deviceIds.map((id) => updateDevice(id, { storeId: store.id })));
      toast({ title: `${deviceIds.length > 1 ? `${deviceIds.length} screens` : 'Screen'} linked to ${store.storeName}` });
      onLinked(store.id, store.storeName);
      onClose();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Link failed', description: (e as Error).message });
    } finally { setSaving(false); }
  };

  const unlink = async () => {
    if (!confirm('Remove store link from selected screen(s)?')) return;
    setSaving(true);
    try {
      await Promise.all(deviceIds.map((id) => updateDevice(id, { storeId: null })));
      toast({ title: 'Store link removed' });
      onLinked('', '');
      onClose();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Failed', description: (e as Error).message });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Link to store</p></div>
          <button onClick={onClose} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
            placeholder="Search store name or city…"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {loading && <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
            {!loading && results.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No stores found</p>}
            {results.map((s) => (
              <button
                key={s.id}
                onClick={() => link(s)}
                disabled={saving}
                className="w-full flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{s.storeName}</p>
                  {(s.city || s.locality) && <p className="text-[11px] text-muted-foreground">{[s.locality, s.city].filter(Boolean).join(', ')}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-3">
                  {s.screenCount} screen{s.screenCount !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
          <button onClick={unlink} disabled={saving} className="w-full text-[11px] text-muted-foreground hover:text-destructive transition-colors py-1">
            Remove store link
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Push-schedule dialog ─────────────────────────────────────────────────────
function PushScheduleDialog({
  deviceIds,
  onClose,
}: {
  deviceIds: string[];
  onClose:   () => void;
}) {
  const [playlists,    setPlaylists]    = useState<Playlist[]>([]);
  const [playlistId,   setPlaylistId]   = useState('');
  const [durationMins, setDurationMins] = useState(60);
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    getPlaylists().then(setPlaylists).catch(() => {});
  }, []);

  const push = async () => {
    if (!playlistId) return;
    setSaving(true);
    try {
      const r = await bulkPushSchedule({ deviceIds, playlistId, durationMins });
      toast({ title: `Pushed to ${deviceIds.length} screen${deviceIds.length > 1 ? 's' : ''} for ${durationMins}min ✓`, description: r.schedule.name });
      onClose();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Push failed', description: (e as Error).message });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2"><Play className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Push playlist now</p></div>
          <button onClick={onClose} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground">Creates a priority-9 takeover schedule for <span className="font-bold text-foreground">{deviceIds.length} screen{deviceIds.length > 1 ? 's' : ''}</span>.</p>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Playlist</label>
            <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all">
              <option value="">Select a playlist…</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Duration (minutes)</label>
            <input type="number" min={1} max={1440} value={durationMins} onChange={(e) => setDurationMins(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          </div>
          <button onClick={push} disabled={saving || !playlistId}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Push now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Group overview panel ─────────────────────────────────────────────────────
function GroupPanel({ onClose, onFilterGroup }: { onClose: () => void; onFilterGroup: (g: string) => void }) {
  const [groups,  setGroups]  = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getDeviceGroups().then(setGroups).catch(() => {}).finally(() => setLoading(false)); }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-card border-l border-border shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /><p className="text-sm font-bold">Groups</p></div>
          <button onClick={onClose} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="p-4 space-y-2">
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
          {!loading && groups.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No groups yet — assign screens to a group to see them here.</p>}
          {groups.map((g) => (
            <button key={g.name} onClick={() => { onFilterGroup(g.name); onClose(); }}
              className="w-full flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-all">
              <div>
                <p className="text-sm font-semibold text-foreground">{g.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{g.total} screen{g.total !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5 text-[10px] shrink-0 ml-3">
                {g.online  > 0 && <span className="text-green-600 font-semibold">{g.online} online</span>}
                {g.offline > 0 && <span className="text-red-500">{g.offline} offline</span>}
                {g.pending > 0 && <span className="text-yellow-500">{g.pending} pending</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Registration onboarding card ────────────────────────────────────────────
const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? 'https://play.google.com/apps/internaltest/4701500416653827139';
const APK_DIRECT_URL = process.env.NEXT_PUBLIC_APK_DIRECT_URL ?? 'https://github.com/vanillasomethin/ALIVE-Player/releases/tag/sideload-latest';

function AddScreenCard() {
  const [open, setOpen] = useState(false);
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://wearealive.in';
  const apkUrl  = APK_DIRECT_URL.startsWith('http') ? APK_DIRECT_URL : `${baseUrl}${APK_DIRECT_URL}`;

  return (
    <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-primary/5 transition-colors">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shrink-0"><Smartphone className="h-5 w-5 text-white" /></div>
          <div>
            <p className="text-sm font-bold text-foreground">Register a new screen</p>
            <p className="text-xs text-muted-foreground mt-0.5">Install ALIVE Player on any Android TV device → it connects automatically</p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-primary/10 px-5 py-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-[10px] font-black shrink-0">1</span><p className="text-xs font-bold text-foreground">Install ALIVE Player</p></div>
              <div className="grid grid-cols-2 gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="flex flex-col items-center gap-1.5"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(PLAY_STORE_URL)}`} alt="Play Store QR" className="rounded-xl border border-border" width={100} height={100} /><p className="text-[9px] text-muted-foreground text-center">Play Store</p></div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="flex flex-col items-center gap-1.5"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(apkUrl)}`} alt="Direct APK QR" className="rounded-xl border border-border" width={100} height={100} /><p className="text-[9px] text-muted-foreground text-center">Direct APK</p></div>
              </div>
              <div className="flex flex-col gap-1.5">
                <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 transition-colors"><Download className="h-3.5 w-3.5" /> Play Store</a>
                <a href={apkUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted/30 transition-colors"><Download className="h-3.5 w-3.5" /> Direct APK</a>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-[10px] font-black shrink-0">2</span><p className="text-xs font-bold text-foreground">Boot &amp; auto-connect</p></div>
              <ol className="space-y-2">
                {[['a','Open ALIVE Player on the Android TV / Fire Stick'],['b','TV shows a 6-character screen code'],['c','Pick ONE: enter the code here, or scan the QR on the TV with your phone'],['d','Screen appears here as "Pending" within seconds']].map(([n,t]) => (
                  <li key={n} className="flex gap-2 text-[11px] text-muted-foreground"><span className="font-bold text-primary shrink-0 w-4">{n}.</span><span>{t}</span></li>
                ))}
              </ol>
              <div className="rounded-xl bg-muted/40 border border-border p-3 space-y-2">
                <p className="text-[10px] font-bold text-foreground flex items-center gap-1.5"><QrCode className="h-3 w-3" />Two ways to connect</p>
                <p className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">Option A</span> — click &quot;Pair screen&quot; above and type the 6-character code shown on the TV.</p>
                <p className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">Option B</span> — scan the QR code shown on the TV with your phone&apos;s camera; it opens this admin panel and connects the screen automatically.</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-[10px] font-black shrink-0">3</span><p className="text-xs font-bold text-foreground">Link to store &amp; go live</p></div>
              <ol className="space-y-2">
                {[['a','Screen appears as "Pending" — click "Link store" to assign it to a kirana store'],['b','Upload content in Content tab'],['c','Build a playlist → attach to a schedule → screen goes ONLINE'],['d','On next plan poll, screen starts playing the assigned content']].map(([n,t]) => (
                  <li key={n} className="flex gap-2 text-[11px] text-muted-foreground"><span className="font-bold text-primary shrink-0 w-4">{n}.</span><span>{t}</span></li>
                ))}
              </ol>
              <div className="rounded-xl bg-green-500/8 border border-green-500/20 p-3">
                <p className="text-[11px] text-green-700 font-semibold">Supported devices</p>
                <ul className="mt-1.5 space-y-1 text-[10px] text-green-700/80">
                  <li>• Android TV boxes (Mi Box, Nvidia Shield)</li><li>• Amazon Fire TV Stick 4K+</li><li>• Smart TVs with Android TV OS</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pair screen modal ────────────────────────────────────────────────────────
function PairScreenModal({ onClose, onPaired }: { onClose: () => void; onPaired: () => void }) {
  const [code,    setCode]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const handleSubmit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) { setError('Enter the 6-character code shown on the TV screen'); return; }
    setSaving(true); setError(null);
    try {
      const device = await confirmPairing(trimmed);
      setSuccess({ name: device.name });
      onPaired();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Tv2 className="h-4 w-4 text-primary" />
            <p className="text-sm font-bold">Pair a screen</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {success ? (
            <div className="text-center space-y-3 py-2">
              <div className="flex justify-center"><CheckCircle2 className="h-10 w-10 text-green-500" /></div>
              <p className="text-sm font-bold text-foreground">{success.name} added to fleet</p>
              <p className="text-xs text-muted-foreground">The screen will appear in your device list. Assign a store and schedule to go live.</p>
              <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors">Done</button>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-muted/40 border border-border p-4 text-center space-y-1">
                <p className="text-xs text-muted-foreground">On the TV screen, look for</p>
                <p className="text-lg font-black tracking-widest text-foreground">YOUR SCREEN CODE</p>
                <p className="text-xs text-muted-foreground">e.g. <span className="font-mono font-bold text-foreground">A4F9B2</span></p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">6-character code</label>
                <input
                  ref={inputRef}
                  value={code}
                  onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 6)); setError(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="A4F9B2"
                  maxLength={6}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-2xl font-mono font-bold tracking-widest uppercase focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <button onClick={handleSubmit} disabled={saving || code.trim().length !== 6}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {saving ? 'Confirming…' : 'Add screen to fleet'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline rename ────────────────────────────────────────────────────────────
function RenameField({ device, onSave }: { device: Device; onSave: (d: Device) => void }) {
  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(device.storeName);
  const [group,   setGroup]   = useState(device.groupName ?? '');
  const [saving,  setSaving]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open   = () => { setName(device.storeName); setGroup(device.groupName ?? ''); setEditing(true); setTimeout(() => inputRef.current?.focus(), 50); };
  const cancel = () => setEditing(false);
  const save   = async () => {
    setSaving(true);
    try { const updated = await updateDevice(device.id, { storeName: name, groupName: group }); onSave(updated); setEditing(false); }
    catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (!editing) return (
    <button onClick={open} className="flex items-center gap-1.5 group/rename" title="Rename screen">
      <p className="text-sm font-bold text-foreground truncate">{device.storeName}</p>
      <Pencil className="h-3 w-3 text-muted-foreground/30 group-hover/rename:text-primary/60 transition-colors shrink-0" />
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Screen name"
        className="rounded-lg border border-primary/40 bg-background px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 w-48" />
      <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Group name (optional)"
        className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 w-48" />
      <div className="flex gap-1.5">
        <button onClick={save} disabled={saving || !name.trim()} className="rounded-lg bg-primary px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40 hover:bg-primary/90 flex items-center gap-1">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
        </button>
        <button onClick={cancel} className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

// ─── Orientation select ───────────────────────────────────────────────────────
function OrientationSelect({ device, onSave }: { device: Device; onSave: (d: Device) => void }) {
  const [saving, setSaving] = useState(false);
  const val = device.orientation ?? 'PORTRAIT';

  const change = async (o: string) => {
    setSaving(true);
    try {
      const updated = await updateDevice(device.id, { orientation: o });
      onSave(updated);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={val}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        className="rounded-lg border border-border bg-background px-2 py-0.5 text-[10px] font-semibold focus:outline-none focus:border-primary disabled:opacity-50 transition-all"
      >
        <option value="PORTRAIT">Portrait</option>
        <option value="PORTRAIT_FLIPPED">Portrait (flipped 180°)</option>
        <option value="LANDSCAPE">Landscape</option>
        <option value="AUTO">Auto (device decides)</option>
      </select>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Human-friendly label for a device — avoids exposing raw hardware IDs in the UI.
// Examples: "Sharma Stores · Screen #b434" or "Screen #b434" if not linked.
function friendlyDeviceLabel(d: Device): string {
  const tail = (d.hardwareKey ?? d.id).slice(-4).toUpperCase();
  const short = `Screen #${tail}`;
  if (d.linkedStoreName) return `${d.linkedStoreName} · ${short}`;
  return short;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}
function timeSince(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const STATUS_BADGE: Record<Device['status'], 'success' | 'error' | 'warning'> = {
  ONLINE:  'success',
  OFFLINE: 'error',
  PENDING: 'warning',
};
const STATUS_ICONS: Record<Device['status'], React.ElementType> = {
  ONLINE: Wifi, OFFLINE: WifiOff, PENDING: Clock,
};

const PAGE_SIZE = 50;

// ─── Sideload APK card ────────────────────────────────────────────────────────
function SideloadApkCard() {
  const [open,   setOpen]   = useState(false);
  const [apkUrl, setApkUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!apkUrl) return;
    navigator.clipboard.writeText(apkUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-foreground flex items-center gap-2">
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          Sideload APK — AFTVnews Downloader
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {/* URL input + copy */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">APK download URL</label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={apkUrl}
                onChange={(e) => setApkUrl(e.target.value)}
                placeholder="https://example.com/alive-player.apk"
                className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
              <button
                onClick={copy}
                disabled={!apkUrl}
                className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <p className="text-xs text-muted-foreground">
            Open the <span className="font-semibold text-foreground">Downloader</span> app on your Fire TV / Android TV → enter the URL above → install ALIVE Player
          </p>

          {/* QR code */}
          {apkUrl && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Scan to open URL on device</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(apkUrl)}`}
                alt="APK URL QR code"
                width={120}
                height={120}
                className="rounded-xl border border-border"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────
export default function ScreensTab() {
  const [devices,    setDevices]    = useState<Device[]>([]);
  const [total,      setTotal]      = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevStack,  setPrevStack]  = useState<string[]>([]);   // cursor history for Back
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // Filters
  const [search,     setSearch]     = useState('');
  const [statusF,    setStatusF]    = useState('');      // '' | ONLINE | OFFLINE | PENDING
  const [groupF,     setGroupF]     = useState('');
  const [linkedF,    setLinkedF]    = useState('');      // '' | 'true' | 'false'
  const [density,    setDensity]    = useState<'comfortable' | 'compact'>('comfortable');

  // UI state
  const [diagId,       setDiagId]       = useState<string | null>(null);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [bulking,      setBulking]       = useState(false);
  const [showGroup,    setShowGroup]    = useState(false);
  const [groupInput,   setGroupInput]   = useState('');
  const [groupMode,    setGroupMode]    = useState<'existing' | 'new'>('existing');
  const [allGroups,    setAllGroups]    = useState<DeviceGroup[]>([]);
  const [showGroups,   setShowGroups]   = useState(false);
  const [showPairModal, setShowPairModal] = useState(false);
  const [linkIds,      setLinkIds]      = useState<string[] | null>(null);
  const [pushIds,      setPushIds]      = useState<string[] | null>(null);
  const [showFilters,  setShowFilters]  = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadGroups = useCallback(() => {
    getDeviceGroups().then(setAllGroups).catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const fetchPage = useCallback((cursor?: string, isPrev = false) => {
    setLoading(true); setError(null);
    const params: Record<string, string> = { take: String(PAGE_SIZE) };
    if (search)    params.q          = search;
    if (statusF)   params.status     = statusF;
    if (groupF)    params.groupName  = groupF;
    if (linkedF)   params.linked     = linkedF;
    if (cursor)    params.cursor     = cursor;

    getDevices(params)
      .then((r) => {
        setDevices(r.devices);
        setTotal(r.total);
        setNextCursor(r.nextCursor);
        if (!isPrev) setPrevStack((p) => cursor ? [...p, cursor] : []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoading(false); setSelected(new Set()); });
  }, [search, statusF, groupF, linkedF]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPrevStack([]); fetchPage(); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusF, groupF, linkedF]);

  const goNext = () => { if (nextCursor) fetchPage(nextCursor); };
  const goPrev = () => {
    const stack = [...prevStack];
    stack.pop(); // current cursor
    const cur = stack.pop();
    setPrevStack(stack);
    fetchPage(cur, true);
  };

  const toggleSelect   = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll      = () => setSelected((prev) => prev.size === devices.length ? new Set() : new Set(devices.map((d) => d.id)));

  const doBulkGroup = async () => {
    setBulking(true);
    const name = groupInput.trim();
    try {
      await bulkUpdateDevices({ ids: [...selected], action: 'group', groupName: name || undefined });
      setDevices((prev) => prev.map((d) => selected.has(d.id) ? { ...d, groupName: name || null } : d));
      toast({ title: `${selected.size} screen${selected.size > 1 ? 's' : ''} moved to group "${name || 'none'}" ✓` });
      setSelected(new Set()); setShowGroup(false); setGroupInput(''); setGroupMode('existing');
      loadGroups();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Bulk group failed', description: (e as Error).message });
    } finally { setBulking(false); }
  };

  const doForceSync = async (id: string) => {
    try {
      await forceSyncDevice(id);
      toast({ title: 'Sync triggered ✓', description: 'Player will refresh on next poll (within 1–5 min depending on its cadence).' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Force sync failed', description: (e as Error).message });
    }
  };

  const doBulkForceSync = async () => {
    setBulking(true);
    try {
      const ids = [...selected];
      await Promise.all(ids.map((id) => forceSyncDevice(id)));
      toast({ title: `${ids.length} screen${ids.length > 1 ? 's' : ''} flagged for re-sync ✓`, description: 'Each player will refresh on its next poll.' });
      setSelected(new Set());
    } catch (e) {
      toast({ variant: 'destructive', title: 'Bulk force sync failed', description: (e as Error).message });
    } finally { setBulking(false); }
  };

  const doBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} screen${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulking(true);
    try {
      await bulkUpdateDevices({ ids: [...selected], action: 'delete' });
      setDevices((prev) => prev.filter((d) => !selected.has(d.id)));
      toast({ title: `${selected.size} screen${selected.size > 1 ? 's' : ''} deleted` });
      setSelected(new Set());
    } catch (e) {
      toast({ variant: 'destructive', title: 'Bulk delete failed', description: (e as Error).message });
    } finally { setBulking(false); }
  };

  const online   = devices.filter((d) => d.status === 'ONLINE').length;
  const offline  = devices.filter((d) => d.status === 'OFFLINE').length;
  const pending  = devices.filter((d) => d.status === 'PENDING').length;
  const unlinked = devices.filter((d) => !d.storeId).length;

  const page    = prevStack.length + 1;
  const pages   = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="mb-2">
        <p className="admin-font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-primary mb-0.5">Screen fleet</p>
        <h1 className="admin-font-display text-3xl font-bold text-foreground tracking-tight">
          <em className="not-italic text-primary">{loading ? '—' : total}</em> screens, breathing.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {online} online · {offline} offline · {pending} pending · {unlinked} unlinked · Mangaluru, Karnataka
        </p>
      </div>

      {/* Sideload APK card */}
      <SideloadApkCard />

      {/* Modals */}
      {diagId    && <DiagPanel deviceId={diagId} onClose={() => setDiagId(null)} />}
      {showGroups && <GroupPanel onClose={() => setShowGroups(false)} onFilterGroup={(g) => { setGroupF(g); setShowGroups(false); }} />}
      {linkIds   && <LinkStoreDialog deviceIds={linkIds} onClose={() => setLinkIds(null)} onLinked={(sid, sname) => {
        setDevices((prev) => prev.map((d) => linkIds.includes(d.id) ? { ...d, storeId: sid || null, linkedStoreName: sname || null } : d));
        setSelected(new Set());
      }} />}
      {pushIds && <PushScheduleDialog deviceIds={pushIds} onClose={() => { setPushIds(null); setSelected(new Set()); }} />}
      {showPairModal && (
        <PairScreenModal
          onClose={() => setShowPairModal(false)}
          onPaired={() => { setPrevStack([]); fetchPage(); }}
        />
      )}

      {/* Header row: onboarding + pair button */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0"><AddScreenCard /></div>
        <button
          onClick={() => setShowPairModal(true)}
          className="shrink-0 flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-white hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Tv2 className="h-4 w-4" />
          Pair screen
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Total',    value: total,    color: 'text-blue-500',   bg: '',                     filter: '',        icon: Tv2 },
          { label: 'Online',   value: online,   color: 'text-green-500',  bg: statusF==='ONLINE'  ? 'bg-green-500/8 border-green-500/30' : '', filter: 'ONLINE',  icon: Wifi },
          { label: 'Offline',  value: offline,  color: 'text-red-500',    bg: statusF==='OFFLINE' ? 'bg-red-500/8 border-red-500/30'   : '', filter: 'OFFLINE', icon: WifiOff },
          { label: 'Pending',  value: pending,  color: 'text-yellow-500', bg: statusF==='PENDING' ? 'bg-yellow-500/8 border-yellow-500/30': '', filter: 'PENDING', icon: Clock },
          { label: 'Unlinked', value: unlinked, color: 'text-muted-foreground', bg: linkedF==='false' ? 'bg-muted/50 border-primary/30' : '', filter: '__unlinked__', icon: Store },
        ].map((s) => (
          <button key={s.label} onClick={() => {
            if (s.filter === '__unlinked__') { setLinkedF(linkedF === 'false' ? '' : 'false'); setStatusF(''); }
            else { setStatusF(statusF === s.filter ? '' : s.filter); setLinkedF(''); }
          }}
            className={`rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/30 ${s.bg}`}>
            <s.icon className={`h-3.5 w-3.5 ${s.color} mb-1.5`} />
            <p className="text-lg font-bold text-foreground">{loading ? '—' : s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Unlinked callout */}
      {!loading && unlinked > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <Store className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700 flex-1"><span className="font-bold">{unlinked} screen{unlinked > 1 ? 's' : ''}</span> {unlinked > 1 ? 'are' : 'is'} not linked to a store — schedules by store/city won&apos;t apply to {unlinked > 1 ? 'them' : 'it'}.</p>
          <button onClick={() => setLinkedF(linkedF === 'false' ? '' : 'false')} className="text-[11px] font-semibold text-amber-700 hover:underline shrink-0">Show</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div><p className="text-sm font-semibold">Could not load screens</p><p className="text-xs text-muted-foreground mt-0.5">{error}</p></div>
        </div>
      ) : (
        <>
          {/* Search + controls row */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Search by name, store, hardware key…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-40 rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
            <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${showFilters ? 'border-primary/50 bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              <Filter className="h-3.5 w-3.5" /> Filters {(groupF || linkedF) && '•'}
            </button>
            <button onClick={() => setShowGroups(true)} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
              <Layers className="h-3.5 w-3.5" /> Groups
            </button>
            <button onClick={() => { setDensity(d => d === 'comfortable' ? 'compact' : 'comfortable'); }} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors" title="Toggle density">
              {density === 'comfortable' ? <LayoutList className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => { setPrevStack([]); fetchPage(); }} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {devices.length > 0 && (
              <button onClick={toggleAll} className="rounded-xl border border-border px-3 py-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
                {selected.size === devices.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {/* Filter rail */}
          {showFilters && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Filters</span>
              </div>
              <div className="flex gap-1.5 flex-wrap flex-1">
                {['ONLINE','OFFLINE','PENDING'].map((s) => (
                  <button key={s} onClick={() => setStatusF(statusF === s ? '' : s)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${statusF === s ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                    {s}
                  </button>
                ))}
                <button onClick={() => setLinkedF(linkedF === 'true' ? '' : 'true')}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${linkedF === 'true' ? 'border-green-500/50 bg-green-500/10 text-green-700' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  Linked to store
                </button>
                <button onClick={() => setLinkedF(linkedF === 'false' ? '' : 'false')}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${linkedF === 'false' ? 'border-amber-500/50 bg-amber-500/10 text-amber-700' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  Unlinked
                </button>
                {groupF && (
                  <button onClick={() => setGroupF('')}
                    className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/8 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                    Group: {groupF} <X className="h-3 w-3 ml-0.5" />
                  </button>
                )}
                {(statusF || linkedF || groupF) && (
                  <button onClick={() => { setStatusF(''); setLinkedF(''); setGroupF(''); }} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors ml-1">
                    Clear all
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <span className="text-xs font-semibold text-primary">{selected.size} selected</span>
              <div className="flex-1" />
              <button onClick={() => setLinkIds([...selected])} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                <Link2 className="h-3 w-3" /> Link store
              </button>
              {showGroup ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {groupMode === 'existing' ? (
                    <select
                      value={groupInput}
                      onChange={(e) => {
                        if (e.target.value === '__new__') { setGroupMode('new'); setGroupInput(''); }
                        else setGroupInput(e.target.value);
                      }}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:border-primary transition-all"
                      autoFocus
                    >
                      <option value="">— Remove from group —</option>
                      {allGroups.map((g) => (
                        <option key={g.name} value={g.name}>{g.name} ({g.total} screen{g.total !== 1 ? 's' : ''})</option>
                      ))}
                      <option value="__new__">＋ Create new group…</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input value={groupInput} onChange={(e) => setGroupInput(e.target.value)}
                        placeholder="New group name"
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-all w-40"
                        onKeyDown={(e) => { if (e.key === 'Enter' && groupInput.trim()) doBulkGroup(); if (e.key === 'Escape') setShowGroup(false); }}
                        autoFocus />
                      <button type="button" onClick={() => { setGroupMode('existing'); setGroupInput(''); }} className="text-[10px] text-muted-foreground hover:text-foreground underline">back</button>
                    </div>
                  )}
                  <button onClick={doBulkGroup} disabled={bulking} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                    {bulking ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                  </button>
                  <button onClick={() => { setShowGroup(false); setGroupMode('existing'); setGroupInput(''); }} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setShowGroup(true); setGroupMode('existing'); setGroupInput(''); }} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  <Layers className="h-3 w-3" /> Assign group
                </button>
              )}
              <button onClick={() => setPushIds([...selected])} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                <Play className="h-3 w-3" /> Push playlist
              </button>
              <button onClick={doBulkForceSync} disabled={bulking} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                <RefreshCw className={`h-3 w-3 ${bulking ? 'animate-spin' : ''}`} /> Force sync
              </button>
              <button onClick={doBulkDelete} disabled={bulking} className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-50">
                {bulking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Clear</button>
            </div>
          )}

          {/* Devices */}
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              {search || statusF || groupF || linkedF ? 'No devices match the current filters.' : 'No screens registered yet — expand "Register a new screen" above to get started.'}
            </p>
          ) : density === 'compact' ? (
            /* ── Compact table view ─────────────────────────────────── */
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-left w-8"><input type="checkbox" checked={selected.size === devices.length} onChange={toggleAll} className="h-3 w-3 rounded accent-primary cursor-pointer" /></th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Screen</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Store</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Group</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Orient.</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Schedule</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Heartbeat</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => {
                    const StatusIcon = STATUS_ICONS[d.status];
                    return (
                      <tr key={d.id} className={`border-b border-border/60 last:border-0 hover:bg-muted/20 ${selected.has(d.id) ? 'bg-primary/5' : ''}`}>
                        <td className="px-3 py-2"><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} className="h-3 w-3 rounded accent-primary cursor-pointer" /></td>
                        <td className="px-3 py-2 font-semibold text-foreground max-w-[120px] truncate">{d.storeName}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px]">
                          {d.linkedStoreName ? (
                            <span className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5 shrink-0" />{d.linkedStoreName}</span>
                          ) : (
                            <button onClick={() => setLinkIds([d.id])} className="text-amber-500 hover:underline text-[10px]">+ Link</button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{d.groupName ?? '—'}</td>
                        <td className="px-3 py-2">
                          <OrientationSelect device={d} onSave={(updated) => setDevices((prev) => prev.map((x) => x.id === updated.id ? { ...x, orientation: updated.orientation } : x))} />
                          <ScreenTestButton deviceId={d.id} />
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_BADGE[d.status]} dot className="text-[10px] py-0.5 px-2 font-bold">
                            <StatusIcon className="h-2 w-2" />{d.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{d.currentSchedule?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{d.lastSeen ? timeSince(d.lastSeen) : 'Never'}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => setDiagId(d.id)} className="rounded-lg border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── Comfortable card view ──────────────────────────────── */
            <div className="space-y-2">
              {devices.map((d) => {
                const StatusIcon = STATUS_ICONS[d.status];
                const sched = d.currentSchedule;
                return (
                  <div key={d.id} className={`rounded-xl border bg-card overflow-hidden hover:border-primary/30 transition-colors ${selected.has(d.id) ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                    {/* Top row */}
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
                      <div className="flex items-center gap-3 min-w-0">
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} className="h-3.5 w-3.5 rounded accent-primary cursor-pointer shrink-0" />
                        <Tv2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <RenameField device={d} onSave={(updated) => setDevices((prev) => prev.map((x) => x.id === updated.id ? { ...x, storeName: updated.storeName, groupName: updated.groupName } : x))} />
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[10px] text-muted-foreground/70 truncate">{friendlyDeviceLabel(d)}</p>
                            {d.linkedStoreName ? (
                              <button onClick={() => setLinkIds([d.id])} className="flex items-center gap-0.5 text-[10px] text-green-700 hover:underline">
                                <Store className="h-2.5 w-2.5" />{d.linkedStoreName}
                                {d.city && <span className="text-muted-foreground/60 ml-0.5">· {d.city}</span>}
                              </button>
                            ) : (
                              <button onClick={() => setLinkIds([d.id])} className="flex items-center gap-0.5 text-[10px] text-amber-500 hover:underline">
                                <Store className="h-2.5 w-2.5" /> Link to store
                              </button>
                            )}
                            {d.groupName && <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{d.groupName}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setLinkIds([d.id])} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                          <Link2 className="h-3 w-3" />
                        </button>
                        <button onClick={() => setDiagId(d.id)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                          <Stethoscope className="h-3 w-3" /> Details
                        </button>
                        <button onClick={() => doForceSync(d.id)} title="Force this screen to re-fetch its plan on next poll" className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                          <RefreshCw className="h-3 w-3" /> Sync
                        </button>
                        <Badge variant={STATUS_BADGE[d.status]} dot className="text-[10px] py-0.5 px-2 font-bold">
                          <StatusIcon className="h-2.5 w-2.5" />{d.status}
                        </Badge>
                        {d.uptimePct != null && (
                          <span className={`text-[10px] font-semibold ${d.uptimePct >= 98 ? 'text-green-600' : d.uptimePct >= 90 ? 'text-yellow-600' : 'text-red-500'}`}>
                            {d.uptimePct.toFixed(1)}% up
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Bottom row */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-border/60">
                      <div className="px-4 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1"><CalendarDays className="h-2.5 w-2.5" />Schedule</p>
                        {sched ? (<><p className="text-[11px] font-semibold text-foreground truncate">{sched.name}</p>{sched.playlistName && <p className="text-[10px] text-muted-foreground truncate">{sched.playlistName}</p>}</>) : <p className="text-[11px] text-muted-foreground/50 italic">No active schedule</p>}
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-2.5 w-2.5" />Ends at</p>
                        <p className="text-[11px] text-foreground">{sched ? fmtDate(sched.endsAt) : '—'}</p>
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1"><Play className="h-2.5 w-2.5" />Last play</p>
                        <p className="text-[11px] text-foreground">{d.lastPlayAt ? timeSince(d.lastPlayAt) : '—'}</p>
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1"><Wifi className="h-2.5 w-2.5" />Heartbeat</p>
                        <p className="text-[11px] text-foreground">{d.lastSeen ? timeSince(d.lastSeen) : 'Never'}</p>
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1"><Monitor className="h-2.5 w-2.5" />Orientation</p>
                        <OrientationSelect device={d} onSave={(updated) => setDevices((prev) => prev.map((x) => x.id === updated.id ? { ...x, orientation: updated.orientation } : x))} />
                          <ScreenTestButton deviceId={d.id} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <button onClick={goPrev} disabled={page <= 1} className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <p className="text-xs text-muted-foreground">Page {page} of {pages} &mdash; {total} total</p>
              <button onClick={goNext} disabled={!nextCursor} className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
