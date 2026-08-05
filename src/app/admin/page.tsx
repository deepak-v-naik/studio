'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Trash2, Upload, ImageIcon, Store, BarChart3, FileImage,
  Phone, MapPin, CheckCircle2, Clock, X, MessageCircle, ExternalLink,
  IndianRupee, Eye, Package, Ticket, Star,
  Tv2, CalendarClock, FileBarChart2, Activity,
  ChevronRight, LogOut, LayoutDashboard, LayoutGrid, Images, Map, Layers,
  // New icons for the redesign
  MonitorPlay,
  Search, Bell, Moon, Sun, LifeBuoy, Download, Plus,
  Megaphone, Image, Radar,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/ui/badge';
import './admin.css';

const ScreensTab      = dynamic(() => import('@/components/admin/screens-tab'),       { ssr: false });
const ReportsTab      = dynamic(() => import('@/components/admin/reports-tab'),       { ssr: false });
const ContentTab      = dynamic(() => import('@/components/admin/content-tab'),       { ssr: false });
const ProgrammingTab  = dynamic(() => import('@/components/admin/programming-tab'),  { ssr: false });
const CompositionsTab = dynamic(() => import('@/components/admin/compositions-tab'), { ssr: false });
const LayoutsTab      = dynamic(() => import('@/components/admin/layouts-tab'),       { ssr: false });
const MonitoringTab   = dynamic(() => import('@/components/admin/monitoring-tab'),   { ssr: false });
const FootfallTab     = dynamic(() => import('@/components/admin/footfall-tab'),     { ssr: false });
const StorePaymentsTab = dynamic(() => import('@/components/admin/store-payments-tab'), { ssr: false });
const SiteMediaTab     = dynamic(() => import('@/components/admin/site-media-tab'),     { ssr: false });
const RoadmapTab       = dynamic(() => import('@/components/admin/roadmap-tab'),        { ssr: false });
const ProductsTab      = dynamic(() => import('@/components/admin/products-tab'),       { ssr: false });
const AlertsTab        = dynamic(() => import('@/components/admin/alerts-tab'),         { ssr: false });
const AutoFlyerPanel   = dynamic(() => import('@/components/admin/auto-flyer-panel'),   { ssr: false });
const AppPreviewCard   = dynamic(() => import('@/components/admin/app-preview-card'),   { ssr: false });
const CouponsTab       = dynamic(() => import('@/components/admin/coupons-tab'),         { ssr: false });
import { Logo } from '@/components/icons/logo';

// ─── Types ───────────────────────────────────────────────────────────────────

type Flyer = {
  id: string; storeName: string; title: string;
  description: string; validUntil: string; imageBase64: string; createdAt: string;
};
type StoreReg = {
  id: string; storeName: string; ownerName: string; phone: string;
  whatsapp: string; address?: string; locality: string; city: string; pincode: string;
  lat?: string; lng?: string; gstin?: string; email?: string; createdAt: string;
  onboardingStage?: string | null; payoutStatus?: string | null; payoutMethod?: string | null; upiId?: string | null;
  tier?: string | null; monthlyCompensationPaise?: number | null;
  bankAccountName?: string; bankAccountNo?: string; bankIfsc?: string; bankName?: string;
  payoutLastPaidAt?: string | null; payoutNotes?: string | null;
  referralCode?: string; referredBy?: string | null; agreedAt?: string | null; liveAt?: string | null;
  deviceCount?: number;
};
type Campaign = {
  id: string; brandId: string | null; brandName: string; contactName: string; email: string;
  phone: string; screens: number; months: number; startDate: string;
  pricePerScreen: number; totalAmount: number; paymentId: string;
  status: 'upcoming' | 'active' | 'completed' | 'trial'; createdAt: string;
  trialOfferedAt: string | null; trialUsedAt: string | null;
};

// ─── Nav config ──────────────────────────────────────────────────────────────

type Tab = 'overview' | 'flyers' | 'stores' | 'campaigns' | 'payments' | 'coupons' | 'screens' | 'content' | 'programming' | 'compositions' | 'layouts' | 'reports' | 'monitoring' | 'footfall' | 'alerts' | 'media' | 'roadmap' | 'products';
type DeviceRow = { id: string; storeName: string; status: string; lastSeen?: string | null; locality?: string | null };

const NAV: { group: string; items: { id: Tab; label: string; icon: React.ElementType; badge?: string }[] }[] = [
  {
    group: 'Overview',
    items: [
      { id: 'overview',   label: 'Dashboard',   icon: LayoutDashboard },
    ],
  },
  {
    group: 'Operations',
    items: [
      { id: 'flyers',     label: 'Flyers',      icon: FileImage   },
      { id: 'stores',     label: 'Stores',      icon: Store       },
      { id: 'products',   label: 'Products',    icon: Package     },
      { id: 'campaigns',  label: 'Campaigns',   icon: BarChart3   },
      { id: 'payments',   label: 'Payments',    icon: IndianRupee },
      { id: 'coupons',    label: 'Coupons',     icon: Ticket      },
    ],
  },
  {
    group: 'Screen Network',
    items: [
      { id: 'screens',    label: 'Screens',     icon: Tv2         },
      { id: 'content',    label: 'Content',     icon: ImageIcon   },
      { id: 'programming',  label: 'Programming',  icon: LayoutGrid    },
      { id: 'compositions', label: 'Compositions', icon: CalendarClock },
      { id: 'layouts',    label: 'Layouts',     icon: Layers       },
      { id: 'reports',    label: 'Reports',     icon: FileBarChart2 },
      { id: 'monitoring', label: 'Monitoring',  icon: Activity    },
    ],
  },
  {
    group: 'Site',
    items: [
      { id: 'media',      label: 'Media',       icon: Images      },
    ],
  },
  {
    group: 'Platform',
    items: [
      { id: 'alerts',     label: 'Alerts',       icon: Bell       },
      { id: 'roadmap',    label: 'Platform Map', icon: Map        },
    ],
  },
];

const PAGE_META: Record<Tab, { eyebrow: string; title: string }> = {
  overview:   { eyebrow: 'ALIVE Admin',        title: 'Dashboard'          },
  flyers:     { eyebrow: 'Flyer management',   title: 'Published flyers'   },
  stores:     { eyebrow: 'Store partners',     title: 'Registered stores'  },
  campaigns:  { eyebrow: 'Brand campaigns',    title: 'All campaigns'      },
  payments:   { eyebrow: 'Store payouts',      title: 'Partner payments'   },
  coupons:    { eyebrow: 'Brand discounts',    title: 'Coupons'            },
  screens:    { eyebrow: 'Screen fleet',       title: 'Registered screens' },
  content:    { eyebrow: 'Media library',      title: 'Content'            },
  programming:  { eyebrow: 'Screen programming', title: 'Programming'        },
  compositions: { eyebrow: 'Content delivery',   title: 'Compositions'       },
  layouts:    { eyebrow: 'On-screen overlays', title: 'Layouts & tickers'  },
  reports:    { eyebrow: 'Proof of play',      title: 'Play reports'       },
  monitoring: { eyebrow: 'Live network',       title: 'Monitoring'         },
  footfall:   { eyebrow: 'In-store presence',  title: 'Footfall'           },
  media:      { eyebrow: 'Site management',    title: 'Homepage media'     },
  products:   { eyebrow: 'Product catalogue',  title: 'Master Products'    },
  alerts:     { eyebrow: 'System status',      title: 'Alerts'             },
  roadmap:    { eyebrow: 'ALIVE PLATFORM',     title: 'Platform Roadmap'   },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SS_PW = 'alive_admin_pw';

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
function resolveImage(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}
function fmt(n: number) { return `₹${n.toLocaleString('en-IN')}`; }

function compressImage(dataUrl: string, maxPx = 1200, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    const img = document.createElement('img') as HTMLImageElement;
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

// ─── Animations ──────────────────────────────────────────────────────────────

const fadeIn  = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } };
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } } };
const inp = 'w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';
const lbl = 'block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1';

// ─── Flyer image modal ────────────────────────────────────────────────────────

function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Flyer preview" className="max-h-[90vh] max-w-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ─── Upload Flyer Panel ───────────────────────────────────────────────────────

function UploadPanel({ onSaved }: { onSaved: () => void }) {
  const [form,        setForm]        = useState({ storeName: '', title: '', description: '', validUntil: '' });
  const [preview,     setPreview]     = useState('');
  const [imgB64,      setImgB64]      = useState('');
  const [busy,        setBusy]        = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [ok,          setOk]          = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      setPreview(raw);
      setImgB64(await compressImage(raw, 1200, 0.75));
      setCompressing(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.storeName || !form.title || !form.validUntil) return;
    setBusy(true); setError(null);
    try {
      const pw  = sessionStorage.getItem(SS_PW) ?? '';
      const res = await fetch('/api/flyers/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'admin-password': pw },
        body:   JSON.stringify({ ...form, imageBase64: imgB64 }),
      });
      const body = await res.json() as { success?: boolean; id?: string; error?: string; note?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.note) setError('Saved in memory only (Redis not configured). Flyers won\'t persist across deploys.');
      setForm({ storeName: '', title: '', description: '', validUntil: '' });
      setPreview(''); setImgB64('');
      if (fileRef.current) fileRef.current.value = '';
      if (!body.note) { setOk(true); setTimeout(() => setOk(false), 4000); }
      onSaved();
    } catch (e) {
      setError((e as Error).message ?? 'Error saving flyer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Upload flyer</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div><label className={lbl}>Store name</label>
          <input type="text" required value={form.storeName} onChange={(e) => set('storeName', e.target.value)} placeholder="Sharma General Store" className={inp} /></div>
        <div><label className={lbl}>Offer title</label>
          <input type="text" required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="WOW Summer Offer — Up to 60% off" className={inp} /></div>
        <div><label className={lbl}>Description <span className="normal-case font-normal text-muted-foreground/60">(optional)</span></label>
          <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Available at all affiliated Alive stores…" className={inp + ' resize-none'} /></div>
        <div><label className={lbl}>Valid until</label>
          <input type="date" required value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} className={inp} /></div>
        <div>
          <label className={lbl}>Flyer image {compressing && <span className="normal-case font-normal text-primary/60">(compressing…)</span>}</label>
          <div onClick={() => fileRef.current?.click()} className="relative cursor-pointer rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 transition-colors overflow-hidden">
            {preview
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview} alt="Preview" className="w-full max-h-52 object-contain" />
              : <div className="flex flex-col items-center justify-center h-28 gap-2 text-muted-foreground/50"><ImageIcon className="h-7 w-7" /><span className="text-xs font-semibold">Click to upload</span><span className="text-[10px] text-muted-foreground/40">Auto-compressed for storage</span></div>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </div>
        {error && <p className="text-xs text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">{error}</p>}
        {ok    && <p className="text-xs text-green-600 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2">Flyer published ✓</p>}
        <button type="submit" disabled={busy || compressing || !form.storeName || !form.title || !form.validUntil}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4" /> Publish flyer</>}
        </button>
      </form>
    </div>
  );
}

// ─── Flyer List ───────────────────────────────────────────────────────────────

function FlyersList({ refresh }: { refresh: number }) {
  const [flyers,   setFlyers]   = useState<Flyer[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [modal,    setModal]    = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/flyers/save')
      .then((r) => r.json() as Promise<Flyer[]>)
      .then(setFlyers).catch(() => setFlyers([]))
      .finally(() => setLoading(false));
  }, [refresh]);

  const del = async (id: string) => {
    if (!confirm('Delete this flyer?')) return;
    setDeleting(id);
    const pw = sessionStorage.getItem(SS_PW) ?? '';
    await fetch('/api/flyers/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'admin-password': pw },
      body:   JSON.stringify({ id }),
    }).finally(() => { setDeleting(null); setFlyers((f) => f.filter((x) => x.id !== id)); });
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!flyers.length) return <p className="text-sm text-muted-foreground text-center py-12">No flyers published yet.</p>;

  return (
    <>
      {modal && <ImageModal src={modal} onClose={() => setModal(null)} />}
      <div className="grid grid-cols-2 gap-3">
        {flyers.map((f) => {
          const img = resolveImage(f.imageBase64);
          return (
            <div key={f.id} className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
              <div className="relative cursor-pointer bg-muted overflow-hidden" onClick={() => img && setModal(img)}>
                {img
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt={f.title} className="w-full aspect-video object-cover hover:scale-105 transition-transform duration-300" />
                  : <div className="w-full aspect-video flex items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground/30" /></div>}
                {img && <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center"><Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100" /></div>}
              </div>
              <div className="p-3 flex-1 flex flex-col gap-1">
                <span className="text-[10px] font-bold text-primary">{f.storeName}</span>
                <p className="text-xs font-semibold text-foreground line-clamp-1">{f.title}</p>
                <p className="text-[10px] text-muted-foreground/60">Valid until {fmtDate(f.validUntil)}</p>
                <div className="mt-auto pt-2">
                  <button onClick={() => del(f.id)} disabled={deleting === f.id}
                    className="w-full flex items-center justify-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 py-1.5 text-[11px] font-semibold text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-40">
                    {deleting === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Trash2 className="h-3 w-3" /> Delete</>}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Stores Panel ─────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  new: 'New', physically_onboarded: 'Physically onboarded',
  digitally_onboarded: 'Digitally onboarded', live: 'Live', rejected: 'Rejected',
};
const STAGE_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600', physically_onboarded: 'bg-blue-50 text-blue-600',
  digitally_onboarded: 'bg-indigo-50 text-indigo-600', live: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-500',
};

function openAsPartner(s: StoreReg) {
  const session = {
    storeName: s.storeName, ownerName: s.ownerName,
    whatsapp: s.whatsapp, phone: s.phone || s.whatsapp,
    address: s.address, locality: s.locality, city: s.city, pincode: s.pincode,
    lat: s.lat, lng: s.lng, gstin: s.gstin || null,
    referralCode: s.referralCode, referredBy: s.referredBy || null,
    agreedAt: s.agreedAt || null, liveAt: s.liveAt || null,
    upiId: s.upiId || null, payoutMethod: s.payoutMethod || null,
    id: s.id,
  };
  localStorage.setItem('alive_store_session', JSON.stringify(session));
  window.open('/store-dashboard', '_blank');
}

function StoresPanel() {
  const [stores,   setStores]   = useState<StoreReg[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving,   setSaving]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    const pw = sessionStorage.getItem(SS_PW) ?? '';
    fetch('/api/stores/save', { headers: { 'admin-password': pw } })
      .then((r) => r.json())
      .then((body) => {
        const arr = Array.isArray(body) ? body : (body?.data ?? []);
        setStores(arr as StoreReg[]);
      })
      .catch(() => setStores([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveStore = async (store: StoreReg) => {
    setSaving(store.id);
    try {
      const pw = sessionStorage.getItem(SS_PW) ?? '';
      const res = await fetch(`/api/admin/stores/${store.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'admin-password': pw },
        body: JSON.stringify({
          onboardingStage: store.onboardingStage,
          payoutStatus: store.payoutStatus,
          payoutNotes: store.payoutNotes || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
    } finally { setSaving(null); }
  };

  const deleteStore = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}" and their account? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const pw = sessionStorage.getItem(SS_PW) ?? '';
      const res = await fetch(`/api/admin/stores/${id}`, { method: 'DELETE', headers: { 'admin-password': pw } });
      if (!res.ok) { const b = await res.json() as { error?: string }; alert(b.error ?? 'Delete failed'); return; }
      setStores((all) => all.filter((s) => s.id !== id));
    } finally { setDeleting(null); }
  };

  const patchLocal = (id: string, patch: Partial<StoreReg>) =>
    setStores((all) => all.map((x) => x.id === id ? { ...x, ...patch } : x));

  const filtered = stores.filter((s) =>
    !search ||
    s.storeName.toLowerCase().includes(search.toLowerCase()) ||
    (s.ownerName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (s.city ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (s.phone ?? '').includes(search) || (s.whatsapp ?? '').includes(search) ||
    (s.referralCode ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const live     = stores.filter((s) => s.onboardingStage === 'live').length;
  const pending  = stores.filter((s) => !s.onboardingStage || s.onboardingStage === 'new').length;
  const screened = stores.filter((s) => (s.deviceCount ?? 0) > 0).length;
  const premium  = stores.filter((s) => s.tier === 'premium').length;

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Registered',  value: stores.length },
          { label: 'Live',        value: live },
          { label: 'Pending',     value: pending },
          { label: 'With screen', value: screened },
          { label: 'Premium',     value: premium },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <input type="search" placeholder="Search by name, owner, city, phone, referral code…" value={search} onChange={(e) => setSearch(e.target.value)} className={inp} />

      {!filtered.length ? (
        <p className="text-sm text-muted-foreground text-center py-10">{search ? 'No stores match.' : 'No store registrations yet.'}</p>
      ) : (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-2">
          {filtered.map((s) => {
            const stage      = s.onboardingStage ?? 'new';
            const isRejected = stage === 'rejected';
            const isExpanded = expanded === s.id;
            const phone      = s.phone || s.whatsapp;
            const waNum      = (phone ?? '').replace(/\D/g, '').slice(-10);
            return (
              <motion.div key={s.id} variants={fadeIn} className={`rounded-xl border bg-card ${isRejected ? 'border-red-200 opacity-70' : 'border-border'}`}>
                {/* Top row — always visible */}
                <div className="flex items-start gap-3 p-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-sm ${isRejected ? 'bg-red-50 text-red-400' : 'bg-primary/10 text-primary'}`}>
                    {s.storeName[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          {s.storeName}
                          {s.tier === 'premium' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                              <Star className="h-2.5 w-2.5" /> Premium
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{s.ownerName}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {s.tier === 'premium' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            ₹{Math.round((s.monthlyCompensationPaise ?? 100000) / 100).toLocaleString('en-IN')}/mo
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STAGE_LABELS[stage] ?? stage}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(s.deviceCount ?? 0) > 0 ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                          {s.deviceCount ?? 0} screen{(s.deviceCount ?? 0) !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">{fmtDate(s.createdAt)}</span>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{phone ? `+91 ${waNum}` : '—'}</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{[s.locality, s.city].filter(Boolean).join(', ') || '—'}</span>
                      {s.referralCode && <span className="flex items-center gap-1 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">ref: {s.referralCode}</span>}
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {waNum.length === 10 && (
                        <a
                          href={`https://wa.me/91${waNum}?text=${encodeURIComponent(`Hi ${s.ownerName}, this is the ALIVE team regarding your store ${s.storeName}.`)}`}
                          target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg border border-[#25D366]/30 bg-[#25D366]/8 px-2.5 py-1.5 text-[11px] font-semibold text-[#25D366] hover:bg-[#25D366]/15 transition-colors"
                        >
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openAsPartner(s)}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" /> View dashboard
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : s.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? 'Less' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteStore(s.id, s.storeName)}
                        disabled={deleting === s.id}
                        className="ml-auto flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      >
                        {deleting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
                    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {s.address && <span><span className="font-semibold text-foreground/60">Address:</span> {s.address}, {s.pincode}</span>}
                      {s.gstin   && <span><span className="font-semibold text-foreground/60">GST:</span> {s.gstin}</span>}
                      {s.email   && <span><span className="font-semibold text-foreground/60">Email:</span> {s.email}</span>}
                      {s.upiId   && <span><span className="font-semibold text-foreground/60">UPI:</span> {s.upiId}</span>}
                      {s.referredBy && <span><span className="font-semibold text-foreground/60">Referred by:</span> {s.referredBy}</span>}
                      {s.liveAt  && <span><span className="font-semibold text-foreground/60">Live since:</span> {fmtDate(s.liveAt)}</span>}
                      {s.agreedAt && <span><span className="font-semibold text-foreground/60">Agreed:</span> {fmtDate(s.agreedAt)}</span>}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <select value={s.onboardingStage ?? 'new'} onChange={(e) => patchLocal(s.id, { onboardingStage: e.target.value })} className={inp}>
                        <option value="new">New</option>
                        <option value="physically_onboarded">Physically onboarded</option>
                        <option value="digitally_onboarded">Digitally onboarded</option>
                        <option value="live">Live</option>
                        <option value="rejected">Rejected</option>
                      </select>
                      <select value={s.payoutStatus ?? 'pending_setup'} onChange={(e) => patchLocal(s.id, { payoutStatus: e.target.value })} className={inp}>
                        <option value="pending_setup">Payout setup pending</option>
                        <option value="ready">Ready for payout</option>
                        <option value="paid">Paid</option>
                        <option value="on_hold">On hold</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input value={s.payoutNotes ?? ''} onChange={(e) => patchLocal(s.id, { payoutNotes: e.target.value })} placeholder="Notes (rejection reason, payout notes…)" className={`${inp} flex-1`} />
                      <button type="button" disabled={saving === s.id} onClick={() => void saveStore(s)} className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                        {saving === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

// ─── Campaigns Panel ──────────────────────────────────────────────────────────

function CampaignsPanel() {
  const [campaigns,    setCampaigns]    = useState<Campaign[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [deleting,     setDeleting]     = useState<string | null>(null);
  const [offeringTrial, setOfferingTrial] = useState<string | null>(null);

  useEffect(() => {
    const pw = sessionStorage.getItem(SS_PW) ?? '';
    fetch('/api/campaigns/admin', { headers: { 'admin-password': pw } })
      .then((r) => r.json() as Promise<Campaign[]>)
      .then(setCampaigns).catch(() => setCampaigns([]))
      .finally(() => setLoading(false));
  }, []);

  const deleteCampaign = async (id: string, name: string) => {
    if (!confirm(`Delete campaign for "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const pw = sessionStorage.getItem(SS_PW) ?? '';
      const res = await fetch(`/api/admin/campaigns/${id}`, { method: 'DELETE', headers: { 'admin-password': pw } });
      if (!res.ok) { const b = await res.json() as { error?: string }; alert(b.error ?? 'Delete failed'); return; }
      setCampaigns((all) => all.filter((c) => c.id !== id));
    } finally { setDeleting(null); }
  };

  const offerTrial = async (brandId: string, brandName: string) => {
    if (!confirm(`Offer a free 1-month trial to "${brandName}"? They'll be notified via WhatsApp and email.`)) return;
    setOfferingTrial(brandId);
    try {
      const pw  = sessionStorage.getItem(SS_PW) ?? '';
      const res = await fetch(`/api/admin/brands/${brandId}/offer-trial`, { method: 'POST', headers: { 'admin-password': pw } });
      const b   = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { alert(b.error ?? 'Failed to offer trial'); return; }
      setCampaigns((all) => all.map((c) => c.brandId === brandId ? { ...c, trialOfferedAt: new Date().toISOString() } : c));
    } finally { setOfferingTrial(null); }
  };

  const total   = campaigns.reduce((s, c) => s + (c.totalAmount ?? 0), 0);
  const paid    = campaigns.filter((c) => c.paymentId && c.paymentId !== 'pending').length;
  const pending = campaigns.filter((c) => !c.paymentId || c.paymentId === 'pending').length;

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: BarChart3,    label: 'Total bookings',  value: campaigns.length, color: 'text-blue-500'    },
          { icon: IndianRupee,  label: 'Revenue',         value: fmt(total),       color: 'text-green-500'   },
          { icon: CheckCircle2, label: 'Paid',            value: paid,             color: 'text-emerald-500' },
          { icon: Clock,        label: 'Pending payment', value: pending,          color: 'text-yellow-500'  },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <s.icon className={`h-4 w-4 ${s.color} mb-2`} />
            <p className="text-xl font-bold text-foreground">{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
      {!campaigns.length ? (
        <p className="text-sm text-muted-foreground text-center py-10">No campaigns yet.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>{['Brand', 'Contact', 'Screens', 'Amount', 'Status', 'Date', 'Trial', ''].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c) => {
                const isPaid = c.paymentId && c.paymentId !== 'pending';
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">{c.brandName || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground"><p>{c.contactName}</p><p className="text-[10px] text-muted-foreground/60">{c.email}</p></td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.screens} × {c.months}mo</td>
                    <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">{fmt(c.totalAmount ?? 0)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={isPaid ? 'success' : 'warning'} className="text-[10px] py-0.5 px-2 font-bold whitespace-nowrap">
                        {isPaid ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                        {isPaid ? 'Paid' : 'Pay later'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground/60 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.trialOfferedAt ? (
                        <span className="text-[10px] text-muted-foreground/60">Offered {fmtDate(c.trialOfferedAt)}</span>
                      ) : c.brandId ? (
                        <button
                          type="button"
                          onClick={() => void offerTrial(c.brandId!, c.brandName)}
                          disabled={offeringTrial === c.brandId}
                          className="flex items-center gap-1 rounded-lg border border-green-200 px-2 py-1 text-[11px] font-medium text-green-600 hover:bg-green-50 transition-colors disabled:opacity-40"
                        >
                          {offeringTrial === c.brandId ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Offer trial'}
                        </button>
                      ) : <span className="text-[10px] text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void deleteCampaign(c.id, c.brandName || c.contactName || 'this campaign')}
                        disabled={deleting === c.id}
                        className="flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      >
                        {deleting === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
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

// ─── NEW DESIGN COMPONENTS ────────────────────────────────────────────────────

// Stats type for overview panel
type OpsStats = {
  screens:   { online: number; offline: number; pending: number; total: number };
  schedules: { active: number; total: number };
  content:   { count: number; totalMB: number };
  stores:    { total: number; live: number };
  campaigns: { total: number; paid: number };
};

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({ data, color = '#dc2626', w = 80, h = 28 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = `${path} L${w - 1},${h - 1} L1,${h - 1} Z`;
  const last = pts[pts.length - 1];
  const gid = `sg-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="kpi__spark">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.22} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}

// ─── Section Label ────────────────────────────────────────────────────────────

function SectionLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="sect-label">
      <span className="sect-label__n">N°{String(n).padStart(2, '0')}</span>
      <span className="sect-label__rule"></span>
      <span className="sect-label__txt">{label}</span>
    </div>
  );
}

// ─── DateRange ────────────────────────────────────────────────────────────────

function DateRange({ active, onChange }: { active: string; onChange: (v: string) => void }) {
  const segs = ['Today', '7d', '30d', 'Pilot', 'Custom'];
  return (
    <div className="range">
      {segs.map((s) => (
        <button key={s} className={`range__seg${active === s ? ' range__seg--active' : ''}`} onClick={() => onChange(s)}>{s}</button>
      ))}
    </div>
  );
}

// ─── KPI Row ──────────────────────────────────────────────────────────────────

function KpiRow({ stats }: { stats: OpsStats | null }) {
  if (!stats) return (
    <div className="kpi-row">
      {[0,1,2,3].map((i) => (
        <div key={i} className="kpi">
          <div className="kpi__head"><span className="kpi__label" style={{ background: 'var(--neutral-100)', borderRadius: 4, width: 80, height: 12, display: 'inline-block' }}></span></div>
          <div className="kpi__value" style={{ background: 'var(--neutral-100)', borderRadius: 4, width: 60, height: 32, display: 'inline-block' }}></div>
        </div>
      ))}
    </div>
  );

  const cards = [
    {
      label: 'Online screens', icon: <MonitorPlay className="h-4 w-4" />,
      value: stats.screens.online.toLocaleString(),
      sub: `/ ${stats.screens.total}`,
      note: stats.screens.pending > 0 ? `${stats.screens.pending} pending` : `${stats.screens.offline} offline`,
      feature: false,
    },
    {
      label: 'Active schedules', icon: <CalendarClock className="h-4 w-4" />,
      value: stats.schedules.active.toLocaleString(),
      sub: `/ ${stats.schedules.total} total`,
      note: 'running now',
      feature: true,
    },
    {
      label: 'Content files', icon: <ImageIcon className="h-4 w-4" />,
      value: stats.content.count.toLocaleString(),
      sub: stats.content.totalMB > 0 ? `${stats.content.totalMB.toFixed(0)} MB` : undefined,
      note: 'in library',
      feature: false,
    },
    {
      label: 'Store partners', icon: <Store className="h-4 w-4" />,
      value: stats.stores.total.toLocaleString(),
      sub: `${stats.stores.live} live`,
      note: 'registered',
      feature: false,
    },
  ];

  return (
    <div className="kpi-row">
      {cards.map((k, i) => (
        <div key={i} className={`kpi${k.feature ? ' kpi--feature' : ''}`}>
          <div className="kpi__head">
            <span className="kpi__icon">{k.icon}</span>
            <span className="kpi__label">{k.label}</span>
          </div>
          <div>
            <span className="kpi__value">{k.value}</span>
            {k.sub && <span className="kpi__value-sub"> {k.sub}</span>}
          </div>
          <div className="kpi__foot">
            <span className="kpi__period">{k.note}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Device Feed Card ─────────────────────────────────────────────────────────

type DeviceRow2 = { id: string; name?: string; storeName?: string; status: string; lastSeen?: string | null; locality?: string | null };

function DeviceFeedCard({ devices }: { devices: DeviceRow2[] }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? devices : devices.filter((d) => d.status.toUpperCase() === filter.toUpperCase());
  const online  = devices.filter((d) => d.status === 'ONLINE').length;
  const offline = devices.filter((d) => d.status === 'OFFLINE').length;
  const pending = devices.filter((d) => d.status === 'PENDING').length;

  function statusDot(s: string) {
    if (s === 'ONLINE')  return 'feed-item__dot feed-item__dot--live';
    if (s === 'OFFLINE') return 'feed-item__dot feed-item__dot--offline';
    return 'feed-item__dot feed-item__dot--idle';
  }

  function lastSeenLabel(iso: string | null | undefined) {
    if (!iso) return 'never seen';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 2) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  if (!devices.length) return (
    <div className="card">
      <div className="card__head"><h3 className="card__title">Screen network</h3></div>
      <p className="muted" style={{ padding: '24px 0', textAlign: 'center', fontSize: 13 }}>No screens registered yet.</p>
    </div>
  );

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h3 className="card__title">Screen network</h3>
          <p className="card__sub">{devices.length} registered · real-time status</p>
        </div>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={`chip${filter === 'all' ? ' chip--active' : ''}`} onClick={() => setFilter('all')}>All · {devices.length}</button>
        {online  > 0 && <button className={`chip${filter === 'ONLINE'  ? ' chip--active' : ''}`} onClick={() => setFilter('ONLINE')}>Online · {online}</button>}
        {offline > 0 && <button className={`chip${filter === 'OFFLINE' ? ' chip--active' : ''}`} onClick={() => setFilter('OFFLINE')}>Offline · {offline}</button>}
        {pending > 0 && <button className={`chip${filter === 'PENDING' ? ' chip--active' : ''}`} onClick={() => setFilter('PENDING')}>Pending · {pending}</button>}
      </div>
      <div className="feed">
        {filtered.slice(0, 10).map((d) => (
          <div key={d.id} className="feed-item">
            <span className={statusDot(d.status)}></span>
            <div className="feed-item__main">
              <div className="feed-item__name">{d.storeName || d.name || d.id.slice(0, 8)}{d.locality ? <span className="feed-item__area"> · {d.locality}</span> : null}</div>
              <div className="feed-item__sub">Last seen {lastSeenLabel(d.lastSeen)}</div>
            </div>
            <div>
              <div className={`feed-item__val`} style={{ fontSize: 11, fontWeight: 600, color: d.status === 'ONLINE' ? '#16a34a' : d.status === 'OFFLINE' ? '#dc2626' : '#b45309' }}>
                {d.status.toLowerCase()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

function Ticker({ stats }: { stats: OpsStats | null }) {
  if (!stats) return null;
  const items = [
    stats.screens.online > 0 ? `${stats.screens.online} screens online` : null,
    stats.screens.offline > 0 ? `${stats.screens.offline} screens offline` : null,
    stats.schedules.active > 0 ? `${stats.schedules.active} active schedule${stats.schedules.active !== 1 ? 's' : ''}` : null,
    stats.stores.total > 0 ? `${stats.stores.total} store partner${stats.stores.total !== 1 ? 's' : ''} registered` : null,
    stats.campaigns.total > 0 ? `${stats.campaigns.total} campaign${stats.campaigns.total !== 1 ? 's' : ''} · ${stats.campaigns.paid} paid` : null,
    stats.content.count > 0 ? `${stats.content.count} content files in library` : null,
  ].filter(Boolean) as string[];

  if (!items.length) return null;

  return (
    <div className="ticker">
      <div className="ticker__pill">Live wire</div>
      <div className="ticker__track">
        {[...items, ...items].map((text, i) => (
          <span key={i} className="ticker__item">
            <span>{text}</span>
            <span className="ticker__dot">●</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Command Palette ──────────────────────────────────────────────────────────

const PALETTE_GROUPS = [
  {
    label: 'Pages',
    items: [
      { icon: LayoutDashboard, label: 'Go to Overview',        hint: 'G then O' },
      { icon: Megaphone,       label: 'Go to Campaigns',       hint: 'G then C' },
      { icon: Store,           label: 'Go to Kirana partners', hint: 'G then K' },
      { icon: IndianRupee,     label: 'Go to Payouts',         hint: 'G then P' },
    ],
  },
  {
    label: 'Actions',
    items: [
      { icon: Plus,        label: 'New campaign',              hint: '⌘N' },
      { icon: Upload,      label: 'Upload 8-second creative',  hint: '⌘U' },
      { icon: Store,       label: 'Onboard a kirana',          hint: '⌘⇧K' },
      { icon: IndianRupee, label: 'Release May payouts',       hint: undefined },
    ],
  },
];

function CommandPalette({ open, onClose, onNav }: { open: boolean; onClose: () => void; onNav: (t: Tab) => void }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const filter = (txt: string) => txt.toLowerCase().includes(q.toLowerCase());

  const tabMap: Record<string, Tab> = {
    'Go to Overview': 'overview',
    'Go to Campaigns': 'campaigns',
    'Go to Kirana partners': 'stores',
    'Go to Payouts': 'payments',
  };

  return (
    <div className="cmd__overlay" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <div className="cmd__input">
          <Search className="h-4 w-4" style={{ color: 'var(--adm-muted)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anything — campaigns, stores, brands, actions…"
          />
          <span className="tb__kbd">esc</span>
        </div>
        <div className="cmd__body">
          {PALETTE_GROUPS.map((g) => {
            const items = g.items.filter((it) => !q || filter(it.label));
            if (!items.length) return null;
            return (
              <div key={g.label} className="cmd__group">
                <div className="cmd__group-label">{g.label}</div>
                {items.map((it, k) => {
                  const IconComp = it.icon;
                  return (
                    <button key={k} className="cmd__item" onClick={() => {
                      if (tabMap[it.label]) onNav(tabMap[it.label]);
                      onClose();
                    }}>
                      <span className="cmd__item-icon"><IconComp className="h-3.5 w-3.5" /></span>
                      <span className="cmd__item-label">{it.label}</span>
                      {it.hint && <span className="cmd__item-hint">{it.hint}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="cmd__foot">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>Alive Command · v4.12</span>
        </div>
      </div>
    </div>
  );
}

// ─── New Sidebar Nav ──────────────────────────────────────────────────────────

const NAV_DESIGN: { group: string | null; items: { id: Tab; label: string; icon: React.ElementType; count: number | null }[] }[] = [
  {
    group: null,
    items: [
      { id: 'overview' as Tab,   label: 'Overview',         icon: LayoutDashboard, count: null },
      { id: 'campaigns' as Tab,  label: 'Campaigns',        icon: Megaphone,       count: null },
      { id: 'content' as Tab,    label: 'Creatives',        icon: Image,           count: null },
      { id: 'compositions' as Tab, label: 'Compositions',     icon: CalendarClock,   count: null },
    ],
  },
  {
    group: 'Network',
    items: [
      { id: 'stores' as Tab,     label: 'Kirana partners',  icon: Store,           count: null },
      { id: 'screens' as Tab,    label: 'Screens',          icon: Tv2,             count: null },
      { id: 'programming' as Tab, label: 'Programming',       icon: LayoutGrid,      count: null },
      { id: 'monitoring' as Tab, label: 'Monitoring',       icon: Activity,        count: null },
      { id: 'footfall' as Tab,   label: 'Footfall',         icon: Radar,           count: null },
    ],
  },
  {
    group: 'Finance',
    items: [
      { id: 'payments' as Tab,   label: 'Payouts',          icon: IndianRupee,     count: null },
      { id: 'coupons' as Tab,    label: 'Coupons',          icon: Ticket,          count: null },
      { id: 'reports' as Tab,    label: 'Reports',          icon: FileBarChart2,   count: null },
    ],
  },
  {
    group: 'Admin',
    items: [
      { id: 'flyers' as Tab,     label: 'Flyers',           icon: FileImage,       count: null },
      { id: 'layouts' as Tab,    label: 'Layouts',          icon: Layers,          count: null },
      { id: 'media' as Tab,      label: 'Media',            icon: Images,          count: null },
      { id: 'products' as Tab,   label: 'Products',         icon: Package,         count: null },
      { id: 'alerts' as Tab,     label: 'Alerts',           icon: Bell,            count: null },
      { id: 'roadmap' as Tab,    label: 'Platform',         icon: Map,             count: null },
    ],
  },
];

function SidebarNav({ tab, onTab, onSignOut, liveCount }: {
  tab: Tab; onTab: (t: Tab) => void; onSignOut: () => void; liveCount: number;
}) {
  return (
    <aside className="sb">
      <div className="sb__logo">
        <span>alive</span>
        <span className="sb__logo-dot"></span>
      </div>

      {NAV_DESIGN.map((section, si) => (
        <React.Fragment key={si}>
          {section.group && <div className="sb__group">{section.group}</div>}
          {section.items.map((item) => {
            const IconComp = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                className={`sb__item${active ? ' sb__item--active' : ''}`}
                onClick={() => onTab(item.id)}
              >
                <IconComp className="h-4 w-4" />
                <span>{item.label}</span>
                {item.count != null && <span className="sb__count">{item.count.toLocaleString()}</span>}
              </button>
            );
          })}
        </React.Fragment>
      ))}

      <div className="sb__bottom">
        <button className="sb__user" onClick={onSignOut} title="Sign out">
          <div className="sb__avatar">A</div>
          <div className="sb__user-meta">
            <div className="sb__user-name">ALIVE Admin</div>
            <div className="sb__user-role">Network Admin</div>
          </div>
          <LogOut className="h-3.5 w-3.5" style={{ color: 'var(--neutral-400)', marginLeft: 'auto' }} />
        </button>
      </div>
    </aside>
  );
}

// ─── New Topbar ───────────────────────────────────────────────────────────────

function Topbar({ section, liveCount, onOpenCmd, onOpenNotif, theme, setTheme, unread }: {
  section: string; liveCount: number; onOpenCmd: () => void; onOpenNotif: () => void;
  theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void; unread: number;
}) {
  const isDark = theme === 'dark';
  return (
    <header className="tb">
      <div className="tb__crumbs">
        <span>Network 027</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <strong>{section}</strong>
      </div>
      <button className="tb__search" onClick={onOpenCmd}>
        <Search className="h-3.5 w-3.5" />
        <span style={{ flex: 1, color: 'var(--neutral-400)', font: '400 13px var(--font-body)', textAlign: 'left' }}>
          Search stores, brands, campaigns, screens…
        </span>
        <span className="tb__kbd">⌘K</span>
      </button>
      <div className="tb__spacer"></div>
      <span className="live-pill">Live · {liveCount} screens</span>
      <div className="tb__divider"></div>
      <button className="tb__icon-btn" title="Network status"><Activity className="h-4 w-4" /></button>
      <button
        className={`tb__icon-btn${unread > 0 ? ' tb__icon-btn--dot' : ''}`}
        title="Notifications"
        onClick={onOpenNotif}
      >
        <Bell className="h-4 w-4" />
      </button>
      <button
        className="tb__icon-btn"
        title={isDark ? 'Light mode' : 'Dark mode'}
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <button className="tb__icon-btn" title="Help"><LifeBuoy className="h-4 w-4" /></button>
      <div className="tb__divider"></div>
      <button className="btn btn--outline btn--sm"><Download className="h-3 w-3" /> Export</button>
      <button className="btn btn--primary btn--sm"><Plus className="h-3 w-3" /> New Campaign</button>
    </header>
  );
}

// ─── Overview Panel ───────────────────────────────────────────────────────────

function OverviewPanel({ onNav }: { onNav: (t: Tab) => void }) {
  const [stats,   setStats]   = useState<OpsStats | null>(null);
  const [devices, setDevices] = useState<DeviceRow2[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const pw = sessionStorage.getItem(SS_PW) ?? '';
    const h  = { 'admin-password': pw };
    const now = new Date().toISOString();
    Promise.all([
      fetch('/api/devices',        { headers: h }).then((r) => r.ok ? r.json() : { devices: [] }),
      fetch('/api/schedules',      { headers: h }).then((r) => r.ok ? r.json() : { schedules: [] }),
      fetch('/api/content',        { headers: h }).then((r) => r.ok ? r.json() : { content: [], totalBytes: 0 }),
      fetch('/api/stores/save',    { headers: h }).then((r) => r.ok ? r.json() : []),
      fetch('/api/campaigns/admin',{ headers: h }).then((r) => r.ok ? r.json() : []),
    ]).then(([devR, schR, ctR, stR, cmR]) => {
      const devs = (devR.devices ?? []) as DeviceRow2[];
      const schs = (schR.schedules ?? []) as { startAt: string; endAt: string }[];
      const cts  = (ctR.content ?? []) as unknown[];
      const sts  = Array.isArray(stR) ? stR : (stR?.data ?? []) as { onboardingStage?: string }[];
      const cms  = Array.isArray(cmR) ? cmR : [] as { paymentId?: string }[];
      setDevices(devs);
      setStats({
        screens:   {
          online:  devs.filter((d) => d.status === 'ONLINE').length,
          offline: devs.filter((d) => d.status === 'OFFLINE').length,
          pending: devs.filter((d) => d.status === 'PENDING').length,
          total:   devs.length,
        },
        schedules: {
          active: schs.filter((s) => s.startAt <= now && s.endAt >= now).length,
          total:  schs.length,
        },
        content:   { count: cts.length, totalMB: ctR.totalBytes ? ctR.totalBytes / (1024 * 1024) : 0 },
        stores:    { total: sts.length, live: sts.filter((s: { onboardingStage?: string }) => s.onboardingStage === 'live').length },
        campaigns: { total: cms.length, paid: cms.filter((c: { paymentId?: string }) => c.paymentId && c.paymentId !== 'pending').length },
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page__head">
        <div>
          <h1 className="page__title">
            <span className="red">Dashboard</span>
          </h1>
          <p className="page__sub">
            {loading ? 'Loading network status…' : stats
              ? `${stats.screens.online} of ${stats.screens.total} screens online · ${stats.schedules.active} active schedule${stats.schedules.active !== 1 ? 's' : ''} · ${stats.stores.total} store partner${stats.stores.total !== 1 ? 's' : ''}`
              : 'ALIVE network · Mangaluru'}
          </p>
        </div>
      </div>

      <SectionLabel n={1} label="Performance" />
      <KpiRow stats={stats} />

      <SectionLabel n={2} label="Network" />
      <DeviceFeedCard devices={devices} />

      <SectionLabel n={3} label="Store app" />
      <AppPreviewCard />
    </>
  );
}

// ─── Password gate ────────────────────────────────────────────────────────────

function PasswordGate({ onAuth }: { onAuth: () => void }) {
  const [pw,   setPw]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res  = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      const body = await res.json() as { ok: boolean };
      if (body.ok) { sessionStorage.setItem('alive_admin', '1'); sessionStorage.setItem(SS_PW, pw); onAuth(); }
      else setErr('Incorrect password.');
    } catch { setErr('Failed to verify.'); }
    finally   { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <a href="/" className="opacity-70 hover:opacity-100 transition-opacity inline-block mb-8"><Logo /></a>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1">Admin</p>
          <h1 className="text-3xl font-bold text-foreground">Enter password</h1>
          <p className="text-sm text-muted-foreground mt-1">Restricted to Alive staff.</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input type="password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder="Admin password"
            className="w-full h-12 rounded-xl border border-border bg-card px-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          {err && <p className="text-xs text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">{err}</p>}
          <button type="submit" disabled={busy || !pw}
            className="w-full h-11 rounded-xl bg-primary text-sm font-bold text-white transition-all hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enter dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

function Dashboard() {
  const [tab,         setTab]         = useState<Tab>('overview');
  const [refreshKey,  setRefreshKey]  = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cmdOpen,     setCmdOpen]     = useState(false);
  const [theme,       setTheme]       = useState<'light' | 'dark'>('light');
  const [adminPw,     setAdminPw]     = useState('');
  const [liveCount,   setLiveCount]   = useState(0);
  const [alertCount,  setAlertCount]  = useState(0);
  const [tickerStats, setTickerStats] = useState<OpsStats | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load theme from localStorage + prefetch alert count + live network stats for the ticker
  useEffect(() => {
    try {
      const saved = localStorage.getItem('alive-theme') as 'light' | 'dark' | null;
      if (saved) setTheme(saved);
    } catch {}
    const pw = sessionStorage.getItem(SS_PW) ?? '';
    setAdminPw(pw);
    // Quick count of unread alerts (offline devices + pending campaigns/stores)
    const h = { 'admin-password': pw };
    const dismissed: string[] = (() => {
      try { return JSON.parse(localStorage.getItem('alive_admin_dismissed_alerts') ?? '[]') as string[]; }
      catch { return []; }
    })();
    const now = new Date().toISOString();
    Promise.all([
      fetch('/api/devices',         { headers: h }).then((r) => r.ok ? r.json() : { devices: [] }),
      fetch('/api/schedules',       { headers: h }).then((r) => r.ok ? r.json() : { schedules: [] }),
      fetch('/api/content',         { headers: h }).then((r) => r.ok ? r.json() : { content: [], totalBytes: 0 }),
      fetch('/api/stores/save',     { headers: h }).then((r) => r.ok ? r.json() : []),
      fetch('/api/campaigns/admin', { headers: h }).then((r) => r.ok ? r.json() : []),
    ]).then(([devR, schR, ctR, stR, cmR]) => {
      const devs = (devR.devices ?? []) as { id: string; status: string }[];
      const schs = (schR.schedules ?? []) as { startAt: string; endAt: string }[];
      const cts  = (ctR.content ?? []) as unknown[];
      const cms  = Array.isArray(cmR) ? cmR : [] as { paymentId?: string; status?: string }[];
      const sts  = Array.isArray(stR) ? stR : (stR?.data ?? []) as { id: string; createdAt: string; onboardingStage?: string }[];
      let count = 0;
      devs.forEach((d) => { if (d.status === 'OFFLINE' && !dismissed.includes(`device-offline-${d.id}`)) count++; });
      const pendingDevs = devs.filter((d) => d.status === 'PENDING');
      if (pendingDevs.length > 0 && !dismissed.includes('devices-pending')) count++;
      const pendingCms = cms.filter((c) => (c as { paymentId?: string }).paymentId === 'pending' || (c as { status?: string }).status === 'upcoming');
      if (pendingCms.length > 0 && !dismissed.includes('campaigns-pending-payment')) count++;
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const newSts = sts.filter((s) => s.createdAt > cutoff && (!s.onboardingStage || s.onboardingStage === 'new'));
      if (newSts.length > 0) {
        const id = `stores-new-${newSts.map((s: { id: string }) => s.id).join('-')}`;
        if (!dismissed.includes(id)) count++;
      }
      setAlertCount(count);
      setLiveCount(devs.filter((d) => d.status === 'ONLINE').length);
      setTickerStats({
        screens:   {
          online:  devs.filter((d) => d.status === 'ONLINE').length,
          offline: devs.filter((d) => d.status === 'OFFLINE').length,
          pending: pendingDevs.length,
          total:   devs.length,
        },
        schedules: {
          active: schs.filter((s) => s.startAt <= now && s.endAt >= now).length,
          total:  schs.length,
        },
        content:   { count: cts.length, totalMB: ctR.totalBytes ? ctR.totalBytes / (1024 * 1024) : 0 },
        stores:    { total: sts.length, live: sts.filter((s: { onboardingStage?: string }) => s.onboardingStage === 'live').length },
        campaigns: { total: cms.length, paid: cms.filter((c: { paymentId?: string }) => c.paymentId && c.paymentId !== 'pending').length },
      });
    }).catch(() => {});
  }, []);

  // Apply theme to container
  useEffect(() => {
    try { localStorage.setItem('alive-theme', theme); } catch {}
  }, [theme]);

  // ⌘K keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleNav = (t: Tab) => { setTab(t); setSidebarOpen(false); };
  const signOut = () => {
    sessionStorage.removeItem('alive_admin');
    sessionStorage.removeItem(SS_PW);
    window.location.reload();
  };

  const sectionName: Record<Tab, string> = {
    overview:   'Overview',
    campaigns:  'Campaigns',
    content:    'Creatives',
    compositions: 'Compositions',
    stores:       'Kirana Partners',
    screens:      'Screens',
    programming:  'Programming',
    monitoring: 'Monitoring',
    footfall:   'Footfall',
    payments:   'Payouts',
    coupons:    'Coupons',
    reports:    'Reports',
    flyers:     'Flyers',
    layouts:    'Layouts',
    media:      'Media',
    products:   'Products',
    alerts:     'Alerts',
    roadmap:    'Platform',
  };

  return (
    <div className="adm app" ref={containerRef} data-theme={theme}>
      <SidebarNav tab={tab} onTab={handleNav} onSignOut={signOut} liveCount={liveCount} />

      <main className="main">
        <Topbar
          section={sectionName[tab] ?? tab}
          liveCount={liveCount}
          onOpenCmd={() => setCmdOpen(true)}
          onOpenNotif={() => handleNav('alerts')}
          theme={theme}
          setTheme={setTheme}
          unread={alertCount}
        />
        <Ticker stats={tickerStats} />

        <div className="page">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {tab === 'overview'   && <OverviewPanel onNav={handleNav} />}
              {tab === 'flyers'     && (
                <div className="grid-2">
                  <div className="space-y-4">
                    <AutoFlyerPanel adminPassword={adminPw} onSaved={() => setRefreshKey((k) => k + 1)} />
                    <UploadPanel onSaved={() => setRefreshKey((k) => k + 1)} />
                  </div>
                  <FlyersList refresh={refreshKey} />
                </div>
              )}
              {tab === 'stores'     && <StoresPanel />}
              {tab === 'campaigns'  && <CampaignsPanel />}
              {tab === 'payments'   && <StorePaymentsTab adminPassword={adminPw} />}
              {tab === 'coupons'    && <CouponsTab />}
              {tab === 'screens'    && <ScreensTab />}
              {tab === 'content'    && <ContentTab />}
              {tab === 'programming'   && <ProgrammingTab />}
              {tab === 'compositions' && <CompositionsTab />}
              {tab === 'layouts'    && <LayoutsTab />}
              {tab === 'reports'    && <ReportsTab />}
              {tab === 'monitoring' && <MonitoringTab />}
              {tab === 'footfall'   && <FootfallTab />}
              {tab === 'alerts'    && <AlertsTab onNav={(t) => handleNav(t as Tab)} />}
              {tab === 'media'      && <SiteMediaTab adminPassword={adminPw} />}
              {tab === 'products'   && <ProductsTab adminPw={adminPw} />}
              {tab === 'roadmap'    && <RoadmapTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNav={handleNav} />
    </div>
  );
}

// ─── Root export ─────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const ok = sessionStorage.getItem('alive_admin') === '1';
    setAuthed(ok);
    setChecked(true);
  }, []);

  if (!checked) return null;
  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />;
  return <Dashboard />;
}
