'use client';

// Proof of Play — operator-facing playback reporting.
// Three lenses over the same PlayEvent data, all scoped by a calendar date range (IST):
//   • By Screen → pick a TV, see every video it played with exact start/stop times
//   • By Ad     → pick a video, see which screens played it, when, and for how long
//   • By Groups → pick groups, see plays across all their screens
// Backed by GET /api/reports/plays (see getPlays / downloadPlaysCsv).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import {
  Loader2, Download, AlertCircle, PlayCircle, CalendarDays, Tv2, Clapperboard, Users, Play,
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getPlays, downloadPlaysCsv, getDevices, getContent, getDeviceGroups,
  type PlaysResponse, type Device, type Content, type DeviceGroup,
} from '@/lib/backend-api';

// ─── Time helpers (IST) ────────────────────────────────────────────────────────
// PlayEvent timestamps are stored UTC; the business is India-based, so all display
// and all calendar-day boundaries are computed in IST (+05:30).

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const istDayStartUtc = (d: Date) => new Date(`${ymd(d)}T00:00:00.000+05:30`).toISOString();
const istDayEndUtc   = (d: Date) => new Date(`${ymd(d)}T23:59:59.999+05:30`).toISOString();

function fmtIST(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

function fmtDur(ms: number): string {
  if (ms < 1000)       return `${ms} ms`;
  if (ms < 60_000)     return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} hrs`;
}

// ─── Shared styles ──────────────────────────────────────────────────────────────

const inp = 'rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';
const th  = 'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap';
const thR = 'px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap';

type Mode = 'screen' | 'ad' | 'group';

function SectionLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="admin-section-label">
      <span className="admin-section-label__n">N°{String(n).padStart(2, '0')}</span>
      <span className="admin-section-label__rule" />
      <span className="admin-section-label__lbl">{label}</span>
    </div>
  );
}

// ─── Date-range picker (calendar range + presets, IST) ──────────────────────────

function DateRangePicker({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = useState(false);

  const label = range.from
    ? range.to && ymd(range.to) !== ymd(range.from)
      ? `${format(range.from, 'd MMM yyyy')} — ${format(range.to, 'd MMM yyyy')}`
      : format(range.from, 'd MMM yyyy')
    : 'Pick a date range';

  const preset = (days: number) => {
    const to = new Date(); const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    onChange({ from, to });
  };
  const thisMonth = () => {
    const now = new Date();
    onChange({ from: new Date(now.getFullYear(), now.getMonth(), 1), to: now });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`${inp} flex items-center gap-2 min-w-[240px]`}>
          <CalendarDays className="h-4 w-4 text-primary shrink-0" />
          <span className="text-foreground">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
          {[['Today', 1], ['7 days', 7], ['30 days', 30], ['90 days', 90]].map(([lbl, d]) => (
            <button key={lbl} onClick={() => preset(d as number)}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
              {lbl}
            </button>
          ))}
          <button onClick={thisMonth}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
            This month
          </button>
        </div>
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r) => onChange(r ?? { from: undefined, to: undefined })}
          numberOfMonths={2}
          defaultMonth={range.from}
        />
        <div className="border-t border-border p-2 text-right">
          <button onClick={() => setOpen(false)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors">
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── KPI tiles ──────────────────────────────────────────────────────────────────

function Kpis({ data, loading }: { data: PlaysResponse | null; loading: boolean }) {
  const s = data?.summary;
  const tiles = [
    { label: 'Total plays',  value: loading || !s ? '—' : s.totalPlays.toLocaleString('en-IN') },
    { label: 'Watch time',   value: loading || !s ? '—' : fmtDur(s.totalMs) },
    { label: 'Screens',      value: loading || !s ? '—' : s.screens.toLocaleString('en-IN') },
    { label: 'Videos',       value: loading || !s ? '—' : s.contentCount.toLocaleString('en-IN') },
  ];
  return (
    <div className="admin-summary-row">
      {tiles.map((t) => (
        <div key={t.label} className="admin-summary-tile">
          <div className="admin-summary-tile__label">{t.label}</div>
          <div className="admin-summary-tile__value">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────────

export default function ProofOfPlayTab() {
  const [mode, setMode] = useState<Mode>('screen');

  // Default range: last 7 days.
  const [range, setRange] = useState<DateRange>(() => {
    const to = new Date(); const from = new Date(); from.setDate(to.getDate() - 6);
    return { from, to };
  });

  // Filter selections per lens.
  const [deviceId,       setDeviceId]       = useState('');
  const [mediaId,        setMediaId]        = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  // Reference data.
  const [devices, setDevices] = useState<Device[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [groups,  setGroups]  = useState<DeviceGroup[]>([]);

  // Report data.
  const [data,    setData]    = useState<PlaysResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Load reference lists once.
  useEffect(() => {
    getDevices({ take: '500' }).then((r) => setDevices(r.devices)).catch(() => setDevices([]));
    getContent().then((r) => setContent(r.content)).catch(() => setContent([]));
    getDeviceGroups().then(setGroups).catch(() => setGroups([]));
  }, []);

  const rangeParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (range.from) p.from = istDayStartUtc(range.from);
    if (range.to)   p.to   = istDayEndUtc(range.to);
    return p;
  }, [range]);

  const activeFilterParams = useCallback((): Record<string, string> => {
    if (mode === 'screen') return deviceId ? { deviceId } : {};
    if (mode === 'ad')     return mediaId  ? { mediaId }  : {};
    return selectedGroups.length ? { groupNames: selectedGroups.join(',') } : {};
  }, [mode, deviceId, mediaId, selectedGroups]);

  // A report needs a primary selection in every mode except when the user just wants
  // an all-screens sweep — which we don't run automatically (could be huge). Require a pick.
  const hasSelection =
    (mode === 'screen' && !!deviceId) ||
    (mode === 'ad'     && !!mediaId)  ||
    (mode === 'group'  && selectedGroups.length > 0);

  const runReport = useCallback(() => {
    if (!hasSelection) { setData(null); return; }
    setLoading(true); setError(null);
    getPlays({ ...rangeParams(), ...activeFilterParams() })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hasSelection, rangeParams, activeFilterParams]);

  // Re-run whenever the primary selection or mode changes (range changes re-run on "Run report").
  useEffect(() => { runReport(); }, [mode, deviceId, mediaId, selectedGroups, runReport]);

  const csvName = useMemo(() => {
    const tag = mode === 'screen' ? (devices.find((d) => d.id === deviceId)?.storeName || 'screen')
      : mode === 'ad' ? (content.find((c) => c.id === mediaId)?.name || 'ad')
      : (selectedGroups.join('-') || 'groups');
    return `alive-pop-${mode}-${tag}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() + '.csv';
  }, [mode, deviceId, mediaId, selectedGroups, devices, content]);

  const exportCsv = () => {
    downloadPlaysCsv({ ...rangeParams(), ...activeFilterParams() }, csvName).catch((e: Error) => setError(e.message));
  };

  const toggleGroup = (name: string) =>
    setSelectedGroups((g) => g.includes(name) ? g.filter((x) => x !== name) : [...g, name]);

  const videos = useMemo(() => {
    // Videos first (the "ad" case), then everything else, alphabetically.
    return [...content].sort((a, b) =>
      (a.type === b.type ? 0 : a.type === 'video' ? -1 : 1) || a.name.localeCompare(b.name));
  }, [content]);

  const MODES: { id: Mode; label: string; icon: typeof Tv2 }[] = [
    { id: 'screen', label: 'By Screen', icon: Tv2 },
    { id: 'ad',     label: 'By Ad video', icon: Clapperboard },
    { id: 'group',  label: 'By Groups', icon: Users },
  ];

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="mb-6">
        <p className="admin-font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-primary mb-0.5">Proof of play</p>
        <h1 className="admin-font-display text-3xl font-bold text-foreground tracking-tight">
          Every play, <em className="not-italic text-primary">accounted for</em>.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Exact start &amp; stop times per screen, per ad, per group — straight from the screens. Times shown in IST.
        </p>
      </div>

      {/* Lens selector + date range */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {MODES.map((m) => {
            const Icon = m.icon; const active = mode === m.id;
            return (
              <button key={m.id} onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${active ? 'bg-primary text-white' : 'border border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}`}>
                <Icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DateRangePicker range={range} onChange={setRange} />
          <button onClick={runReport} disabled={!hasSelection}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run report
          </button>
        </div>
      </div>

      {/* Per-lens primary selector */}
      <div className="rounded-xl border border-border bg-card p-4">
        {mode === 'screen' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Screen</label>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={`${inp} min-w-[280px]`}>
              <option value="">Select a screen…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {(d.storeName || d.linkedStoreName || 'Screen') + (d.groupName ? ` · ${d.groupName}` : '') + ` · #${(d.hardwareKey ?? d.id).slice(-4).toUpperCase()}`}
                </option>
              ))}
            </select>
          </div>
        )}
        {mode === 'ad' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ad video</label>
            <select value={mediaId} onChange={(e) => setMediaId(e.target.value)} className={`${inp} min-w-[280px]`}>
              <option value="">Select a video…</option>
              {videos.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.type !== 'video' ? ` (${c.type})` : ''}</option>
              ))}
            </select>
          </div>
        )}
        {mode === 'group' && (
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Groups</label>
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No groups defined. Assign screens to a group in the Screens tab.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => {
                  const on = selectedGroups.includes(g.name);
                  return (
                    <button key={g.name} onClick={() => toggleGroup(g.name)}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${on ? 'bg-primary text-white' : 'border border-border text-muted-foreground hover:border-primary/40'}`}>
                      {g.name} <span className={on ? 'text-white/70' : 'text-muted-foreground/50'}>· {g.total}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">Could not load report</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {!hasSelection ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <PlayCircle className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {mode === 'screen' ? 'Pick a screen to see everything it played.'
              : mode === 'ad'  ? 'Pick an ad video to see which screens played it.'
              : 'Pick one or more groups to see their plays.'}
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : data && (
        <>
          <Kpis data={data} loading={false} />

          {/* Lens-specific rollup */}
          {mode === 'screen' && (
            <>
              <SectionLabel n={1} label="Videos on this screen" />
              <RollupTable
                cols={['Video', 'Plays', 'Watch', 'Last played']}
                rows={data.summary.byContent.map((c) => [c.contentName || c.mediaId, c.plays.toLocaleString('en-IN'), fmtDur(c.totalMs), c.lastPlayedAt ? fmtIST(c.lastPlayedAt) : '—'])}
              />
            </>
          )}
          {mode === 'ad' && (
            <>
              <SectionLabel n={1} label="Screens that played this ad" />
              <RollupTable
                cols={['Screen', 'Group', 'Plays', 'Watch', 'Last played']}
                rows={data.summary.byScreen.map((s) => [s.screenName, s.groupName || '—', s.plays.toLocaleString('en-IN'), fmtDur(s.totalMs), s.lastPlayedAt ? fmtIST(s.lastPlayedAt) : '—'])}
              />
            </>
          )}
          {mode === 'group' && (
            <>
              <SectionLabel n={1} label="By group" />
              <RollupTable
                cols={['Group', 'Screens', 'Plays', 'Watch']}
                rows={data.summary.byGroup.map((g) => [g.groupName, g.screens.toLocaleString('en-IN'), g.plays.toLocaleString('en-IN'), fmtDur(g.totalMs)])}
              />
              <SectionLabel n={2} label="By screen" />
              <RollupTable
                cols={['Screen', 'Group', 'Plays', 'Watch', 'Last played']}
                rows={data.summary.byScreen.map((s) => [s.screenName, s.groupName || '—', s.plays.toLocaleString('en-IN'), fmtDur(s.totalMs), s.lastPlayedAt ? fmtIST(s.lastPlayedAt) : '—'])}
              />
            </>
          )}

          {/* Row-level timeline — the exact-timing proof */}
          <div className="flex items-center justify-between mt-2">
            <SectionLabel n={mode === 'group' ? 3 : 2} label="Play log — exact timing" />
            <button onClick={exportCsv}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:border-primary/40 transition-colors">
              <Download className="h-3.5 w-3.5 text-primary" /> Export CSV
            </button>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {mode !== 'screen' && <th className={th}>Screen</th>}
                  {mode === 'group'  && <th className={th}>Group</th>}
                  {mode !== 'ad'     && <th className={th}>Video</th>}
                  <th className={th}>Started (IST)</th>
                  <th className={th}>Stopped (IST)</th>
                  <th className={thR}>Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    {mode !== 'screen' && <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.screenName}</td>}
                    {mode === 'group'  && <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.groupName || '—'}</td>}
                    {mode !== 'ad'     && <td className="px-3 py-2 text-foreground">{r.contentName || <span className="text-muted-foreground/50 font-mono text-[10px]">{r.mediaId}</span>}</td>}
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtIST(r.startedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtIST(r.endedAt)}</td>
                    <td className="px-3 py-2 text-right text-foreground whitespace-nowrap">{fmtDur(r.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="text-sm text-muted-foreground text-center py-10">No plays in this period.</p>
            )}
            {data.rowsTruncated && (
              <div className="px-4 py-2 bg-muted/30 text-[10px] text-muted-foreground text-center border-t border-border">
                Showing latest {data.rows.length.toLocaleString('en-IN')} of {data.matchedCount.toLocaleString('en-IN')} plays · export CSV for the full log
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Small reusable rollup table ────────────────────────────────────────────────

function RollupTable({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground px-1 py-2">No data.</p>;
  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            {cols.map((c, i) => <th key={c} className={i === 0 ? th : thR}>{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, ri) => (
            <tr key={ri} className="hover:bg-muted/20">
              {r.map((cell, ci) => (
                <td key={ci} className={ci === 0 ? 'px-3 py-2 text-foreground' : 'px-3 py-2 text-right text-muted-foreground whitespace-nowrap'}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
