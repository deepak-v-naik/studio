'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  IndianRupee, CheckCircle2, Clock, BarChart3, Phone,
  MapPin, MessageCircle, ChevronRight,
  TrendingUp, Calendar, Shield, Loader2, ArrowRight,
  Mail, AlertCircle, X, FileImage, Download, Gift, Copy, Check, ShoppingCart, Tag, ImageIcon,
  KeyRound, Eye, EyeOff, ArrowLeft, ShieldCheck, Camera,
} from 'lucide-react';
import { Logo } from '@/components/icons/logo';
import { extractGpsFromFile } from '@/lib/exif-gps';
import { storeFetch } from '@/lib/store-fetch';
import VoiceBillTab from '@/components/store/voice-bill-tab';
import OffersTab from '@/components/store/offers-tab';
import FlyerTab from '@/components/store/flyer-tab';
import KycTab from '@/components/store/kyc-tab';
import ScreenAlertBanner from '@/components/store/screen-alert-banner';
import { PwaInstallBanner } from '@/components/pwa-register';

// ─── Animations ─────────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

// ─── Types ──────────────────────────────────────────────────────────────────

type StoreInfo = {
  id?:           string;
  token?:        string; // signed store API token — sent as x-store-token on explicit-storeId calls
  storeName:     string;
  ownerName:     string;
  whatsapp:      string;
  phone?:        string;
  password?:     string;
  locality?:     string;
  city?:         string;
  pincode?:      string;
  address?:      string;
  gstin?:        string;
  email?:        string;
  referralCode?:     string;
  referredBy?:       string;
  agreedAt?:         string;
  liveAt?:           string;
  onboardingStage?:  string;
  deviceCount?:      number;
  tier?:                     string;
  monthlyCompensationPaise?: number;
  payoutMethod?: string; upiId?: string; bankAccountName?: string; bankAccountNo?: string; bankIfsc?: string; bankName?: string;
  // GPS-verified onboarding photos (see GpsPhotoUpload)
  shopPhotoUrl?:    string | null; shopPhotoLat?:    number | null; shopPhotoLng?:    number | null; shopPhotoAt?:    string | null;
  installPhotoUrl?: string | null; installPhotoLat?: number | null; installPhotoLng?: number | null; installPhotoAt?: string | null;
  tvTag?: string | null; // TV number / ID pin, recorded with the installed-TV photo
};

type Flyer = {
  id:          string;
  storeName:   string;
  title:       string;
  description: string;
  validUntil:  string;
  imageBase64: string;
  createdAt:   string;
};

function fmt(n: number) { return `₹${n.toLocaleString('en-IN')}`; }
function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
function resolveImage(raw: string) {
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

// ─── Phone + password login ───────────────────────────────────────────────────

type LoginView = 'login' | 'forgot_phone' | 'forgot_otp' | 'forgot_done';

function PhoneLogin() {
  const [view,        setView]        = useState<LoginView>('login');
  const [phone,       setPhone]       = useState('');
  const [password,    setPassword]    = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // reset flow state
  const [resetPhone,  setResetPhone]  = useState('');
  const [otp,         setOtp]         = useState('');
  const [newPw,       setNewPw]       = useState('');
  const [showNewPw,   setShowNewPw]   = useState(false);

  const inputCls = 'w-full rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';

  // ── Sign in ────────────────────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length !== 10) { setError('Enter a valid 10-digit WhatsApp number.'); return; }
    if (!password)            { setError('Enter your password.'); return; }
    setBusy(true); setError(null);
    try {
      const result = await signIn('phone-password', { phone: `+91${phone}`, password, redirect: false });
      if (result?.error) { setError('Incorrect number or password. Please try again.'); return; }
      // Fetch and cache store data after successful login
      try {
        const res = await fetch('/api/stores/me');
        if (res.ok) {
          const data = await res.json() as StoreInfo;
          localStorage.setItem(LS_SESSION_KEY, JSON.stringify(data));
        }
      } catch { /* non-fatal — session will load on next render */ }
    } catch {
      setError('Could not connect. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── Request OTP ───────────────────────────────────────────────────────────
  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPhone.length !== 10) { setError('Enter a valid 10-digit WhatsApp number.'); return; }
    setBusy(true); setError(null);
    try {
      await fetch('/api/stores/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', phone: resetPhone }),
      });
      // Always advance — don't reveal if number is registered
      setView('forgot_otp');
    } catch {
      setError('Could not send code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── Verify OTP + set new password ─────────────────────────────────────────
  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6)   { setError('Enter the 6-digit code from WhatsApp.'); return; }
    if (newPw.length < 6)   { setError('New password must be at least 6 characters.'); return; }
    setBusy(true); setError(null);
    try {
      const res  = await fetch('/api/stores/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', phone: resetPhone, otp, newPassword: newPw }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setError(data.error ?? 'Reset failed. Try again.'); return; }
      setView('forgot_done');
    } catch {
      setError('Could not verify. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    setView('login'); setError(null);
    setResetPhone(''); setOtp(''); setNewPw('');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/30 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4 sm:px-6">
          <a href="/" className="opacity-70 hover:opacity-100 transition-opacity"><Logo /></a>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <AnimatePresence mode="wait">

            {/* ── Sign in ── */}
            {view === 'login' && (
              <motion.div key="login" variants={stagger} initial="hidden" animate="show" exit={{ opacity: 0 }} className="space-y-6">
                <motion.div variants={fadeUp} className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Store Partner Portal</p>
                  <h1 className="text-3xl font-bold tracking-tight text-foreground">Sign in</h1>
                  <p className="text-sm text-muted-foreground">Use your registered WhatsApp number and password.</p>
                </motion.div>

                <motion.form variants={fadeUp} onSubmit={submit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">WhatsApp number (username)</label>
                    <div className="flex items-stretch rounded-xl border border-border overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all bg-card">
                      <span className="flex items-center px-4 text-sm font-semibold text-muted-foreground border-r border-border bg-muted shrink-0">+91</span>
                      <input
                        type="tel" inputMode="numeric" maxLength={10} required autoFocus
                        value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="98765 43210"
                        className="flex-1 bg-transparent px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-muted-foreground">Password</label>
                      <button type="button" onClick={() => { setResetPhone(phone); setView('forgot_phone'); setError(null); }}
                        className="text-xs text-primary hover:underline font-medium">
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'} required
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        placeholder="Your login password"
                        className={`${inputCls} pr-11`}
                      />
                      <button type="button" tabIndex={-1} onClick={() => setShowPw((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                      <p className="text-xs text-destructive leading-relaxed">{error}</p>
                    </div>
                  )}

                  <button type="submit" disabled={busy || phone.length !== 10 || !password}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-red-500 to-red-700 px-6 py-3.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(220,38,38,0.4)] transition-all hover:from-red-600 hover:to-red-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ArrowRight className="h-4 w-4" /> Sign in</>}
                  </button>
                </motion.form>

                <motion.div variants={fadeUp} className="text-center">
                  <p className="text-xs text-muted-foreground">
                    New to Alive?{' '}
                    <a href="/store" className="text-primary font-semibold hover:underline">Register your store — it&apos;s free →</a>
                  </p>
                </motion.div>
              </motion.div>
            )}

            {/* ── Forgot: enter phone ── */}
            {view === 'forgot_phone' && (
              <motion.div key="forgot_phone" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="space-y-1.5">
                  <button onClick={backToLogin} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <KeyRound className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold tracking-tight text-foreground">Reset password</h1>
                      <p className="text-xs text-muted-foreground">We&apos;ll send a code to your WhatsApp.</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={requestOtp} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Registered WhatsApp number</label>
                    <div className="flex items-stretch rounded-xl border border-border overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all bg-card">
                      <span className="flex items-center px-4 text-sm font-semibold text-muted-foreground border-r border-border bg-muted shrink-0">+91</span>
                      <input
                        type="tel" inputMode="numeric" maxLength={10} required autoFocus
                        value={resetPhone} onChange={(e) => setResetPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="98765 43210"
                        className="flex-1 bg-transparent px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                      <p className="text-xs text-destructive leading-relaxed">{error}</p>
                    </div>
                  )}

                  <button type="submit" disabled={busy || resetPhone.length !== 10}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ArrowRight className="h-4 w-4" /> Send code via WhatsApp</>}
                  </button>
                </form>
              </motion.div>
            )}

            {/* ── Forgot: enter OTP + new password ── */}
            {view === 'forgot_otp' && (
              <motion.div key="forgot_otp" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="space-y-1.5">
                  <button onClick={() => { setView('forgot_phone'); setError(null); }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <KeyRound className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold tracking-tight text-foreground">Enter code</h1>
                      <p className="text-xs text-muted-foreground">Sent to +91 {resetPhone} via WhatsApp.</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={verifyOtp} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">6-digit code</label>
                    <input
                      type="text" inputMode="numeric" maxLength={6} required autoFocus
                      value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className={`${inputCls} text-center text-xl font-bold tracking-[0.3em]`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">New password</label>
                    <div className="relative">
                      <input
                        type={showNewPw ? 'text' : 'password'} required minLength={6}
                        value={newPw} onChange={(e) => setNewPw(e.target.value)}
                        placeholder="At least 6 characters"
                        className={`${inputCls} pr-11`}
                      />
                      <button type="button" tabIndex={-1} onClick={() => setShowNewPw((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                        {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                      <p className="text-xs text-destructive leading-relaxed">{error}</p>
                    </div>
                  )}

                  <button type="submit" disabled={busy || otp.length !== 6 || newPw.length < 6}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><KeyRound className="h-4 w-4" /> Set new password</>}
                  </button>

                  <p className="text-center text-xs text-muted-foreground">
                    Didn&apos;t receive it?{' '}
                    <button type="button" onClick={() => { setView('forgot_phone'); setError(null); }}
                      className="text-primary hover:underline font-medium">Resend code</button>
                  </p>
                </form>
              </motion.div>
            )}

            {/* ── Success ── */}
            {view === 'forgot_done' && (
              <motion.div key="forgot_done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                    <Check className="h-7 w-7 text-green-600" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">Password updated</h1>
                    <p className="text-sm text-muted-foreground mt-1">Sign in with your new password.</p>
                  </div>
                </div>
                <button onClick={backToLogin}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90">
                  <ArrowRight className="h-4 w-4" /> Go to sign in
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ─── Add email banner ────────────────────────────────────────────────────────

// ─── GPS-verified onboarding photo upload ────────────────────────────────────
// The onboarding pipeline needs field evidence with coordinates: a shop-front
// photo before Team verification passes, and an installed-TV photo before Site
// visit & install (the admin API refuses to advance the stage without them).
// Coordinates come from the photo's EXIF GPS (GPS-camera apps embed them); if
// the file has none, we fall back to the device's location at upload time.

const PHOTO_COPY = {
  shop: {
    title: 'Upload a GPS photo of your shop front',
    hint:  'Take it with a GPS map camera app, standing in front of the store. Our team verifies the location before your verification call.',
  },
  install: {
    title: 'Upload a GPS photo of the installed TV',
    hint:  'After the screen is installed, take a GPS-tagged photo showing the TV running in your store.',
  },
} as const;

function GpsPhotoUpload({ kind, store, onUploaded }: {
  kind: 'shop' | 'install';
  store: StoreInfo;
  onUploaded: (patch: Partial<StoreInfo>) => void;
}) {
  const [busy,  setBusy]  = useState<null | 'reading' | 'locating' | 'uploading'>(null);
  const [error, setError] = useState<string | null>(null);
  // Install photo only: the number/ID pin marked on the TV, recorded at the
  // moment the installed screen is photographed.
  const [tvTag, setTvTag] = useState('');

  const handleFile = async (file: File) => {
    setError(null);

    setBusy('reading');
    let coords = await extractGpsFromFile(file);
    let source: 'exif' | 'device' = 'exif';

    if (!coords) {
      // No EXIF GPS (location off, or a format like HEIC) — use the phone's
      // current position instead; the partner is standing at the shop anyway.
      setBusy('locating');
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }));
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        source = 'device';
      } catch {
        setBusy(null);
        setError('Could not read the photo location. Use a GPS map camera app, or allow location access and retry.');
        return;
      }
    }

    setBusy('uploading');

    // Re-encode when the file is too big for the 4 MB body cap OR in a format
    // the server doesn't take (HEIC etc.) — coordinates were already read from
    // the original bytes above, so losing EXIF here is fine.
    const SERVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    let blob: Blob = file;
    if (file.size > 3.5 * 1024 * 1024 || !SERVER_TYPES.includes(file.type)) {
      try {
        blob = await downscaleImage(file);
      } catch {
        setBusy(null);
        setError('Could not read this photo format. Please use a JPEG photo (GPS camera apps save JPEG).');
        return;
      }
    }

    try {
      const fd = new FormData();
      fd.append('file', blob, 'photo.jpg');
      fd.append('kind', kind);
      fd.append('lat', String(coords.lat));
      fd.append('lng', String(coords.lng));
      fd.append('source', source);
      fd.append('storeId', store.id ?? '');
      if (kind === 'install' && tvTag.trim()) fd.append('tvTag', tvTag.trim());
      const res  = await fetch('/api/stores/verification-photo', {
        method: 'POST', body: fd,
        headers: store.token ? { 'x-store-token': store.token } : undefined,
      });
      const body = await res.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) { setError(body?.error ?? 'Upload failed. Please try again.'); return; }
      onUploaded(kind === 'shop'
        ? { shopPhotoUrl: body.url, shopPhotoLat: coords.lat, shopPhotoLng: coords.lng, shopPhotoAt: new Date().toISOString() }
        : { installPhotoUrl: body.url, installPhotoLat: coords.lat, installPhotoLng: coords.lng, installPhotoAt: new Date().toISOString(), tvTag: tvTag.trim() || undefined });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const copy = PHOTO_COPY[kind];
  return (
    <div className="mt-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
        <Camera className="h-3.5 w-3.5 text-primary shrink-0" /> {copy.title}
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{copy.hint}</p>
      {kind === 'install' && !busy && (
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            TV number / ID pin <span className="font-normal normal-case tracking-normal">(optional)</span>
          </span>
          <input
            value={tvTag}
            onChange={(e) => setTvTag(e.target.value)}
            placeholder="Number marked on the TV, e.g. 27"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </label>
      )}
      {busy ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          {busy === 'reading' ? 'Reading photo location…' : busy === 'locating' ? 'Getting your location…' : 'Uploading…'}
        </div>
      ) : (
        <label className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors">
          <Camera className="h-3.5 w-3.5" /> Take / choose photo
          {/* No `capture` attribute: it would force the system camera and block
              picking the GPS-map-camera photo from the gallery — the primary flow. */}
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleFile(f); }} />
        </label>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// Downscale to ≤1920px JPEG so any phone photo fits the 4 MB upload cap. EXIF
// (incl. GPS) is stripped by re-encoding — coordinates are extracted from the
// original bytes before this runs.
async function downscaleImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el); el.onerror = () => reject(new Error('bad image'));
      el.src = url;
    });
    const scale  = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function GpsPhotoChip({ url, lat, lng, at }: { url: string; lat?: number | null; lng?: number | null; at?: string | null }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5">
      <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Verification photo" className="h-9 w-9 rounded object-cover" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-green-700 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 shrink-0" /> GPS photo uploaded{at ? ` · ${fmtDate(at)}` : ''}
        </p>
        {typeof lat === 'number' && typeof lng === 'number' && (
          <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 flex items-center gap-1">
            <MapPin className="h-2.5 w-2.5 shrink-0" /> {lat.toFixed(6)}, {lng.toFixed(6)}
          </a>
        )}
      </div>
    </div>
  );
}

function EmailBanner({ store, onSave }: { store: StoreInfo; onSave: (email: string) => void }) {
  const [open,  setOpen]  = useState(!store.email);
  const [email, setEmail] = useState(store.email ?? '');
  const [busy,  setBusy]  = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  if (!open) return null;

  const save = async () => {
    if (!email.includes('@')) return;
    setBusy(true);
    setError(false);
    try {
      // storeId + signed token keep this working when no next-auth cookie
      // exists yet (right after registration, or an admin impersonation session).
      const res = await fetch(`/api/stores/me?storeId=${encodeURIComponent(store.id ?? '')}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...(store.token ? { 'x-store-token': store.token } : {}) },
        body:    JSON.stringify({ email }),
      });
      if (!res.ok) { setError(true); return; }
      onSave(email);
      setSaved(true);
      setTimeout(() => setOpen(false), 1500);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
      <Mail className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
      <div className="flex-1 min-w-0">
        {saved ? (
          <p className="text-sm font-semibold text-green-600">Email saved ✓</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">Add your email</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">Get invoices, updates and payout notifications by email.</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
              <button
                onClick={save}
                disabled={busy || !email.includes('@')}
                className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-40 flex items-center gap-1"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </button>
            </div>
            {error && <p className="text-xs text-destructive mt-2">Could not save — please try again.</p>}
          </>
        )}
      </div>
      {!saved && (
        <button onClick={() => setOpen(false)} className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Flyer image modal ────────────────────────────────────────────────────────

function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Flyer" className="max-h-[90vh] max-w-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="h-5 w-5" /></button>
    </div>
  );
}

// ─── Deals carousel (store-specific flyers) ──────────────────────────────────

function StoreFlyers({ storeId, storeName, token }: { storeId?: string; storeName: string; token?: string }) {
  const [flyers,  setFlyers]  = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState<string | null>(null);

  useEffect(() => {
    // Match flyers by storeId server-side (?storeId= + token/session, see
    // resolveStoreId) — storeName drifts on admin renames/whitespace. Public
    // list + normalized-name compare is the fallback when we can't prove
    // ownership (stale cached session without id/token).
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    const byName = () =>
      fetch('/api/flyers/save')
        .then((r) => r.json() as Promise<Flyer[]>)
        .then((all) => all.filter((f) => norm(f.storeName) === norm(storeName)));
    const load = storeId
      ? fetch(`/api/flyers/save?storeId=${encodeURIComponent(storeId)}`, {
          headers: token ? { 'x-store-token': token } : undefined,
        }).then((r) => (r.ok ? (r.json() as Promise<Flyer[]>) : byName()))
      : byName();
    load
      .then(setFlyers)
      .catch(() => setFlyers([]))
      .finally(() => setLoading(false));
  }, [storeId, storeName, token]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      {modal && <ImageModal src={modal} onClose={() => setModal(null)} />}
      {flyers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <FileImage className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No active flyers for your store yet.
          <p className="text-xs mt-1 text-muted-foreground/50">Contact your Alive manager to publish offers.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {flyers.map((f) => {
            const img = resolveImage(f.imageBase64);
            return (
              <div key={f.id} className="rounded-xl border border-border bg-card overflow-hidden cursor-pointer group" onClick={() => img && setModal(img)}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={f.title} className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full aspect-video bg-muted flex items-center justify-center"><FileImage className="h-6 w-6 text-muted-foreground/30" /></div>
                )}
                <div className="p-2.5">
                  <p className="text-xs font-semibold text-foreground line-clamp-1">{f.title}</p>
                  <p className="text-[10px] text-muted-foreground/60">Until {fmtDate(f.validUntil)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── 12-month payment timeline ───────────────────────────────────────────────

type PaymentRecord = {
  month: string; status: string; amountPaise: number; paidAt: string | null; payRef: string | null;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Pro-rate the monthly remuneration for the first partial month based on
// onboarding date. Returns amount in paise for consistency with PaymentRecord.
function proRateFirstMonth(onboardedAt: Date, monthStart: Date, monthlyPaise: number): number {
  const monthEnd   = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const totalDays  = (monthEnd.getTime() - monthStart.getTime()) / 86400000;
  // Days from onboarding date to end of month (inclusive of onboarding day)
  const daysActive = (monthEnd.getTime() - onboardedAt.getTime()) / 86400000;
  const fraction   = Math.min(1, Math.max(0, daysActive / totalDays));
  return Math.round(monthlyPaise * fraction); // in paise
}

function PaymentTimeline({ store, onClaim }: { store: StoreInfo; onClaim: (monthKey: string, amountPaise: number) => void }) {
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const monthlyPaise = store.monthlyCompensationPaise ?? 50000;
  const monthlyRupees = Math.round(monthlyPaise / 100);

  useEffect(() => {
    storeFetch('/api/stores/payments')
      .then(r => r.ok ? r.json() as Promise<PaymentRecord[]> : Promise.resolve([]))
      .then((rows) => setPaymentRecords(Array.isArray(rows) ? rows : []))
      .catch(() => setPaymentRecords([]));
  }, []);

  const now = new Date();
  // A month is claimable only after it has fully ended (i.e., today >= 1st of next month)
  const claimableBeforeMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // Determine start month: liveAt → agreedAt → fallback to 4 months ago
  const onboardDate = store.liveAt ?? store.agreedAt;
  const onboardedAt = onboardDate ? new Date(onboardDate) : null;
  const startMonth  = onboardedAt
    ? new Date(onboardedAt.getFullYear(), onboardedAt.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() - 4, 1);

  // Build months from startMonth to current month
  const months: { label: string; range: string; isPast: boolean; isCur: boolean; isFuture: boolean; amountPaise: number; monthKey: string; isFirstMonth: boolean }[] = [];
  const cur = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  const endCal = new Date(now.getFullYear(), now.getMonth(), 1);

  let firstMonthProcessed = false;
  while (cur <= endCal) {
    const start    = new Date(cur);
    const end      = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const isPast   = start.getTime() < claimableBeforeMs;
    const isCur    = start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
    const mo       = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const isFirst  = !firstMonthProcessed;
    // Pro-rate first month; full monthly remuneration for subsequent months
    const amountPaise = (isFirst && onboardedAt)
      ? proRateFirstMonth(onboardedAt, start, monthlyPaise)
      : monthlyPaise;
    if (isFirst) firstMonthProcessed = true;
    months.push({
      label: start.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      range: `${mo(start)} – ${mo(end)}`,
      isPast, isCur,
      isFuture: !isPast && !isCur,
      amountPaise,
      monthKey: monthKey(start),
      isFirstMonth: isFirst,
    });
    cur.setMonth(cur.getMonth() + 1);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Payment timeline</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">₹{monthlyRupees.toLocaleString('en-IN')} + electricity per month · paid by 10th of following month</p>
        </div>
        <Calendar className="h-4 w-4 text-muted-foreground/40" />
      </div>

      <div className="space-y-2">
        {months.map((m, i) => {
          const record = paymentRecords.find(p => p.month === m.monthKey);
          const isPaid = record?.status === 'paid';
          const isSkipped = record?.status === 'skipped';

          return (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                m.isCur    ? 'border border-primary/30 bg-primary/5'  :
                m.isPast   ? 'border border-border bg-muted/20'       :
                             'border border-border/40 bg-transparent opacity-50'
              }`}
            >
              {/* Status dot */}
              <div className={`h-2 w-2 rounded-full shrink-0 ${
                m.isCur    ? 'bg-primary animate-pulse' :
                isPaid     ? 'bg-green-500'             :
                isSkipped  ? 'bg-muted-foreground/30'   :
                m.isPast   ? 'bg-amber-400'             :
                             'bg-muted-foreground/20'
              }`} />

              {/* Month + range */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${m.isCur ? 'text-primary' : m.isPast ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {m.label}
                </p>
                <p className="text-[10px] text-muted-foreground/60">{m.range}</p>
              </div>

              {/* Amount + status */}
              <div className="text-right shrink-0">
                {isPaid ? (
                  <div className="flex items-center gap-1.5">
                    <div className="text-right">
                      <span className="text-xs font-bold text-green-600">₹{((record?.amountPaise ?? m.amountPaise) / 100).toLocaleString('en-IN')}</span>
                      {record?.paidAt && <p className="text-[9px] text-green-600/60">{new Date(record.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
                    </div>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  </div>
                ) : isSkipped ? (
                  <span className="text-[10px] text-muted-foreground/40 font-medium">Skipped</span>
                ) : m.isCur ? (
                  // Current month — not yet claimable; show in-progress amount
                  <div className="text-right">
                    <span className="text-xs font-bold text-primary">₹{(m.amountPaise / 100).toLocaleString('en-IN')}</span>
                    <p className="text-[9px] text-primary/50 mt-0.5">In progress</p>
                  </div>
                ) : m.isPast ? (
                  // Past month, unpaid — show Claim button
                  <button
                    onClick={() => onClaim(m.monthKey, m.amountPaise)}
                    className="flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white hover:opacity-90 transition-opacity"
                  >
                    <Download className="h-2.5 w-2.5" /> Claim ₹{(m.amountPaise / 100).toLocaleString('en-IN')}
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground/40 font-medium">Upcoming</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Referral card ────────────────────────────────────────────────────────────

function ReferralCard({ store }: { store: StoreInfo }) {
  const [copied, setCopied] = useState(false);
  const code = store.referralCode ?? '—';

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Gift className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <div>
          <h2 className="text-sm font-bold text-foreground">Your referral code</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Earn ₹500 for every new store partner who joins using your code.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3">
        <span className="flex-1 text-xl font-black tracking-[0.2em] text-foreground font-mono">{code}</span>
        <button onClick={copy} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all">
          {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
        </button>
      </div>

      <div className="text-[10px] text-muted-foreground/50 leading-relaxed">
        Share on WhatsApp · Referral bonus credited once the referred store goes live · No limit on referrals
      </div>
    </div>
  );
}

// ─── Claim payout modal ───────────────────────────────────────────────────────

function ClaimModal({ store, onClose, claimMonthKey, claimAmountPaise }: {
  store: StoreInfo; onClose: () => void;
  claimMonthKey: string; claimAmountPaise: number;
}) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);
  // claimMonthKey is "YYYY-MM"; display as e.g. "March 2025"
  const [year, mo] = claimMonthKey.split('-');
  const month = new Date(Number(year), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const amountRs = (claimAmountPaise / 100).toLocaleString('en-IN');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 32 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 space-y-5"
      >
        {sent ? (
          <div className="text-center space-y-3 py-2">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 ring-8 ring-green-500/8">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
            </div>
            <div>
              <p className="text-base font-bold text-foreground">Claim submitted!</p>
              <p className="text-xs text-muted-foreground mt-1">
                Our team will process your payout for {month} within 3–5 business days via UPI to +91 {store.whatsapp}.
              </p>
            </div>
            <button onClick={onClose} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:opacity-90 transition-opacity">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-foreground">Claim monthly reward</h3>
              <p className="text-xs text-muted-foreground">Request your payout for {month}.</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Period</span>
                <span className="font-semibold text-foreground">{month}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold text-green-600">₹{amountRs} + electricity</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">UPI / WhatsApp</span>
                <span className="font-semibold text-foreground">+91 {store.whatsapp}</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
              Actual payout is calculated based on verified screen uptime and campaign bookings for the month. Final amount may vary.
            </p>
            {err && <p className="text-[11px] text-destructive rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">{err}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl border border-border py-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setBusy(true); setErr(null);
                  try {
                    const res = await storeFetch('/api/payout-claim', {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body:    JSON.stringify({ month: claimMonthKey, amountPaise: claimAmountPaise }),
                    });
                    if (!res.ok) {
                      const d = await res.json().catch(() => null) as { error?: string } | null;
                      throw new Error(res.status === 401 ? 'Session expired — please log in again.' : (d?.error ?? 'Failed. Try again.'));
                    }
                    setSent(true);
                  } catch (e) { setErr((e as Error).message ?? 'Failed. Try again.'); }
                  finally { setBusy(false); }
                }}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-red-500 to-red-700 py-3 text-xs font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Submit claim'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── Agreement card (dashboard) ───────────────────────────────────────────────

function AgreementCard({ store }: { store: StoreInfo }) {
  const agreedAt = store.agreedAt;
  const monthlyRupees = Math.round((store.monthlyCompensationPaise ?? 50000) / 100);
  const date = agreedAt
    ? new Date(agreedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border">
        <div>
          <h2 className="text-sm font-bold text-foreground">Your Store Partner Agreement</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Signed on {date}</p>
        </div>
        <Shield className="h-4 w-4 text-muted-foreground/40" />
      </div>

      {/* Prefilled parties */}
      <div className="px-5 py-3 border-b border-border bg-muted/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black text-foreground">{store.storeName}</p>
            <p className="text-[11px] text-muted-foreground">{store.ownerName} · +91 {store.whatsapp}</p>
            {store.city && <p className="text-[10px] text-muted-foreground/60">{[store.locality, store.city, store.pincode].filter(Boolean).join(', ')}</p>}
            {store.gstin
              ? <p className="text-[10px] text-muted-foreground/60 font-mono">GSTIN: {store.gstin}</p>
              : <p className="text-[10px] text-muted-foreground/40">GSTIN: —</p>
            }
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] font-semibold text-foreground">VS Collective LLP</p>
            <p className="text-[10px] text-muted-foreground">ALIVE · {date}</p>
          </div>
        </div>
      </div>

      {/* Key terms compact */}
      <div className="divide-y divide-border">
        {[
          { t: 'Remuneration', d: `₹${monthlyRupees.toLocaleString('en-IN')}/month per screen, fixed. Paid within 10 working days of month end via UPI/NEFT.` },
          { t: 'Electricity',  d: 'Reimbursed at screen rated power × actual hours × prevailing tariff.' },
          { t: 'Equipment',    d: 'Screen installed free. Remains ALIVE property at all times.' },
          { t: 'Exit',         d: '30 days written notice by either party. ALIVE removes screen at its cost.' },
        ].map(({ t, d }) => (
          <div key={t} className="px-5 py-2.5 flex gap-3 text-xs">
            <span className="font-bold text-foreground/80 shrink-0 w-24">{t}</span>
            <span className="text-muted-foreground">{d}</span>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground/50">Agreement accepted · {date}</p>
        <a href="/store-agreement" target="_blank" rel="noreferrer"
          className="text-[11px] font-semibold text-primary hover:underline underline-offset-2">
          Full agreement →
        </a>
      </div>
    </div>
  );
}

// ─── Earnings estimator ──────────────────────────────────────────────────────

const EARNING_TABLE = [
  { screens: 1, monthly: 500,  annual: 6000  },
  { screens: 2, monthly: 1000, annual: 12000 },
  { screens: 3, monthly: 1500, annual: 18000 },
];

function buildTimeline(store: StoreInfo) {
  const stage = store.onboardingStage ?? 'new';
  // Admin panel uses physically_onboarded/digitally_onboarded; treat them as past verification + install
  const isContacted = ['contacted', 'visited', 'installed', 'physically_onboarded', 'digitally_onboarded', 'live', 'rejected'].includes(stage);
  const isVisited   = ['visited', 'installed', 'physically_onboarded', 'digitally_onboarded', 'live'].includes(stage);
  const isInstalled = ['installed', 'physically_onboarded', 'digitally_onboarded', 'live'].includes(stage) || (store.deviceCount ?? 0) > 0;
  const isLive      = stage === 'live' || !!store.liveAt;

  return [
    { label: 'Registration received', desc: 'Your details are saved successfully.', done: true, active: false },
    { label: 'Team verification',     desc: 'Our team will call you within 24 hours.', done: isContacted, active: !isContacted },
    { label: 'Site visit & install',  desc: 'Free screen installed at your store.', done: isInstalled, active: isContacted && !isInstalled },
    { label: 'Screen goes live',      desc: 'Ads start running — you start earning!', done: isLive, active: isInstalled && !isLive },
  ];
}



function OffersAndPayoutSettings({ store, onSaved }: { store: StoreInfo; onSaved: (patch: Partial<StoreInfo>) => void }) {
  const [payout, setPayout] = useState({
    payoutMethod: store.payoutMethod ?? 'upi',
    upiId: store.upiId ?? '', bankAccountName: store.bankAccountName ?? '', bankAccountNo: store.bankAccountNo ?? '', bankIfsc: store.bankIfsc ?? '', bankName: store.bankName ?? '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/stores/me?storeId=${encodeURIComponent(store.id ?? '')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(store.token ? { 'x-store-token': store.token } : {}) }, body: JSON.stringify(payout) });
      if (res.ok) onSaved(payout);
      else {
        // Silent loss of payout details is worse than a blunt alert.
        alert(res.status === 401
          ? 'Session expired — please log in again, then save your payout details.'
          : 'Could not save payout details. Please try again.');
      }
    } finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-sm font-bold">Payout method</h2>
      <p className="text-xs text-muted-foreground">Where should we send your monthly ₹{Math.round((store.monthlyCompensationPaise ?? 50000) / 100).toLocaleString('en-IN')} + electricity reimbursement?</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={()=>setPayout((p)=>({...p,payoutMethod:'upi'}))} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${payout.payoutMethod==='upi' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>UPI</button>
        <button onClick={()=>setPayout((p)=>({...p,payoutMethod:'bank'}))} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${payout.payoutMethod==='bank' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>Bank transfer</button>
      </div>
      {payout.payoutMethod==='upi'
        ? <input value={payout.upiId} onChange={(e)=>setPayout((p)=>({...p,upiId:e.target.value}))} placeholder="UPI ID (e.g. name@upi)" className="w-full rounded-lg border border-border px-3 py-2 text-xs" />
        : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={payout.bankAccountName} onChange={(e)=>setPayout((p)=>({...p,bankAccountName:e.target.value}))} placeholder="Account name" className="rounded-lg border border-border px-3 py-2 text-xs" />
            <input value={payout.bankName} onChange={(e)=>setPayout((p)=>({...p,bankName:e.target.value}))} placeholder="Bank name" className="rounded-lg border border-border px-3 py-2 text-xs" />
            <input value={payout.bankAccountNo} onChange={(e)=>setPayout((p)=>({...p,bankAccountNo:e.target.value}))} placeholder="Account number" className="rounded-lg border border-border px-3 py-2 text-xs" />
            <input value={payout.bankIfsc} onChange={(e)=>setPayout((p)=>({...p,bankIfsc:e.target.value.toUpperCase()}))} placeholder="IFSC code" className="rounded-lg border border-border px-3 py-2 text-xs" />
          </div>
      }
      <button onClick={save} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
        {busy ? 'Saving…' : 'Save payout details'}
      </button>
    </div>
  </div>;
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

type DashTab = 'overview' | 'earnings' | 'flyers' | 'voicebill' | 'offers' | 'flyergen' | 'settings' | 'kyc';

const DASH_TABS: { id: DashTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview',  label: 'Overview',   icon: BarChart3    },
  { id: 'earnings',  label: 'Earnings',   icon: IndianRupee  },
  { id: 'flyers',    label: 'My flyers',  icon: FileImage    },
  { id: 'voicebill', label: 'VoiceBill',  icon: ShoppingCart },
  { id: 'offers',    label: 'Offers',     icon: Tag          },
  { id: 'flyergen',  label: 'Flyer',      icon: ImageIcon    },
  { id: 'settings',  label: 'Payout',     icon: Gift         },
  { id: 'kyc',       label: 'KYC',        icon: ShieldCheck  },
];

function MainDashboard({ store, onLogout }: { store: StoreInfo; onLogout: () => void }) {
  const [tab,       setTab]      = useState<DashTab>('overview');
  const [storeData, setStoreData] = useState<StoreInfo>(store);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimMonthKey,    setClaimMonthKey]    = useState('');
  const [claimAmountPaise, setClaimAmountPaise] = useState(50000);

  const displayName = storeData.ownerName?.split(' ')[0] ?? 'Partner';
  const monthlyRupees = Math.round((storeData.monthlyCompensationPaise ?? 50000) / 100);

  const saveEmail = (email: string) => {
    setStoreData((prev) => ({ ...prev, email }));
  };

  const savePhoto = (patch: Partial<StoreInfo>) => {
    setStoreData((prev) => {
      const next = { ...prev, ...patch };
      // Write through to the cached session — without this, a reload before the
      // next /me sync (or any no-cookie session) loses the chip and re-shows
      // the upload box even though the server already has the photo.
      try { localStorage.setItem(LS_SESSION_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/30 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="opacity-80 hover:opacity-100 transition-opacity"><Logo /></a>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
              {displayName[0]?.toUpperCase()}
            </div>
            <button onClick={onLogout} className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-2">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6 space-y-5">

        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36 }}
          className="rounded-2xl overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #1a0505 0%, #2d0a0a 50%, #1a0505 100%)' }}
        >
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/70">Store Partner</p>
              <h1 className="text-xl font-bold text-white">Welcome back, {displayName}!</h1>
              {storeData.locality && (
                <p className="text-xs text-white/50 flex items-center gap-1.5 mt-1">
                  <MapPin className="h-3 w-3 text-primary/70" />
                  {storeData.storeName} · {storeData.locality}{storeData.city ? `, ${storeData.city}` : ''}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center">
                <p className="text-base font-bold text-white">₹{monthlyRupees.toLocaleString('en-IN')}</p>
                <p className="text-[9px] text-white/40">/month</p>
              </div>
              {storeData.liveAt ? (
                <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2.5 text-center">
                  <p className="text-base font-bold text-green-400">Live</p>
                  <p className="text-[9px] text-green-500/60">{(storeData.deviceCount ?? 0)} screen{(storeData.deviceCount ?? 1) !== 1 ? 's' : ''}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-center">
                  <p className="text-base font-bold text-primary">48h</p>
                  <p className="text-[9px] text-primary/60">To live</p>
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-white/10 px-5 sm:px-6 py-2.5 flex items-center gap-2">
            {storeData.liveAt ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                <p className="text-xs text-white/50">
                  <span className="text-white/80 font-semibold">Screen is live</span> — ads are running and you&apos;re earning.
                </p>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <p className="text-xs text-white/50">
                  <span className="text-white/80 font-semibold">Registration received</span> — our team will call +91 {storeData.whatsapp} within 24 hours.
                </p>
              </>
            )}
          </div>
        </motion.div>

        {/* Email banner */}
        <ScreenAlertBanner storeId={storeData.id} token={storeData.token} />
        {!storeData.email && <EmailBanner store={storeData} onSave={saveEmail} />}

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1 overflow-x-auto scrollbar-none">
          {DASH_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-semibold transition-all ${
                  tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">

          {tab === 'overview' && (
            <motion.div key="ov" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} className="space-y-4">

              {/* Timeline — dynamic based on onboardingStage + deviceCount */}
              {(() => {
                const timeline = buildTimeline(storeData);
                const stepDone = timeline.filter(t => t.done).length;
                const stepLabel = stepDone >= 4 ? 'Live ✓' : `Step ${stepDone} of 4`;
                return (
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-5">
                      <h2 className="text-sm font-bold text-foreground">
                        {stepDone >= 4 ? 'Your store is live!' : 'What happens next'}
                      </h2>
                      <span className={`text-xs bg-muted px-2 py-1 rounded-full ${stepDone >= 4 ? 'text-green-600 font-bold' : 'text-muted-foreground'}`}>
                        {stepLabel}
                      </span>
                    </div>
                    <div className="space-y-0">
                      {timeline.map((item, i) => (
                        <div key={item.label} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              item.done   ? 'bg-primary text-white' :
                              item.active ? 'border-2 border-primary bg-primary/10 text-primary' :
                                            'border-2 border-border bg-background text-muted-foreground'
                            }`}>
                              {item.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : item.active ? <Clock className="h-3.5 w-3.5" /> : <span>{i+1}</span>}
                            </div>
                            {i < timeline.length - 1 && <div className={`w-px flex-1 min-h-[24px] mt-1 mb-1 ${item.done ? 'bg-primary/30' : 'bg-border'}`} />}
                          </div>
                          <div className="pb-4 flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${item.done ? 'text-foreground' : item.active ? 'text-primary' : 'text-muted-foreground'}`}>{item.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                            {/* GPS photo evidence: shop front for Team verification (step 2),
                                installed TV for Site visit & install (step 3). */}
                            {i === 1 && (storeData.shopPhotoUrl
                              ? <GpsPhotoChip url={storeData.shopPhotoUrl} lat={storeData.shopPhotoLat} lng={storeData.shopPhotoLng} at={storeData.shopPhotoAt} />
                              : <GpsPhotoUpload kind="shop" store={storeData} onUploaded={savePhoto} />)}
                            {i === 2 && (storeData.installPhotoUrl
                              ? <GpsPhotoChip url={storeData.installPhotoUrl} lat={storeData.installPhotoLat} lng={storeData.installPhotoLng} at={storeData.installPhotoAt} />
                              : storeData.shopPhotoUrl
                              ? <GpsPhotoUpload kind="install" store={storeData} onUploaded={savePhoto} />
                              : null)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Referral */}
              <ReferralCard store={storeData} />

              {/* Agreement */}
              <AgreementCard store={storeData} />

              {/* Quick actions */}
              <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quick actions</h2>
                {[
                  { icon: MessageCircle, label: 'WhatsApp support', desc: 'Chat with our team', href: 'https://wa.me/919741324448?text=Hi+Alive+team,+I+am+a+registered+store+partner.', color: 'text-[#25D366]' },
                  { icon: Phone,         label: 'Call us',           desc: '+91 74113 24448',   href: 'tel:+919741324448', color: 'text-blue-500' },
                ].map((a) => (
                  <a key={a.label} href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-primary/30 hover:bg-muted/30 transition-all group"
                  >
                    <a.icon className={`h-4 w-4 shrink-0 ${a.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{a.label}</p>
                      <p className="text-xs text-muted-foreground/60">{a.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </a>
                ))}
              </div>

              {/* FAQ */}
              <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Common questions</h2>
                {[
                  { q: 'When will my screen be installed?',  a: 'Our team will visit within 48–72 hours of verification. Installation takes ~2 hours.' },
                  { q: 'When do I receive my first payout?', a: 'Payouts are processed monthly, 7 days after the end of each billing cycle via UPI/NEFT.' },
                  { q: 'What if the screen has a problem?',  a: 'We monitor screens 24/7 remotely. Hardware issues are resolved within 24 hours.' },
                  { q: 'Can I host more than one screen?',   a: 'Yes! Tell your relationship manager when they call — more screens means more income.' },
                ].map((faq) => (
                  <div key={faq.q} className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">{faq.q}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {tab === 'earnings' && (
            <motion.div key="earn" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} className="space-y-4">

              {/* Single-line stats */}
              <div className="rounded-2xl border border-border bg-card px-5 py-3 flex items-center divide-x divide-border">
                {[
                  { label: 'Total earned', value: '₹0',   accent: false },
                  { label: 'This month',   value: `₹${monthlyRupees.toLocaleString('en-IN')}`, accent: true  },
                  { label: 'Per referral', value: '₹500', accent: false },
                ].map((s) => (
                  <div key={s.label} className="flex-1 text-center px-3 py-1">
                    <p className={`text-base font-black ${s.accent ? 'text-primary' : 'text-foreground'}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* 12-month timeline */}
              <PaymentTimeline store={storeData} onClaim={(mk, ap) => { setClaimMonthKey(mk); setClaimAmountPaise(ap); setClaimOpen(true); }} />

            </motion.div>
          )}

          {tab === 'flyers' && (
            <motion.div key="fly" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-foreground">Active flyers</h2>
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-full">Published by Alive team</span>
                </div>
                <StoreFlyers storeId={storeData.id} storeName={storeData.storeName} token={storeData.token} />
              </div>
              <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
                <h2 className="text-sm font-bold text-foreground">Want to run a flyer?</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Contact your Alive relationship manager to publish weekly offers, discounts or promotions for your store.
                  Our design team can help create the flyer too.
                </p>
                <a
                  href="https://wa.me/919741324448?text=Hi+Alive,+I+want+to+publish+a+flyer+for+my+store."
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 bg-[#25D366]/8 px-4 py-2.5 text-xs font-semibold text-[#25D366] hover:bg-[#25D366]/15 transition-colors"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Request a flyer on WhatsApp
                </a>
              </div>
            </motion.div>
          )}

          {tab === 'voicebill' && (
            <motion.div key="vb" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <VoiceBillTab storeId={storeData.id} storeName={storeData.storeName} upiId={storeData.upiId} />
            </motion.div>
          )}

          {tab === 'offers' && (
            <motion.div key="offers" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <OffersTab />
            </motion.div>
          )}

          {tab === 'flyergen' && (
            <motion.div key="flyergen" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <FlyerTab storeName={storeData.storeName} />
            </motion.div>
          )}

          {tab === 'settings' && (
            <motion.div key="set" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <OffersAndPayoutSettings store={storeData} onSaved={(patch) => setStoreData((p) => ({ ...p, ...patch }))} />
            </motion.div>
          )}

          {tab === 'kyc' && (
            <motion.div key="kyc" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <KycTab />
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      <footer className="border-t border-border/30 py-5 text-center mt-6">
        <p className="text-xs text-muted-foreground/30">© 2025 ALIVE Advertising Pvt. Ltd. · Mangaluru</p>
      </footer>

      <AnimatePresence>
        {claimOpen && <ClaimModal store={storeData} onClose={() => setClaimOpen(false)} claimMonthKey={claimMonthKey} claimAmountPaise={claimAmountPaise} />}
      </AnimatePresence>

      <PwaInstallBanner />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const LS_SESSION_KEY = 'alive_store_session';

function readLocalSession(): StoreInfo | null {
  try {
    const raw = localStorage.getItem(LS_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoreInfo;
  } catch { return null; }
}

export default function StoreDashboardPage() {
  const { data: session, status } = useSession();
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // On first render, try to populate from localStorage immediately.
  // This ensures the dashboard is usable right after registration even if
  // the next-auth session or /api/stores/me isn't established yet.
  useEffect(() => {
    if (storeInfo) return;
    const local = readLocalSession();
    if (local?.storeName) setStoreInfo(local);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStore = useCallback(async (attempt = 0) => {
    setStoreLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20000);
    try {
      // storeFetch attaches the cached signed x-store-token, so this works
      // even after the next-auth cookie has expired.
      const res = await storeFetch('/api/stores/me', { signal: controller.signal });
      if (res.ok) {
        const data = await res.json() as StoreInfo;
        setStoreInfo(data);
        // Keep localStorage in sync with server data
        try { localStorage.setItem(LS_SESSION_KEY, JSON.stringify(data)); } catch { /* ignore */ }
        return;
      }
      if (res.status === 401 || res.status === 404) {
        // Deterministic: neither cookie nor cached token vouches for a store
        // any more (expired/pre-token session, or the store row is gone).
        // Retrying can't fix it — clear the stale cache and ask for a fresh
        // login instead of rendering frozen data forever.
        try { localStorage.removeItem(LS_SESSION_KEY); } catch { /* ignore */ }
        setStoreInfo(null);
        setSessionExpired(true);
        void signOut({ redirect: false }).catch(() => { /* no live session */ });
        return;
      }
      if (attempt === 0) {
        clearTimeout(tid);
        setStoreLoading(false);
        await new Promise(r => setTimeout(r, 3000));
        return fetchStore(1);
      }
      // API failed but we might still have localStorage data — don't show error if we do
      if (!readLocalSession()) setLoadError('Could not load your store. Please tap retry.');
    } catch (e) {
      const err = e as Error;
      if (attempt === 0) {
        clearTimeout(tid);
        setStoreLoading(false);
        await new Promise(r => setTimeout(r, 3000));
        return fetchStore(1);
      }
      if (!readLocalSession()) {
        setLoadError(err.name === 'AbortError' ? 'Taking too long — the server may be waking up. Tap to retry.' : 'Connection error. Tap to retry.');
      }
    } finally {
      clearTimeout(tid);
      setStoreLoading(false);
    }
  }, []);

  const [sessionTimedOut, setSessionTimedOut] = useState(false);
  useEffect(() => {
    if (status !== 'loading') return;
    const t = setTimeout(() => setSessionTimedOut(true), 20000);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (status === 'authenticated') { fetchStore(); return; }
    if (status === 'unauthenticated') {
      const local = readLocalSession();
      // Cookie gone, but the cached signed token can still authenticate the
      // refresh — and if it can't, fetchStore clears the cache and surfaces
      // the login form instead of leaving frozen data on screen.
      if (local?.token) { fetchStore(); return; }
      if (local) {
        // Pre-token cache (before the 2026-08-18 IDOR fix) with no cookie:
        // every API call would 401 and the data on screen is frozen forever.
        try { localStorage.removeItem(LS_SESSION_KEY); } catch { /* ignore */ }
        setStoreInfo(null);
        setSessionExpired(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleLogout = async () => {
    await signOut({ redirect: false });
    try { localStorage.removeItem(LS_SESSION_KEY); } catch { /* ignore */ }
    setStoreInfo(null);
  };

  // If localStorage gave us store data, skip all loading/error screens
  if (storeInfo) return <MainDashboard store={storeInfo} onLogout={handleLogout} />;

  if (status === 'loading' && !sessionTimedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (sessionTimedOut && status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">Session check is taking too long — the server may be waking up.</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white">Retry</button>
      </div>
    );
  }

  if (storeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <button onClick={() => void fetchStore()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white">Retry</button>
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <>
        {sessionExpired && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center text-xs font-medium text-amber-800">
            Your session has expired. Log in again to see your store data — nothing has been lost.
          </div>
        )}
        <PhoneLogin />
      </>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
