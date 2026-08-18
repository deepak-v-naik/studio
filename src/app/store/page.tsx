'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import {
  IndianRupee, Zap, Shield, CheckCircle2, AlertCircle,
  ChevronRight, ChevronLeft, Check, Loader2, Clock, Star, Gift, Tag,
} from 'lucide-react';
import { Logo } from '@/components/icons/logo';
import MapPicker from '@/components/map-picker';

// ─── Shared source-of-truth ────────────────────────────────────────────────────────────────
// Edit shared/agreement-terms.ts, shared/validation.ts, or shared/constants.ts
// to update both this web page and the mobile app simultaneously.
import { AGREEMENT_TERMS, agreementTermsFor } from '@shared/agreement-terms';
import {
  validateForm, makeReferralCode, FORM_INIT,
  type FieldErrors, type FormData,
} from '@shared/validation';
import { COMPANY, SUPPORT_WHATSAPP } from '@shared/constants';
// ──────────────────────────────────────────────────────────────────────────────

type Form = FormData;
const INIT: Form = FORM_INIT;

// ─── Password strength ────────────────────────────────────────────────────────

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const criteria = [
    { label: 'At least 6 characters',    met: password.length >= 6 },
    { label: 'Contains a number',        met: /\d/.test(password) },
    { label: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Contains special character', met: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = criteria.filter((c) => c.met).length;
  const barColor = score <= 1 ? 'bg-red-400' : score <= 2 ? 'bg-amber-400' : score <= 3 ? 'bg-yellow-400' : 'bg-green-500';

  return (
    <div className="space-y-1.5 -mt-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`flex-1 h-1 rounded-full transition-all duration-300 ${i <= score ? barColor : 'bg-gray-200'}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {criteria.map((c) => (
          <span key={c.label} className={`flex items-center gap-1 text-[10px] ${c.met ? 'text-green-600' : 'text-gray-400'}`}>
            {c.met
              ? <Check className="h-2.5 w-2.5 shrink-0" />
              : <span className="h-2.5 w-2.5 shrink-0 flex items-center justify-center text-[8px]">✗</span>
            }
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Field ───────────────────────────────────────────────────────────────────

function Field({ label, value, onChange, type = 'text', placeholder, prefix, error, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; prefix?: string; error?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500">{label}</label>
      <div className="flex">
        {prefix && (
          <span className={`flex items-center px-3 rounded-l-xl text-sm font-bold border-y border-l bg-gray-50 ${error ? 'border-red-300' : 'border-gray-200'} text-gray-600`}>{prefix}</span>
        )}
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className={`w-full px-3 py-2.5 text-sm rounded-xl border bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all
            ${prefix ? 'rounded-l-none' : ''}
            ${error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-red-400 focus:ring-red-100'}`}
        />
      </div>
      {error
        ? <p className="text-[11px] text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{error}</p>
        : hint ? <p className="text-[10px] text-gray-400">{hint}</p> : null
      }
    </div>
  );
}

// ─── Agreement step ───────────────────────────────────────────────────────────

function AgreementStep({ form, agreed, setAgreed, onBack, onSubmit, busy, err, premium, premiumMonthly }: {
  form: Form; agreed: boolean; setAgreed: (v: boolean) => void;
  onBack: () => void; onSubmit: () => void; busy: boolean; err: string;
  premium: boolean; premiumMonthly: number;
}) {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const gstin = form.gstin ? form.gstin.toUpperCase() : null;
  const terms = premium ? agreementTermsFor(premiumMonthly) : AGREEMENT_TERMS;
  const fullAddress = [form.address, form.locality, form.city, form.pincode].filter(Boolean).join(', ');

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="space-y-4">

      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 transition-all"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex items-center gap-2 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white text-[10px] font-black"><Check className="h-3 w-3" /></span>
            <span className="text-[10px] text-gray-400">Details</span>
          </div>
          <div className="flex-1 h-px bg-red-200" />
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black">2</span>
            <span className="text-[10px] font-semibold text-red-500">Agreement</span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">Step 2 of 2</p>
        <h3 className="text-base font-black text-gray-900 mt-0.5">Store Partner Agreement</h3>
        <p className="text-xs text-gray-500 mt-0.5">Read the key terms below, then sign digitally.</p>
        {premium && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1">
            <Star className="h-3 w-3 text-amber-500" />
            <span className="text-[11px] font-bold text-amber-700">Premium partner — ₹{premiumMonthly.toLocaleString('en-IN')}/month + electricity</span>
          </div>
        )}
      </div>

      {/* Parties block */}
      <div className="rounded-xl border-2 border-red-100 bg-red-50/60 p-4 space-y-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-red-400 mb-1">Party A — Company</p>
          <p className="text-sm font-bold text-gray-900">{COMPANY.name}</p>
          <p className="text-xs text-gray-500">{COMPANY.address}</p>
          <p className="text-xs text-gray-500">GSTIN: {COMPANY.gstin} · LLP: {COMPANY.llp}</p>
        </div>
        <div className="border-t border-red-100 pt-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-red-400 mb-1">Party B — Store Partner</p>
          <p className="text-sm font-bold text-gray-900">{form.storeName}</p>
          <p className="text-xs text-gray-600">{form.ownerName} · +91 {form.whatsapp}</p>
          {fullAddress && <p className="text-xs text-gray-500">{fullAddress}</p>}
          {gstin && <p className="text-xs text-gray-500 font-mono">GSTIN: {gstin}</p>}
          <p className="text-xs text-gray-400 mt-1">Date of execution: {today}</p>
        </div>
      </div>

      {/* Agreement terms ─ from shared/agreement-terms.ts */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <p className="text-xs font-bold text-gray-700">Terms &amp; Conditions — Store Partner Agreement</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Scroll to read all terms before signing</p>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
          {terms.map(({ heading, body }) => (
            <div key={heading} className="px-4 py-3 flex gap-3 text-xs">
              <span className="font-bold text-gray-800 shrink-0 w-28">{heading}</span>
              <span className="text-gray-500 leading-relaxed">{body}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/40">
          <p className="text-[10px] text-gray-400">Full legal document</p>
          <a
            href={`/store-agreement?${new URLSearchParams({ name: form.storeName, owner: form.ownerName, address: fullAddress, phone: form.whatsapp, ...(gstin ? { gstin } : {}), ...(premium ? { monthly: String(premiumMonthly) } : {}) }).toString()}`}
            target="_blank" rel="noreferrer"
            className="text-[11px] text-red-500 hover:text-red-600 font-semibold flex items-center gap-1"
          >
            Open full PDF version <ChevronRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Checkbox */}
      <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-gray-200 bg-gray-50 p-3.5 hover:bg-gray-100 transition-colors">
        <div className="relative mt-0.5 shrink-0">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="sr-only" />
          <div className={`h-[18px] w-[18px] rounded border-2 transition-all flex items-center justify-center ${agreed ? 'border-red-500 bg-red-500' : 'border-gray-300 bg-white'}`}>
            {agreed && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </div>
        </div>
        <span className="text-xs text-gray-600 leading-relaxed">
          I, <strong className="text-gray-900">{form.ownerName}</strong>, on behalf of <strong className="text-gray-900">{form.storeName}</strong>, have read and agree to the Store Partner Agreement with {COMPANY.name}, effective {today}. I confirm this electronic acceptance is legally binding under the IT Act, 2000.
        </span>
      </label>

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-500" />
          <p className="text-xs text-red-600">{err}</p>
        </div>
      )}

      <button type="button" onClick={onSubmit} disabled={busy || !agreed}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-base font-black text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)', boxShadow: agreed ? '0 4px 16px -4px rgba(220,38,38,0.4)' : 'none' }}
      >
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Registering…</> : <><CheckCircle2 className="h-4 w-4" /> I agree — Register my store</>}
      </button>
      {busy && (
        <p className="text-center text-xs text-gray-400 mt-1">This can take up to 20 seconds on first try…</p>
      )}
    </motion.div>
  );
}

// ─── Registration form ────────────────────────────────────────────────────────

const DRAFT_KEY = 'alive_store_draft';

function RegistrationForm({ premium, premiumMonthly, premiumKey }: {
  premium: boolean; premiumMonthly: number; premiumKey: string | null;
}) {
  const router    = useRouter();
  const [form,    setForm]    = useState<Form>(INIT);
  const [step,    setStep]    = useState<1 | 2>(1);
  const [agreed,  setAgreed]  = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [done,    setDone]    = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (saved && saved.trim()) setForm(JSON.parse(saved) as Form);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* ignore */ }
  }, [form]);

  const set = (k: keyof Form, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const errors    = useMemo(() => validateForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const handleLocation = (lat: string, lng: string, locality: string, pincode: string, city: string) => {
    setForm((p) => ({ ...p, lat, lng, locality: locality || p.locality, pincode: pincode || p.pincode, city: city || p.city }));
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasErrors) { setTouched(true); return; }
    setStep(2);
  };

  const submit = async () => {
    setBusy(true); setErr('');
    const code = makeReferralCode(form.storeName, form.ownerName);
    const payload = {
      ...form,
      gstin:        form.gstin ? form.gstin.toUpperCase() : undefined,
      referralCode: code,
      agreedAt:     new Date().toISOString(),
      premiumKey:   premiumKey ?? undefined, // server re-validates; grants premium tier
    };
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 20000);
      let res: Response;
      try {
        res = await fetch('/api/stores/save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          signal:  controller.signal,
        });
      } catch (fetchErr) {
        const e = fetchErr as Error;
        setErr(e.name === 'AbortError' ? 'Request timed out — the server is waking up. Please try again.' : 'Network error — check your connection and try again.');
        return;
      } finally { clearTimeout(tid); }

      let body: { data?: { success?: boolean; error?: string; referralCode?: string }; success?: boolean; error?: string };
      try { body = await res.json(); } catch { body = {}; }
      const payload2 = (body as { data?: { success?: boolean; error?: string } }).data ?? body as { success?: boolean; error?: string };

      if (!res.ok) {
        setErr((payload2 as { error?: string }).error || `Registration failed (${res.status}). Please try again.`);
        return;
      }

      try {
        const reg = payload2 as { referralCode?: string; storeId?: string; storeToken?: string };
        const referralCode = reg.referralCode ?? code;
        localStorage.setItem('alive_store_session', JSON.stringify({
          // id + signed token authorize store API calls before the first
          // next-auth login (see resolveStoreId) — undefined keys are dropped
          id:           reg.storeId,
          token:        reg.storeToken,
          storeName:    form.storeName,
          ownerName:    form.ownerName,
          whatsapp:     form.whatsapp,
          phone:        form.whatsapp,
          address:      form.address,
          locality:     form.locality,
          city:         form.city,
          pincode:      form.pincode,
          lat:          form.lat,
          lng:          form.lng,
          gstin:        form.gstin || null,
          referralCode,
          referredBy:   form.referredBy || null,
          agreedAt:     new Date().toISOString(),
        }));
      } catch { /* localStorage unavailable */ }

      try {
        await signIn('phone-password', {
          phone:    `+91${form.whatsapp}`,
          password: form.password,
          redirect: false,
        });
      } catch { /* non-fatal */ }

      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }

      setDone(true);
      setTimeout(() => router.push('/store-dashboard'), 1500);
    } catch (e) {
      const msg = (e as Error)?.message;
      setErr(msg && msg.length < 200 ? msg : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  if (done) return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-3 py-6">
      <div className="flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
          <CheckCircle2 className="h-7 w-7 text-green-600" />
        </div>
      </div>
      <div>
        <p className="text-lg font-bold text-gray-900">Registration received!</p>
        <p className="text-sm text-gray-500 mt-1">Taking you to your dashboard…</p>
      </div>
    </motion.div>
  );

  if (step === 2) return (
    <AgreementStep form={form} agreed={agreed} setAgreed={setAgreed} onBack={() => setStep(1)} onSubmit={submit} busy={busy} err={err} premium={premium} premiumMonthly={premiumMonthly} />
  );

  const fe = (k: keyof Form) => touched ? (errors as FieldErrors)[k] : undefined;

  return (
    <form onSubmit={handleContinue} className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black">1</span>
        <div className="flex-1 h-px bg-gray-200" />
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 text-gray-400 text-[10px] font-black">2</span>
        <span className="text-[10px] text-gray-400">Agreement</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Store name" value={form.storeName} onChange={(v) => set('storeName', v)} placeholder="Sharma Store" error={fe('storeName')} />
        <Field label="Owner name" value={form.ownerName} onChange={(v) => set('ownerName', v)} placeholder="Ramesh Sharma" error={fe('ownerName')} />
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500">WhatsApp number</label>
        <div className="flex">
          <span className={`flex items-center px-3 rounded-l-xl text-sm font-bold border-y border-l bg-gray-50 ${fe('whatsapp') ? 'border-red-300' : 'border-gray-200'} text-gray-600`}>+91</span>
          <input type="tel" value={form.whatsapp}
            onChange={(e) => set('whatsapp', e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="98765 43210"
            className={`w-full px-3 py-2.5 text-sm rounded-l-none rounded-xl border bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all ${fe('whatsapp') ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-red-400 focus:ring-red-100'}`}
          />
        </div>
        {fe('whatsapp')
          ? <p className="text-[11px] text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{fe('whatsapp')}</p>
          : (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <span className="text-gray-400 text-sm font-bold shrink-0">★</span>
              <p className="text-[11px] text-gray-600 font-semibold">This number is your login username — save it.</p>
            </div>
          )
        }
      </div>

      <div className="space-y-1.5">
        <Field label="Password" value={form.password} onChange={(v) => set('password', v)}
          type="password" placeholder="Min. 6 characters" error={fe('password')}
        />
        <PasswordStrength password={form.password} />
        {!fe('password') && !form.password && (
          <p className="text-[10px] text-gray-400">Use this to sign in to your dashboard at any time.</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500">Pin your shop on the map</label>
        <p className="text-[10px] text-gray-400">Tap “Use my current location” or drag the pin. City and pincode will be autofilled.</p>
        <MapPicker lat={form.lat} lng={form.lng} onLocation={handleLocation} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Locality" value={form.locality} onChange={(v) => set('locality', v)} placeholder="Kankanady" />
        <Field label="Pincode" value={form.pincode} onChange={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))} placeholder="575002" error={fe('pincode')} />
      </div>
      <Field label="City" value={form.city} onChange={(v) => set('city', v)} placeholder="Mangaluru" error={fe('city')} />

      <div className="space-y-1">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500">Shop address</label>
        <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)}
          placeholder="Door no., street name, landmark…"
          className={`w-full px-3 py-2.5 text-sm rounded-xl border bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all resize-none ${fe('address') ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-red-400 focus:ring-red-100'}`}
        />
        {fe('address') && <p className="text-[11px] text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{fe('address')}</p>}
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500">
          GSTIN <span className="normal-case font-normal text-gray-400">(optional)</span>
        </label>
        <input type="text" value={form.gstin}
          onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15))}
          placeholder="e.g. 29AAXFV2589C1ZE"
          className={`w-full px-3 py-2.5 text-sm rounded-xl border bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 transition-all font-mono tracking-wider ${fe('gstin') ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-gray-200 focus:border-red-400 focus:ring-red-100'}`}
        />
        {fe('gstin')
          ? <p className="text-[11px] text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{fe('gstin')}</p>
          : <p className="text-[10px] text-gray-400">Enter your shop&apos;s GST number if registered.</p>
        }
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500">
          Referral code <span className="normal-case font-normal text-gray-400">(optional)</span>
        </label>
        <input type="text" value={form.referredBy} onChange={(e) => set('referredBy', e.target.value.toUpperCase())} placeholder="e.g. SHAR123"
          className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 transition-all tracking-widest font-mono"
        />
        <p className="text-[10px] text-gray-400">Have a code from another store partner? Enter it to help them earn ₹500.</p>
      </div>

      <button type="submit"
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-base font-black text-white transition-all"
        style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)', boxShadow: '0 4px 16px -4px rgba(220,38,38,0.35)' }}
      >
        Continue to Agreement <ChevronRight className="h-5 w-5" />
      </button>

      {touched && hasErrors && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-center text-xs text-red-500">
          Please fix the highlighted fields above to continue.
        </motion.p>
      )}

      <p className="text-center text-xs text-gray-400">
        Already registered?{' '}
        <a href="/store-dashboard" className="text-red-500 hover:text-red-600 font-semibold">Sign in →</a>
      </p>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StorePage() {
  // Premium signup is enabled only by a valid key from the gated premium link
  // (?premium=KEY), validated server-side. Drives both the pitch and the form.
  const [premium,        setPremium]        = useState(false);
  const [premiumMonthly, setPremiumMonthly] = useState(500); // rupees
  const [premiumKey,     setPremiumKey]     = useState<string | null>(null);

  useEffect(() => {
    let key: string | null = null;
    try { key = new URLSearchParams(window.location.search).get('premium'); } catch { /* ignore */ }
    if (!key) return;
    setPremiumKey(key);
    fetch(`/api/stores/premium-validate?key=${encodeURIComponent(key)}`)
      .then((r) => r.ok ? r.json() as Promise<{ premium: boolean; monthlyPaise: number }> : null)
      .then((d) => { if (d?.premium) { setPremium(true); setPremiumMonthly(Math.round(d.monthlyPaise / 100)); } })
      .catch(() => { /* invalid key → stays standard */ });
  }, []);

  const monthlyLabel = premiumMonthly.toLocaleString('en-IN');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/"><Logo /></a>
          <a href="/store-dashboard" className="text-xs font-semibold text-gray-500 hover:text-gray-900 transition-colors">Partner login →</a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">

        {/* Left: pitch */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="lg:sticky lg:top-24 space-y-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[11px] font-bold text-red-600 tracking-wider uppercase">Kirana Partners · Mangaluru</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-black text-gray-900 leading-[1.08] tracking-tight">
              Extra income.<br /><span className="text-red-500">Zero effort.</span>
            </h1>
            <p className="text-base text-gray-600 leading-relaxed">
              Alive installs a free digital screen in your store. Brands pay to advertise on it.
              You earn <span className="text-gray-900 font-semibold">₹{monthlyLabel} + electricity every month</span> — without lifting a finger.
            </p>
            {premium && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1">
                <Star className="h-3 w-3 text-amber-500" />
                <span className="text-[11px] font-bold text-amber-700">Premium partner invite — ₹{monthlyLabel}/month</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {[
              { icon: IndianRupee, label: `₹${monthlyLabel} + electricity/month`, sub: 'Fixed. Paid every month via UPI.' },
              { icon: Zap,         label: 'Zero upfront cost',        sub: 'Screen installed free. We own it.' },
              { icon: Shield,      label: 'We manage everything',     sub: 'Content, tech, support — all on us.' },
              { icon: Clock,       label: 'Live in 48 hours',         sub: 'Our team visits and installs within 2 days.' },
              { icon: Star,        label: 'Exclusive per locality',   sub: 'Only 1–2 stores selected per area.' },
              { icon: Gift,        label: 'Referral rewards',         sub: 'Earn ₹500 for every new partner you refer.' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-start gap-3">
                <Icon className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                <div>
                  <p className="text-sm font-bold text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-200 pt-5 space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">How it works</p>
            {[
              { n: '01', t: 'Register below',     d: 'Takes 2 minutes.' },
              { n: '02', t: 'We visit & install', d: 'Free screen within 48 h.' },
              { n: '03', t: 'Earn every month',   d: `₹${monthlyLabel} + electricity to your account.` },
            ].map(({ n, t, d }) => (
              <div key={n} className="flex items-start gap-3">
                <span className="text-[11px] font-black text-red-400 mt-0.5 w-5 shrink-0">{n}</span>
                <div>
                  <p className="text-xs font-bold text-gray-900">{t}</p>
                  <p className="text-[11px] text-gray-500">{d}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {['₹0 installation', `₹${monthlyLabel} + electricity/month`, 'UPI payout', '24/7 support'].map((t) => (
              <span key={t} className="flex items-center gap-1 text-[11px] text-gray-500 font-medium">
                <Check className="h-3 w-3 text-red-500" /> {t}
              </span>
            ))}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-gray-400 shrink-0" />
              <p className="text-sm font-bold text-gray-900">Joining bonus — ₹500</p>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              We credit ₹500 to your account the day your screen goes live — no conditions, no waiting period.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-gray-400 shrink-0" />
              <p className="text-sm font-bold text-gray-900">Publish your own offers</p>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Post today’s deals directly from your dashboard. Your offers show on the ALIVE screen and deals page.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Deposit &amp; payout</p>
            {[
              { label: 'Security deposit', value: '₹0',            note: 'No deposit ever. Equipment is fully free.' },
              { label: 'Monthly payout',   value: `₹${monthlyLabel}+`,   note: 'Credited within 10 working days of month end.' },
              { label: 'Electricity',      value: 'Reimbursed',     note: 'At rated power × hours × tariff rate.' },
              { label: 'Exit clause',      value: '30-day notice',  note: 'Cancel anytime with 30 days notice.' },
            ].map(({ label, value, note }) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-800">{label}</p>
                  <p className="text-[11px] text-gray-500">{note}</p>
                </div>
                <span className="text-xs font-black text-red-500 shrink-0">{value}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right: form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }}
          className="rounded-3xl border border-gray-200 bg-white p-5 sm:p-7 shadow-sm"
        >
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500 mb-0.5">Join the network</p>
            <h2 className="text-xl font-black text-gray-900">Register your store</h2>
          </div>
          <RegistrationForm premium={premium} premiumMonthly={premiumMonthly} premiumKey={premiumKey} />
        </motion.div>
      </div>

      <footer className="border-t border-gray-200 py-5 text-center mt-4 bg-white">
        <p className="text-xs text-gray-400">
          © 2025 ALIVE Advertising Pvt. Ltd. · Mangaluru ·{' '}
          <a href={`https://wa.me/${SUPPORT_WHATSAPP.replace('+', '')}`} className="hover:text-gray-600 transition-colors">WhatsApp us</a>
        </p>
      </footer>
    </div>
  );
}
