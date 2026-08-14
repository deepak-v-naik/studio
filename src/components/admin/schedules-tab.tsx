'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, CalendarClock, Plus, Trash2, AlertCircle, Monitor,
  Zap, Clock3, CalendarDays, RotateCcw, Tv2, Smartphone, Pencil, CheckCircle2,
  LayoutList, CalendarRange, Users, Store, MapPin, Globe, Search, X, ChevronDown,
} from 'lucide-react';
import {
  getSchedules, getPlaylists, getDevices, getDeviceGroups, searchStores,
  createSchedule, updateSchedule, deleteSchedule,
  type Schedule, type Playlist, type Device, type DeviceGroup, type StoreSearchResult,
} from '@/lib/backend-api';
import { toast } from '@/hooks/use-toast';
import ScheduleCalendar from './schedule-calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

function nowLocal(): string {
  const d = new Date(); d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localPlusDays(days: number): string {
  const d = new Date(); d.setSeconds(0, 0); d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocal(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

const FAR_FUTURE = '2099-12-31T23:59';

const INTERVAL_MARKS = [
  { value: 0,  label: 'Continuous' },
  { value: 5,  label: 'Every 5 min' },
  { value: 10, label: 'Every 10 min' },
  { value: 15, label: 'Every 15 min' },
  { value: 20, label: 'Every 20 min' },
  { value: 30, label: 'Every 30 min' },
  { value: 60, label: 'Every hour' },
];

const RECURRENCE_LABELS: Record<Schedule['recurrence'], string> = {
  once: 'One-time', daily: 'Daily', weekly: 'Weekly',
};

const inp = 'w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';
const lbl = 'block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1';

type TimingMode = 'scheduled' | 'now_indefinite' | 'now_until';
type TargetMode = 'device' | 'group' | 'store' | 'city' | 'all';

const TARGET_MODES: { id: TargetMode; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'device', label: 'Specific screens', icon: Monitor,  desc: 'Choose individual screens' },
  { id: 'group',  label: 'Group',            icon: Users,    desc: 'All screens in a group' },
  { id: 'store',  label: 'Store',            icon: Store,    desc: 'All screens in chosen stores' },
  { id: 'city',   label: 'City',             icon: MapPin,   desc: 'All screens in a city' },
  { id: 'all',    label: 'All screens',      icon: Globe,    desc: 'Every registered screen' },
];

const BLANK_FORM = {
  name:            '',
  playlistId:      '',
  targetMode:      'device' as TargetMode,
  selectedDevices: [] as string[],
  groupName:       '',
  storeIds:        [] as string[],
  cityFilter:      '',
  timingMode:      'scheduled' as TimingMode,
  startAt:         '',
  endAt:           '',
  recurrence:      'daily' as Schedule['recurrence'],
  orientation:     'portrait' as 'landscape' | 'portrait' | 'any',
  intervalMins:    0,
  priority:        0,
};

// ─── Orientation icon ─────────────────────────────────────────────────────────
function OrientationIcon({ o, size = 14 }: { o: 'landscape' | 'portrait' | 'any'; size?: number }) {
  if (o === 'landscape') return <Tv2 style={{ width: size, height: size }} />;
  if (o === 'portrait')  return <Smartphone style={{ width: size, height: size }} />;
  return <RotateCcw style={{ width: size, height: size }} />;
}

// ─── Targeting preview helper ─────────────────────────────────────────────────
function TargetingPreview({
  targetMode, selectedDevices, groupName, storeIds, cityFilter,
  devices, groups, selectedStores,
}: {
  targetMode: TargetMode;
  selectedDevices: string[];
  groupName: string;
  storeIds: string[];
  cityFilter: string;
  devices: Device[];
  groups: DeviceGroup[];
  selectedStores: StoreSearchResult[];
}) {
  if (targetMode === 'all') {
    return (
      <p className="text-[11px] text-amber-700 bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2">
        Will push to <strong>all registered screens</strong>. Make sure this is intentional.
      </p>
    );
  }
  if (targetMode === 'device') {
    if (!selectedDevices.length) return null;
    const slotSelected = devices.filter((d) => selectedDevices.includes(d.id) && d.slotMode);
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-green-700 bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
          Will affect <strong>{selectedDevices.length} screen{selectedDevices.length !== 1 ? 's' : ''}</strong> directly.
        </p>
        {slotSelected.length > 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2">
            <strong>{slotSelected.length} of the selected screen{selectedDevices.length !== 1 ? 's' : ''} {slotSelected.length === 1 ? 'is' : 'are'} in slot mode</strong> — slot-mode
            screens play their store&apos;s fixed ad-slot loop and ignore schedules. This schedule will only
            play there on a day whose slot loop has nothing to show.
          </p>
        )}
      </div>
    );
  }
  if (targetMode === 'group') {
    if (!groupName) return null;
    const g = groups.find((x) => x.name === groupName);
    if (!g) return <p className="text-[11px] text-muted-foreground">Group &quot;{groupName}&quot; — new group, no screens yet.</p>;
    return (
      <p className="text-[11px] text-green-700 bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
        Will affect <strong>{g.total} screen{g.total !== 1 ? 's' : ''}</strong> in group &quot;{g.name}&quot;
        {' '}({g.online} online, {g.offline} offline{g.pending ? `, ${g.pending} pending` : ''}).
      </p>
    );
  }
  if (targetMode === 'store') {
    if (!storeIds.length) return null;
    const total = selectedStores.reduce((s, x) => s + x.screenCount, 0);
    const slotStores = selectedStores.filter((s) => s.loopSlotCount != null);
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] text-green-700 bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
          Will affect <strong>~{total} screen{total !== 1 ? 's' : ''}</strong> across {storeIds.length} store{storeIds.length !== 1 ? 's' : ''}.
        </p>
        {slotStores.length > 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2">
            <strong>{slotStores.map((s) => s.storeName).join(', ')} {slotStores.length === 1 ? 'is' : 'are'} in slot mode</strong> — screens
            there play the fixed ad-slot loop and ignore schedules. This schedule will only play
            there on a day whose slot loop has nothing to show.
          </p>
        )}
      </div>
    );
  }
  if (targetMode === 'city') {
    if (!cityFilter) return null;
    const matching = devices.filter((d) => d.city === cityFilter || (d.locality ?? '').includes(cityFilter));
    return (
      <p className="text-[11px] text-green-700 bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
        Will affect screens in <strong>{cityFilter}</strong>
        {matching.length > 0 ? ` (~${matching.length} loaded)` : ''}.
        New screens in this city auto-pick up this schedule.
      </p>
    );
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [devices,   setDevices]   = useState<Device[]>([]);
  const [groups,    setGroups]    = useState<DeviceGroup[]>([]);
  const [cities,    setCities]    = useState<string[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [deleting,  setDeleting]  = useState<string | null>(null);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [listView,  setListView]  = useState<'list' | 'calendar'>('list');

  // Device search within picker
  const [deviceSearch, setDeviceSearch] = useState('');
  // Group autocomplete
  const [groupSearch,  setGroupSearch]  = useState('');
  const [groupOpen,    setGroupOpen]    = useState(false);
  // Store search
  const [storeQuery,   setStoreQuery]   = useState('');
  const [storeResults, setStoreResults] = useState<StoreSearchResult[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [selectedStores, setSelectedStores] = useState<StoreSearchResult[]>([]);

  const storeSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [form, setForm] = useState({ ...BLANK_FORM, startAt: '', endAt: '' });

  useEffect(() => {
    Promise.all([getSchedules(), getPlaylists(), getDevices(), getDeviceGroups(), searchStores()])
      .then(([s, p, r, g, sr]) => {
        setSchedules(s);
        setPlaylists(p);
        setDevices(r.devices);
        setGroups(g);
        setCities(sr.cities);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Debounced store search
  const doStoreSearch = useCallback((q: string) => {
    setStoreLoading(true);
    searchStores({ q })
      .then((r) => { setStoreResults(r.stores); setCities(r.cities); })
      .catch(() => {})
      .finally(() => setStoreLoading(false));
  }, []);

  useEffect(() => {
    if (storeSearchTimer.current) clearTimeout(storeSearchTimer.current);
    storeSearchTimer.current = setTimeout(() => doStoreSearch(storeQuery), 300);
    return () => { if (storeSearchTimer.current) clearTimeout(storeSearchTimer.current); };
  }, [storeQuery, doStoreSearch]);

  const openNew = () => {
    setForm({ ...BLANK_FORM, startAt: nowLocal(), endAt: localPlusDays(7) });
    setEditId(null);
    setDeviceSearch('');
    setGroupSearch('');
    setStoreQuery('');
    setSelectedStores([]);
    setShowForm(true);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const openEdit = (s: Schedule) => {
    // Detect target mode from saved schedule
    let targetMode: TargetMode = 'all';
    if (s.deviceIds?.length)  targetMode = 'device';
    else if (s.groupName)     targetMode = 'group';
    else if (s.storeIds?.length) targetMode = 'store';
    else if (s.cityFilter)    targetMode = 'city';

    const isIndefinite = s.endAt > '2090-01-01';
    setForm({
      name:            s.name,
      playlistId:      s.playlistId,
      targetMode,
      selectedDevices: s.deviceIds ?? [],
      groupName:       s.groupName ?? '',
      storeIds:        s.storeIds ?? [],
      cityFilter:      s.cityFilter ?? '',
      timingMode:      'scheduled',
      startAt:         isoToLocal(s.startAt),
      endAt:           isIndefinite ? localPlusDays(30) : isoToLocal(s.endAt),
      recurrence:      s.recurrence,
      orientation:     (s.orientation as 'landscape' | 'portrait' | 'any') ?? 'portrait',
      intervalMins:    s.intervalMins ?? 0,
      priority:        s.priority ?? 0,
    });
    setGroupSearch(s.groupName ?? '');
    // Pre-populate selected stores if editing store-targeted schedule
    if (s.storeIds?.length) {
      setStoreQuery('');
      doStoreSearch('');
    }
    setEditId(s.id);
    setShowForm(true);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleDevice = (id: string) =>
    setForm((f) => ({
      ...f,
      selectedDevices: f.selectedDevices.includes(id)
        ? f.selectedDevices.filter((d) => d !== id)
        : [...f.selectedDevices, id],
    }));

  const toggleStore = (store: StoreSearchResult) => {
    setForm((f) => {
      const has = f.storeIds.includes(store.id);
      return { ...f, storeIds: has ? f.storeIds.filter((id) => id !== store.id) : [...f.storeIds, store.id] };
    });
    setSelectedStores((prev) => {
      const has = prev.some((s) => s.id === store.id);
      return has ? prev.filter((s) => s.id !== store.id) : [...prev, store];
    });
  };

  const del = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    setDeleting(id);
    try {
      await deleteSchedule(id);
      setSchedules((s) => s.filter((x) => x.id !== id));
      toast({ title: 'Schedule deleted' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Delete failed', description: (e as Error).message });
    } finally {
      setDeleting(null);
    }
  };

  const resolveTimings = () => {
    if (form.timingMode === 'now_indefinite') {
      return { startAt: new Date().toISOString(), endAt: new Date(FAR_FUTURE).toISOString() };
    }
    if (form.timingMode === 'now_until') {
      return { startAt: new Date().toISOString(), endAt: new Date(form.endAt).toISOString() };
    }
    return { startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString() };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.playlistId) return;
    if (form.timingMode === 'scheduled' && (!form.startAt || !form.endAt)) return;
    if (form.timingMode === 'now_until' && !form.endAt) return;
    setSaving(true);
    try {
      const { startAt, endAt } = resolveTimings();
      const payload: Parameters<typeof createSchedule>[0] = {
        name:         form.name,
        playlistId:   form.playlistId,
        startAt,
        endAt,
        recurrence:   form.recurrence,
        orientation:  form.orientation,
        intervalMins: form.intervalMins > 0 ? form.intervalMins : null,
        priority:     form.priority,
        // targeting — only set the relevant field, clear others
        groupName:    form.targetMode === 'group'  ? (form.groupName || undefined) : null,
        deviceIds:    form.targetMode === 'device' ? form.selectedDevices : [],
        storeIds:     form.targetMode === 'store'  ? form.storeIds : [],
        cityFilter:   form.targetMode === 'city'   ? (form.cityFilter || null) : null,
      };

      if (editId) {
        const updated = await updateSchedule(editId, payload);
        setSchedules((s) => s.map((x) => x.id === editId ? updated : x));
        toast({ title: 'Schedule updated ✓', description: 'Changes will reach screens at next poll.' });
      } else {
        const created = await createSchedule(payload);
        setSchedules((s) => [created, ...s]);
        toast({ title: 'Schedule created ✓', description: 'Content will start playing as scheduled.' });
      }

      setForm({ ...BLANK_FORM, startAt: nowLocal(), endAt: localPlusDays(7) });
      setSelectedStores([]);
      closeForm();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Save failed', description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      {[0,1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 flex gap-3">
      <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-foreground">Could not load schedules</p>
        <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
      </div>
    </div>
  );

  const intervalLabel = INTERVAL_MARKS.find((m) => m.value === form.intervalMins)?.label
    ?? `Every ${form.intervalMins} min`;
  const isAlwaysOn = form.timingMode === 'now_indefinite';

  const filteredDevices = deviceSearch
    ? devices.filter((d) =>
        d.storeName.toLowerCase().includes(deviceSearch.toLowerCase()) ||
        d.id.toLowerCase().includes(deviceSearch.toLowerCase()) ||
        (d.locality ?? '').toLowerCase().includes(deviceSearch.toLowerCase())
      )
    : devices;

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(groupSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">Timezone: <span className="font-semibold text-foreground">{userTz}</span></p>
        <button
          onClick={showForm ? closeForm : openNew}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New schedule
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {editId ? 'Edit schedule' : 'New schedule'}
            </h2>
            {editId && (
              <span className="flex items-center gap-1.5 text-[11px] text-primary bg-primary/10 rounded-full px-2.5 py-1 font-semibold">
                <Pencil className="h-3 w-3" /> Editing
              </span>
            )}
          </div>
          <form onSubmit={save} className="space-y-5">

            {/* Name + Playlist row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Name</label>
                <input type="text" required value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Afternoon Slot — July" className={inp} />
              </div>
              <div>
                <label className={lbl}>Playlist</label>
                <select required value={form.playlistId}
                  onChange={(e) => set('playlistId', e.target.value)} className={inp}>
                  <option value="">Select a playlist</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.items.length} items)</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Timing mode ───────────────────────────────────────────── */}
            <div>
              <label className={lbl}>When to run</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'scheduled',      label: 'Scheduled',            icon: CalendarDays, desc: 'Pick start & end date/time' },
                  { id: 'now_indefinite', label: 'Start now · Always on', icon: Zap,         desc: 'Runs immediately, never expires' },
                  { id: 'now_until',      label: 'Start now · Until…',    icon: Clock3,       desc: 'Starts now, you pick end time' },
                ] as { id: TimingMode; label: string; icon: React.ElementType; desc: string }[]).map((opt) => {
                  const active = form.timingMode === opt.id;
                  return (
                    <button key={opt.id} type="button" onClick={() => set('timingMode', opt.id)}
                      className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                        active ? 'border-primary/50 bg-primary/5' : 'border-border bg-background hover:border-primary/20'
                      }`}>
                      <opt.icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground/60'}`} />
                      <p className={`text-[11px] font-bold ${active ? 'text-primary' : 'text-foreground'}`}>{opt.label}</p>
                      <p className="text-[9px] text-muted-foreground/70 leading-tight">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date/time inputs (conditional) */}
            {form.timingMode !== 'now_indefinite' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {form.timingMode === 'scheduled' && (
                  <div>
                    <label className={lbl}>Start <span className="normal-case font-normal text-muted-foreground/50">({userTz})</span></label>
                    <input type="datetime-local" required step="60"
                      value={form.startAt}
                      min={nowLocal()}
                      onChange={(e) => set('startAt', e.target.value)} className={inp} />
                  </div>
                )}
                <div>
                  <label className={lbl}>
                    {form.timingMode === 'now_until' ? 'Run until' : 'End'}
                    <span className="normal-case font-normal text-muted-foreground/50 ml-1">({userTz})</span>
                  </label>
                  <input type="datetime-local" required step="60"
                    value={form.endAt}
                    min={form.timingMode === 'now_until' ? nowLocal() : form.startAt || nowLocal()}
                    onChange={(e) => set('endAt', e.target.value)} className={inp} />
                </div>
              </div>
            )}
            {isAlwaysOn && (
              <p className="text-[11px] text-green-700 bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
                Schedule starts immediately and runs indefinitely. Delete it manually to stop.
              </p>
            )}

            {/* ── Recurrence + Priority ─────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Recurrence</label>
                <select value={form.recurrence}
                  onChange={(e) => set('recurrence', e.target.value as Schedule['recurrence'])} className={inp}>
                  <option value="once">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Priority <span className="normal-case font-normal text-muted-foreground/60">(higher wins overlap)</span></label>
                <input type="number" min={0} max={10} value={form.priority}
                  onChange={(e) => set('priority', Number(e.target.value))} className={inp} />
              </div>
            </div>

            {/* ── Orientation ───────────────────────────────────────────── */}
            <div className="space-y-2">
              <label className={lbl}>Screen orientation</label>
              <div className="grid grid-cols-3 gap-2">
                {(['portrait', 'landscape', 'any'] as const).map((o) => {
                  const labels = {
                    portrait:  'Portrait (default)',
                    landscape: 'Landscape (TV)',
                    any:       'Any',
                  };
                  const active = form.orientation === o;
                  return (
                    <button key={o} type="button" onClick={() => set('orientation', o)}
                      className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-colors ${
                        active ? 'border-primary/50 bg-primary/5' : 'border-border bg-background hover:border-primary/20'
                      }`}>
                      <OrientationIcon o={o} size={15} />
                      <span className={`text-[11px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>
                        {labels[o]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Identifying rotation direction</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Stand facing the screen. If the TV&apos;s cable port / base faces <span className="font-semibold text-foreground">left → Clockwise (CW)</span>. If it faces <span className="font-semibold text-foreground">right → Anti-clockwise (CCW)</span>. Rotation is handled automatically by the ALIVE Player — select Portrait here and configure the exact direction in the Player&apos;s device settings.
                </p>
              </div>
            </div>

            {/* ── Playback frequency ────────────────────────────────────── */}
            <div>
              <label className={lbl}>
                Playback frequency
                <span className="normal-case font-normal text-muted-foreground/60 ml-1">— how often the playlist loops</span>
              </label>
              <div className="rounded-xl border border-border bg-background px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Continuous loop</span>
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    form.intervalMins === 0
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-foreground'
                  }`}>{intervalLabel}</span>
                  <span className="text-[11px] text-muted-foreground">Every hour</span>
                </div>
                <input
                  type="range" min={0} max={60} step={5}
                  value={form.intervalMins}
                  onChange={(e) => set('intervalMins', Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="grid grid-cols-7 gap-0 text-center">
                  {INTERVAL_MARKS.map((m) => (
                    <button key={m.value} type="button"
                      onClick={() => set('intervalMins', m.value)}
                      className={`text-[9px] rounded py-0.5 transition-colors ${
                        form.intervalMins === m.value
                          ? 'text-primary font-bold'
                          : 'text-muted-foreground/50 hover:text-foreground'
                      }`}>
                      {m.value === 0 ? '∞' : `${m.value}m`}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/70 leading-snug">
                  {form.intervalMins === 0
                    ? 'Playlist loops back-to-back continuously. Best for full-time brand takeovers.'
                    : `Playlist plays once, then waits until the ${form.intervalMins}-minute mark before repeating. ~${Math.floor(60 / form.intervalMins)} plays/hour. Good for periodic ads mixed with other content.`
                  }
                </p>
              </div>
            </div>

            {/* ── Targeting ─────────────────────────────────────────────── */}
            <div className="space-y-3">
              <label className={lbl}>Targeting</label>

              {/* Mode tabs */}
              <div className="flex flex-wrap gap-1.5">
                {TARGET_MODES.map((mode) => {
                  const active = form.targetMode === mode.id;
                  return (
                    <button key={mode.id} type="button"
                      onClick={() => set('targetMode', mode.id)}
                      title={mode.desc}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                        active
                          ? 'border-primary/50 bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/20'
                      }`}>
                      <mode.icon className="h-3 w-3" />
                      {mode.label}
                    </button>
                  );
                })}
              </div>

              {/* ── Device mode ─────────────────────────────────────────── */}
              {form.targetMode === 'device' && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                    <input
                      type="text"
                      placeholder="Search screens by name or location…"
                      value={deviceSearch}
                      onChange={(e) => setDeviceSearch(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                    {deviceSearch && (
                      <button type="button" onClick={() => setDeviceSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {form.selectedDevices.length > 0 && (
                    <p className="text-[10px] text-primary font-semibold">
                      {form.selectedDevices.length} screen{form.selectedDevices.length !== 1 ? 's' : ''} selected
                      {' '}·{' '}
                      <button type="button" className="underline" onClick={() => set('selectedDevices', [])}>
                        Clear all
                      </button>
                    </p>
                  )}
                  {!devices.length ? (
                    <p className="text-xs text-muted-foreground py-2">No screens registered yet.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                      {filteredDevices.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-4 py-3">No screens match &quot;{deviceSearch}&quot;</p>
                      ) : filteredDevices.map((d) => {
                        const checked = form.selectedDevices.includes(d.id);
                        return (
                          <button key={d.id} type="button" onClick={() => toggleDevice(d.id)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              checked ? 'bg-primary/5' : 'hover:bg-muted/30'
                            }`}>
                            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                              d.status === 'ONLINE' ? 'bg-green-500/10' : 'bg-muted'
                            }`}>
                              <Monitor className={`h-3.5 w-3.5 ${d.status === 'ONLINE' ? 'text-green-600' : 'text-muted-foreground/40'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{d.storeName}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`h-1.5 w-1.5 rounded-full ${
                                  d.status === 'ONLINE' ? 'bg-green-500' : d.status === 'OFFLINE' ? 'bg-red-400' : 'bg-yellow-400'
                                }`} />
                                <span className="text-[10px] text-muted-foreground capitalize">{d.status.toLowerCase()}</span>
                                {d.locality && <span className="text-[10px] text-muted-foreground/50">{d.locality}</span>}
                                {d.slotMode && (
                                  <span title="Slot mode — this screen ignores schedules"
                                    className="text-[9px] font-bold text-amber-700 bg-amber-500/10 rounded-full px-1.5 py-px">
                                    SLOT MODE
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center ${
                              checked ? 'border-primary bg-primary' : 'border-border'
                            }`}>
                              {checked && <div className="h-2 w-2 rounded-sm bg-white" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Group mode ───────────────────────────────────────────── */}
              {form.targetMode === 'group' && (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Type group name…"
                      value={groupSearch}
                      onChange={(e) => { setGroupSearch(e.target.value); set('groupName', e.target.value); setGroupOpen(true); }}
                      onFocus={() => setGroupOpen(true)}
                      onBlur={() => setTimeout(() => setGroupOpen(false), 150)}
                      className={inp}
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
                    {groupOpen && filteredGroups.length > 0 && (
                      <div className="absolute z-10 top-full mt-1 w-full rounded-xl border border-border bg-background shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                        {filteredGroups.map((g) => (
                          <button key={g.name} type="button"
                            onMouseDown={() => {
                              set('groupName', g.name);
                              setGroupSearch(g.name);
                              setGroupOpen(false);
                            }}
                            className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40 transition-colors">
                            <div>
                              <p className="text-xs font-semibold text-foreground">{g.name}</p>
                              <p className="text-[10px] text-muted-foreground">{g.total} screen{g.total !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-green-600 font-semibold">{g.online} on</span>
                              {g.offline > 0 && <span className="text-[10px] text-red-500 font-semibold">{g.offline} off</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {groups.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">No groups yet — type a new group name and assign screens from the Screens tab first.</p>
                  )}
                </div>
              )}

              {/* ── Store mode ───────────────────────────────────────────── */}
              {form.targetMode === 'store' && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                    <input
                      type="text"
                      placeholder="Search stores by name, locality or city…"
                      value={storeQuery}
                      onChange={(e) => setStoreQuery(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                    {storeLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
                  </div>
                  {/* Selected stores chips */}
                  {selectedStores.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedStores.map((s) => (
                        <span key={s.id} className="flex items-center gap-1 bg-primary/10 text-primary text-[11px] font-semibold rounded-full px-2.5 py-1">
                          {s.storeName}
                          <button type="button" onClick={() => toggleStore(s)} className="ml-0.5 hover:text-primary/70">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Store results */}
                  {storeResults.length > 0 && (
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                      {storeResults.map((s) => {
                        const checked = form.storeIds.includes(s.id);
                        return (
                          <button key={s.id} type="button" onClick={() => toggleStore(s)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              checked ? 'bg-primary/5' : 'hover:bg-muted/30'
                            }`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{s.storeName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {[s.locality, s.city].filter(Boolean).join(', ')}
                                {' · '}{s.screenCount} screen{s.screenCount !== 1 ? 's' : ''}
                                {s.loopSlotCount != null && (
                                  <span title="Slot mode — screens here ignore schedules" className="font-semibold text-amber-700"> · slot mode</span>
                                )}
                              </p>
                            </div>
                            <div className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center ${
                              checked ? 'border-primary bg-primary' : 'border-border'
                            }`}>
                              {checked && <div className="h-2 w-2 rounded-sm bg-white" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!storeLoading && storeResults.length === 0 && storeQuery && (
                    <p className="text-xs text-muted-foreground px-1">No stores found for &quot;{storeQuery}&quot;</p>
                  )}
                </div>
              )}

              {/* ── City mode ────────────────────────────────────────────── */}
              {form.targetMode === 'city' && (
                <div className="space-y-2">
                  {cities.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No cities found — link screens to stores first.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {cities.map((city) => {
                        const active = form.cityFilter === city;
                        return (
                          <button key={city} type="button"
                            onClick={() => set('cityFilter', active ? '' : city)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              active
                                ? 'border-primary/50 bg-primary/5 text-primary'
                                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/20'
                            }`}>
                            {city}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.cityFilter && (
                    <p className="text-[10px] text-muted-foreground/60">
                      Dynamically targets all screens whose store is in <strong className="text-foreground">{form.cityFilter}</strong>. New screens auto-included.
                    </p>
                  )}
                </div>
              )}

              {/* Live targeting preview */}
              <TargetingPreview
                targetMode={form.targetMode}
                selectedDevices={form.selectedDevices}
                groupName={form.groupName}
                storeIds={form.storeIds}
                cityFilter={form.cityFilter}
                devices={devices}
                groups={groups}
                selectedStores={selectedStores}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {saving
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                  : editId
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> Update schedule</>
                    : 'Save schedule'
                }
              </button>
              <button type="button" onClick={closeForm}
                className="rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Schedule list */}
      {schedules.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? 's' : ''}</p>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setListView('list')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${listView === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutList className="h-3 w-3" /> List
            </button>
            <button
              onClick={() => setListView('calendar')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${listView === 'calendar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <CalendarRange className="h-3 w-3" /> Calendar
            </button>
          </div>
        </div>
      )}

      {!schedules.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 py-16">
          <CalendarClock className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No schedules yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Create one to push content to your screens.</p>
        </div>
      ) : listView === 'calendar' ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <ScheduleCalendar schedules={schedules} />
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {['Name', 'Playlist', 'Targeting', 'Start', 'End', 'Recurrence', 'Orientation', 'Frequency', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schedules.map((s) => {
                const pl = playlists.find((p) => p.id === s.playlistId);
                const isAlwaysOnRow = s.endAt > '2090-01-01';
                const isEditing = editId === s.id;

                // Build targeting label
                let targetingLabel: React.ReactNode = 'All screens';
                let targetingIcon: React.ElementType = Globe;
                if (s.deviceIds?.length) {
                  targetingLabel = `${s.deviceIds.length} screen${s.deviceIds.length !== 1 ? 's' : ''}`;
                  targetingIcon = Monitor;
                } else if (s.groupName) {
                  targetingLabel = `Group: ${s.groupName}`;
                  targetingIcon = Users;
                } else if (s.storeIds?.length) {
                  targetingLabel = `${s.storeIds.length} store${s.storeIds.length !== 1 ? 's' : ''}`;
                  targetingIcon = Store;
                } else if (s.cityFilter) {
                  targetingLabel = s.cityFilter;
                  targetingIcon = MapPin;
                }
                const TargetIcon = targetingIcon;

                return (
                  <tr key={s.id} className={`transition-colors ${isEditing ? 'bg-primary/5' : 'hover:bg-muted/20'}`}>
                    <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                      {s.name}
                      {s.priority > 0 && (
                        <span className="ml-1.5 text-[9px] font-bold bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded-full">P{s.priority}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{pl?.name ?? s.playlist?.name ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <TargetIcon className="h-3 w-3" />
                        {targetingLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {isAlwaysOnRow ? <span className="text-green-600 font-semibold">Now</span> : fmtDateTime(s.startAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {isAlwaysOnRow ? <span className="text-muted-foreground/40 italic text-[10px]">Indefinite</span> : fmtDateTime(s.endAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="brand" className="text-[10px] py-0.5 px-2 font-bold whitespace-nowrap">
                        <CalendarClock className="h-2.5 w-2.5" />{RECURRENCE_LABELS[s.recurrence]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <OrientationIcon o={(s.orientation as 'landscape' | 'portrait' | 'any') ?? 'portrait'} size={12} />
                        <span className="capitalize">{s.orientation ?? 'portrait'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-[10px]">
                      {s.intervalMins ? `Every ${s.intervalMins}m` : '∞ Loop'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(s)}
                          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                            isEditing
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-blue-500/30 bg-blue-500/5 text-blue-600 hover:bg-blue-500/15'
                          }`}>
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button onClick={() => del(s.id)} disabled={deleting === s.id}
                          className="flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10px] font-semibold text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-40">
                          {deleting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
