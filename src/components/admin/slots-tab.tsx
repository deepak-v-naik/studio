'use client';

// Slot inventory grid: rows = stores, columns = dates, cell = sold/total (heat-coloured).
// Click a cell to expand its loop positions and assign/unassign campaigns.
// Closed days (per the store's openDays bitmask) render greyed and are not clickable.
//
// Filler/bonus fill is deliberately NOT part of the sold count — the cell shows what is
// sold; the expanded panel shows what will actually play (bonus + house fill included).

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Check, Settings2, Gift } from 'lucide-react';
import {
  getSlotAvailability, getSlotBookings, assignSlot, unassignSlot, updateSlotSettings,
  type SlotStore, type SlotBookingRow, type SlotLoopEntry,
} from '@/lib/backend-api';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';

type AdminCampaign = { id: string; brandName: string; status: string; slotContentId: string | null };

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;

const istTodayStr = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const dayLabel = (d: string) => {
  const dt = new Date(`${d}T00:00:00Z`);
  return { dow: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][(dt.getUTCDay() + 6) % 7], day: dt.getUTCDate() };
};

/** Heat colour by sold ratio — sold-out is a strong signal, not an alarm. */
function heat(sold: number, total: number): string {
  if (total <= 0) return 'bg-muted text-muted-foreground';
  const r = sold / total;
  if (r === 0)   return 'bg-background text-muted-foreground/60 border-border';
  if (r < 0.5)   return 'bg-green-50 text-green-800 border-green-200';
  if (r < 1)     return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-primary/10 text-primary border-primary/30 font-bold';
}

export default function SlotsTab() {
  const [from,     setFrom]     = useState(istTodayStr());
  const [stores,   setStores]   = useState<SlotStore[]>([]);
  const [dates,    setDates]    = useState<string[]>([]);
  const [defaultFiller, setDefaultFiller] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [cell,     setCell]     = useState<{ store: SlotStore; date: string } | null>(null);
  const [configStore, setConfigStore] = useState<SlotStore | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getSlotAvailability(from, addDays(from, WINDOW_DAYS - 1))
      .then((r) => { setStores(r.stores); setDates(r.dates); setDefaultFiller(r.defaultFillerCampaignId); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const pw = sessionStorage.getItem('alive_admin_pw') ?? '';
    fetch('/api/campaigns/admin', { headers: { 'admin-password': pw } })
      .then((r) => r.json() as Promise<AdminCampaign[]>)
      .then((cs) => setCampaigns(Array.isArray(cs) ? cs : []))
      .catch(() => setCampaigns([]));
  }, []);

  const slotStores = stores.filter((s) => s.loopSlotCount != null);
  const offStores  = stores.filter((s) => s.loopSlotCount == null);

  if (loading && !stores.length) return (
    <div className="space-y-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
  );
  if (error) return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 flex gap-3">
      <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
      <div><p className="text-sm font-semibold text-foreground">Could not load slot inventory</p>
        <p className="text-xs text-muted-foreground mt-0.5">{error}</p></div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-foreground">Slot inventory</p>
          <p className="text-[11px] text-muted-foreground">
            Sold slots per store per day. Empty slots never go dark — they replay sold campaigns as bonus plays, or house ads when nothing is sold.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFrom(addDays(from, -WINDOW_DAYS))}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setFrom(istTodayStr())}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors">
            Today
          </button>
          <button onClick={() => setFrom(addDays(from, WINDOW_DAYS))}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Grid */}
      {!slotStores.length ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 py-12 text-center">
          <p className="text-sm text-muted-foreground">No stores are in slot mode yet.</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">Set a loop slot count on a store below to start selling slot inventory.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Store</th>
                {dates.map((d) => {
                  const { dow, day } = dayLabel(d);
                  return (
                    <th key={d} className="px-1 py-2 text-center min-w-[44px]">
                      <span className="block text-[9px] font-bold uppercase text-muted-foreground/60">{dow}</span>
                      <span className="block text-[11px] font-semibold text-foreground">{day}</span>
                    </th>
                  );
                })}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {slotStores.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 min-w-[150px]">
                    <p className="text-[11px] font-semibold text-foreground truncate">{s.storeName}</p>
                    <p className="text-[9px] text-muted-foreground">{s.city ?? '—'} · {s.loopSlotCount} slots · {s.hoursStart}–{s.hoursEnd}</p>
                  </td>
                  {dates.map((d) => {
                    const sold = s.sold?.[d];
                    const closed = sold === null || sold === undefined;
                    return (
                      <td key={d} className="px-1 py-1 text-center">
                        {closed ? (
                          <span title="Store closed" className="block rounded-md bg-muted/40 px-1 py-1.5 text-[10px] text-muted-foreground/40">—</span>
                        ) : (
                          <button
                            onClick={() => setCell({ store: s, date: d })}
                            className={`block w-full rounded-md border px-1 py-1.5 text-[10px] transition-colors hover:ring-1 hover:ring-primary/40 ${heat(sold, s.loopSlotCount!)}`}
                          >
                            {sold}/{s.loopSlotCount}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2">
                    <button onClick={() => setConfigStore(s)} title="Slot settings"
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stores not yet in slot mode */}
      {offStores.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Not in slot mode</p>
          <div className="flex flex-wrap gap-2">
            {offStores.map((s) => (
              <button key={s.id} onClick={() => setConfigStore(s)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                <Settings2 className="h-3 w-3" />{s.storeName}
              </button>
            ))}
          </div>
        </div>
      )}

      {cell && (
        <SlotEditor
          store={cell.store} date={cell.date} campaigns={campaigns}
          onClose={() => setCell(null)} onChanged={load}
        />
      )}
      {configStore && (
        <StoreSlotSettings
          store={configStore} campaigns={campaigns} defaultFiller={defaultFiller}
          onClose={() => setConfigStore(null)}
          onSaved={() => { setConfigStore(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Per-cell slot editor ─────────────────────────────────────────────────────

function SlotEditor({ store, date, campaigns, onClose, onChanged }: {
  store: SlotStore; date: string; campaigns: AdminCampaign[];
  onClose: () => void; onChanged: () => void;
}) {
  const [bookings, setBookings] = useState<SlotBookingRow[]>([]);
  const [loop,     setLoop]     = useState<SlotLoopEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState<number | null>(null);

  const load = useCallback(() => {
    getSlotBookings(store.id, date)
      .then((r) => { setBookings(r.bookings); setLoop(r.playableLoop); })
      .catch((e: Error) => toast({ variant: 'destructive', title: 'Could not load slots', description: e.message }))
      .finally(() => setLoading(false));
  }, [store.id, date]);

  useEffect(() => { load(); }, [load]);

  const assign = async (slotPosition: number, campaignId: string) => {
    setBusy(slotPosition);
    try {
      await assignSlot({ storeId: store.id, date, slotPosition, campaignId });
      load(); onChanged();
      toast({ title: 'Slot assigned ✓' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Assign failed', description: (e as Error).message });
    } finally { setBusy(null); }
  };

  const unassign = async (booking: SlotBookingRow) => {
    setBusy(booking.slotPosition);
    try {
      await unassignSlot(booking.id);
      load(); onChanged();
      toast({ title: 'Slot cleared', description: 'It will replay a sold campaign as a bonus play.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Unassign failed', description: (e as Error).message });
    } finally { setBusy(null); }
  };

  const byPos = new Map(bookings.map((b) => [b.slotPosition, b]));
  const loopByPos = new Map(loop.map((l) => [l.slotPosition, l]));
  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.brandName ?? id.slice(0, 8);
  const sellable = campaigns.filter((c) => c.status !== 'cancelled');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <p className="text-sm font-bold text-foreground">{store.storeName}</p>
            <p className="text-[11px] text-muted-foreground">{date} · {bookings.length}/{store.loopSlotCount} sold</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="p-5 space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
        ) : (
          <div className="divide-y divide-border">
            {Array.from({ length: store.loopSlotCount ?? 0 }, (_, pos) => {
              const booking = byPos.get(pos);
              const playing = loopByPos.get(pos);
              return (
                <div key={pos} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-6 text-[10px] font-bold text-muted-foreground/60">#{pos + 1}</span>
                  <div className="flex-1 min-w-0">
                    {booking ? (
                      <>
                        <p className="text-xs font-semibold text-foreground truncate">{booking.campaignName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {booking.hasCreative
                            ? 'Sold · guaranteed'
                            : <span className="text-amber-600">Sold but no 10s creative — plays as bonus/house fill</span>}
                        </p>
                      </>
                    ) : playing ? (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Gift className="h-3 w-3 text-green-600" />
                        Empty — bonus play for <span className="font-semibold text-foreground">{campaignName(playing.campaignId)}</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/60">Empty — no filler creative configured</p>
                    )}
                  </div>
                  <select
                    value={booking?.campaignId ?? ''}
                    disabled={busy === pos}
                    onChange={(e) => e.target.value ? assign(pos, e.target.value) : booking && unassign(booking)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary max-w-[200px]"
                  >
                    <option value="">— empty —</option>
                    {sellable.map((c) => (
                      <option key={c.id} value={c.id}>{c.brandName}{c.slotContentId ? '' : ' (no creative)'}</option>
                    ))}
                  </select>
                  {busy === pos && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Per-store slot settings ──────────────────────────────────────────────────

const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function StoreSlotSettings({ store, campaigns, defaultFiller, onClose, onSaved }: {
  store: SlotStore; campaigns: AdminCampaign[]; defaultFiller: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [enabled,  setEnabled]  = useState(store.loopSlotCount != null);
  const [count,    setCount]    = useState(store.loopSlotCount ?? 6);
  const [openDays, setOpenDays] = useState(store.openDays);
  const [start,    setStart]    = useState(store.hoursStart);
  const [end,      setEnd]      = useState(store.hoursEnd);
  const [filler,   setFiller]   = useState(store.fillerCampaignId ?? '');
  const [saving,   setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateSlotSettings({
        storeId: store.id,
        loopSlotCount: enabled ? count : null,
        openDays, hoursStart: start, hoursEnd: end,
        fillerCampaignId: filler || null,
      });
      toast({ title: 'Slot settings saved ✓' });
      onSaved();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Save failed', description: (e as Error).message });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-bold text-foreground">{store.storeName} — slot settings</p>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
            <span className="text-xs font-semibold text-foreground">Slot mode</span>
            <span className="text-[10px] text-muted-foreground">— screen runs the fixed ad loop instead of its schedules</span>
          </label>

          <div className={enabled ? '' : 'opacity-40 pointer-events-none'}>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                  Slots per loop <span className="font-normal normal-case tracking-normal text-muted-foreground/70">— how many brands this store can run</span>
                </label>
                <input type="number" min={1} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary" />
                <span className="ml-2 text-[10px] text-muted-foreground">× 10s = {count * 10}s per loop</span>
                {store.loopSlotCount != null && count < store.loopSlotCount && (
                  <p className="mt-1 text-[10px] text-amber-600">
                    Reducing from {store.loopSlotCount}. Upcoming bookings above slot {count} must be reassigned first — the save will tell you which.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Open days</label>
                <div className="flex gap-1">
                  {DOW.map((d, i) => {
                    const on = (openDays & (1 << i)) !== 0;
                    return (
                      <button key={d} onClick={() => setOpenDays(on ? openDays & ~(1 << i) : openDays | (1 << i))}
                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                          on ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground/50'
                        }`}>{d}</button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Opens</label>
                  <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Closes</label>
                  <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Filler campaign</label>
                <select value={filler} onChange={(e) => setFiller(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary">
                  <option value="">Use default house ads{defaultFiller ? '' : ' (none set)'}</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.brandName}</option>)}
                </select>
                <p className="mt-1 text-[10px] text-muted-foreground">Plays only when nothing is sold for the day.</p>
              </div>
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
