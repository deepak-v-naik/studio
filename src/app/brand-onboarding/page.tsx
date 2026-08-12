'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addMonths } from 'date-fns';
import { useSession } from 'next-auth/react';
import { Logo } from '@/components/icons/logo';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ArrowRight, ArrowLeft, Check, CheckCircle2, Loader2, AlertCircle,
  TrendingUp, Eye, Monitor, Mail, FileVideo, FileImage, Clock, CalendarDays, EyeOff,
  Upload, X,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type OnboardingFormData = {
  brandName: string;
  contactName: string;
  email: string;
  phone: string;
  gstin: string;
  screens: number;
  months: number;
  startDate: string;
  agreementSigned: boolean;
};

type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id:   string;
  razorpay_signature:  string;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const SCREEN_TIERS = [
  { screens: 1,  pricePerScreen: 799,  playsPerDay: 144,  monthlyViews: 4320  },
  { screens: 3,  pricePerScreen: 699,  playsPerDay: 432,  monthlyViews: 12960, popular: true },
  { screens: 10, pricePerScreen: 599,  playsPerDay: 1440, monthlyViews: 43200 },
  { screens: 20, pricePerScreen: 549,  playsPerDay: 2880, monthlyViews: 86400 },
] as const;

const DURATION_OPTIONS = [
  { months: 1, label: '1 mo'  },
  { months: 2, label: '2 mo'  },
  { months: 3, label: '3 mo'  },
  { months: 6, label: '6 mo'  },
];

const STEPS = ['Details', 'Campaign', 'Agreement', 'Payment'];


// ─── Utilities ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function getScreenPrice(n: number): number {
  if (n >= 20) return 549;
  if (n >= 10) return 599;
  if (n >= 3)  return 699;
  return 799;
}

const BASE_PRICE       = 799;
const playsPerScreen   = 144;
const viewsPerScreenMo = 4320;

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof (window as Window & { Razorpay?: unknown }).Razorpay !== 'undefined') {
      resolve(); return;
    }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Razorpay failed to load'));
    document.head.appendChild(s);
  });
}

// ─── Animation variants ────────────────────────────────────────────────────────

const stepVariants = {
  enter:  (dir: number) => ({ opacity: 0,  y: dir >= 0 ? 28 : -18,  scale: 0.984 }),
  center: { opacity: 1,  y: 0,   scale: 1,    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
  exit:   (dir: number) => ({ opacity: 0,  y: dir >= 0 ? -18 : 28, scale: 0.984, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }),
};

const stagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
};

// ─── Floating Label Input ──────────────────────────────────────────────────────

function FloatingInput({
  id, label, type = 'text', value, onChange, autoComplete,
}: {
  id: string; label: string; type?: string;
  value: string; onChange: (v: string) => void; autoComplete?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete ?? 'off'}
        placeholder=" "
        className="peer w-full h-14 rounded-xl border border-border bg-card px-4 pb-1.5 pt-5 text-sm text-foreground transition-all duration-200 placeholder-transparent focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all duration-200
          peer-focus:-translate-y-[1.2rem] peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-widest peer-focus:text-primary
          peer-[:not(:placeholder-shown)]:-translate-y-[1.2rem] peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:text-muted-foreground"
      >
        {label}
      </label>
    </div>
  );
}

// ─── Date Picker ───────────────────────────────────────────────────────────────

const DATE_CHIPS = [
  { label: 'Next week',  days: 7  },
  { label: '2 weeks',    days: 14 },
  { label: '1 month',    days: 30 },
];

function addDays(d: number) {
  return format(new Date(Date.now() + d * 86400000), 'yyyy-MM-dd');
}

// Coarse buy-side availability per date. Deliberately no store/slot mechanics — the
// brand picks a date, not a screen or a loop position (see /api/brand/slot-availability).
type DateStatus = 'available' | 'limited' | 'sold_out' | 'closed';

const STATUS_LABEL: Record<DateStatus, string> = {
  available: 'Available', limited: 'Limited', sold_out: 'Sold out', closed: 'Closed',
};
const STATUS_STYLE: Record<DateStatus, string> = {
  available: 'text-green-700 bg-green-50 border-green-200',
  limited:   'text-amber-700 bg-amber-50 border-amber-200',
  sold_out:  'text-destructive bg-destructive/5 border-destructive/20',
  closed:    'text-muted-foreground bg-muted border-border',
};

function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + 'T00:00:00') : undefined;
  const [statuses, setStatuses] = useState<Record<string, DateStatus>>({});

  useEffect(() => {
    const from = format(new Date(), 'yyyy-MM-dd');
    const to   = format(new Date(Date.now() + 59 * 86400000), 'yyyy-MM-dd');
    fetch(`/api/brand/slot-availability?from=${from}&to=${to}`)
      .then((r) => r.ok ? r.json() as Promise<{ dates: { date: string; status: DateStatus }[] }> : null)
      .then((d) => {
        if (!d) return;
        setStatuses(Object.fromEntries(d.dates.map((x) => [x.date, x.status])));
      })
      .catch(() => { /* availability is advisory — never block the booking flow */ });
  }, []);

  const activeChip = DATE_CHIPS.find((c) => addDays(c.days) === value);
  const selectedStatus = value ? statuses[value] : undefined;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Campaign start
      </p>
      <div className="flex gap-2">
        {DATE_CHIPS.map((c) => (
          <button
            key={c.days}
            type="button"
            onClick={() => onChange(addDays(c.days))}
            className={`flex-1 rounded-lg border py-2.5 text-xs font-semibold transition-colors ${
              activeChip?.days === c.days
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {c.label}
          </button>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-semibold transition-colors ${
                !activeChip && value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {!activeChip && selected ? format(selected, 'd MMM') : 'Custom'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-border" align="end">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(date) => {
                if (date) { onChange(format(date, 'yyyy-MM-dd')); setOpen(false); }
              }}
              disabled={(date) =>
                date < new Date(new Date().setHours(0, 0, 0, 0)) ||
                ['sold_out', 'closed'].includes(statuses[format(date, 'yyyy-MM-dd')] ?? '')
              }
              modifiers={{
                limited: (date) => statuses[format(date, 'yyyy-MM-dd')] === 'limited',
              }}
              modifiersClassNames={{ limited: 'text-amber-700 font-bold' }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      {selected && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Goes live <span className="font-semibold text-foreground">{format(selected, 'EEEE, d MMMM yyyy')}</span>
          {selectedStatus && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[selectedStatus]}`}>
              {STATUS_LABEL[selectedStatus]}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Razorpay Logo ─────────────────────────────────────────────────────────────

function RazorpayMark() {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 1L2 5v8l7 4 7-4V5L9 1z" fill="#3395FF" />
        <path d="M8.2 5.4h3.1l-1.4 3h2.6L7.8 13.2l1.6-4H6.9l1.3-3.8z" fill="white" />
      </svg>
      <span className="text-xs font-black tracking-tight" style={{ color: '#3395FF' }}>
        razorpay
      </span>
    </span>
  );
}

// ─── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const n      = i + 1;
        const done   = current > n;
        const active = current === n;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <motion.div
                animate={done ? { scale: 1 } : active ? { scale: 1.1 } : { scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  done   ? 'bg-primary text-primary-foreground' :
                  active ? 'bg-primary text-primary-foreground ring-[3px] ring-primary/25' :
                           'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </motion.div>
              <span className={`hidden sm:block text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                active ? 'text-foreground' : 'text-muted-foreground/50'
              }`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <motion.div
                animate={{ backgroundColor: done ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
                transition={{ duration: 0.4 }}
                className="h-px mx-2 sm:mx-3 mb-5 w-8 sm:w-12"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-12 py-10">
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6 max-w-xl">
        <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
          Brand Onboarding
        </motion.p>
        <motion.h1 variants={fadeUp} className="text-[42px] sm:text-[56px] font-bold tracking-tight leading-[1.08] text-foreground">
          <span className="text-primary">Seen.</span> Remembered.<br />Bought.
        </motion.h1>
        <motion.p variants={fadeUp} className="text-base text-muted-foreground leading-relaxed">
          Alive places your ads on digital screens inside kirana stores across
          the city — reaching millions of daily shoppers at the exact moment
          they make purchase decisions.
        </motion.p>
      </motion.div>

      <motion.div
        variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-3 gap-3 w-full max-w-lg"
      >
        {[
          { n: '01', title: 'Configure',  sub: 'Screens & duration'  },
          { n: '02', title: 'Sign',        sub: 'Digital agreement'   },
          { n: '03', title: 'Launch',      sub: 'Pay & go live'       },
        ].map(({ n, title, sub }) => (
          <motion.div key={n} variants={fadeUp} className="rounded-xl border border-border bg-card p-5 text-left space-y-3">
            <span className="text-[10px] font-black tracking-[0.2em] text-primary/60 uppercase">{n}</span>
            <div>
              <p className="text-sm font-bold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-4"
      >
        <motion.button
          type="button"
          onClick={onNext}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2.5 rounded-xl bg-primary px-10 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Begin onboarding <ArrowRight className="h-4 w-4" />
        </motion.button>
        <p className="text-xs text-muted-foreground/40 tracking-wide">
          Takes less than 5 minutes · 2025 · Alive Media Pvt. Ltd.
        </p>
      </motion.div>
    </div>
  );
}

function StepDetails({
  data, onChange, onNext, onBack,
}: {
  data: OnboardingFormData;
  onChange: (k: keyof OnboardingFormData, v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const valid = data.brandName && data.contactName && data.email;

  const fields = [
    { id: 'brandName',   label: 'Brand / company name', type: 'text',  ac: 'organization' },
    { id: 'contactName', label: 'Your full name',        type: 'text',  ac: 'name'         },
    { id: 'email',       label: 'Work email',            type: 'email', ac: 'email'        },
    { id: 'phone',       label: 'Phone / WhatsApp',      type: 'tel',   ac: 'tel'          },
    { id: 'gstin',       label: 'GSTIN (optional)',      type: 'text',  ac: 'off'          },
  ];

  return (
    <div className="space-y-8">
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-1">
        <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-foreground">
          Brand details
        </motion.h2>
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground">
          Basic information to set up your advertiser account.
        </motion.p>
      </motion.div>

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ id, label, type, ac }) => (
          <motion.div key={id} variants={fadeUp} className={id === 'gstin' ? 'sm:col-span-2' : ''}>
            <FloatingInput
              id={id}
              label={label}
              type={type}
              value={(data as unknown as Record<string, string>)[id]}
              onChange={(v) => onChange(id as keyof OnboardingFormData, v)}
              autoComplete={ac}
            />
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.3 }}
        className="flex gap-3 pt-2"
      >
        <Button variant="outline" onClick={onBack} className="gap-1.5 h-11">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!valid} className="gap-1.5 h-11 px-7">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </div>
  );
}

function StepCampaign({
  data, onChange, onNext, onBack,
}: {
  data: OnboardingFormData;
  onChange: (k: keyof OnboardingFormData, v: number | string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const pricePerScreen = getScreenPrice(data.screens);
  const total          = pricePerScreen * data.screens * data.months;
  const valid          = data.screens > 0 && data.months > 0 && data.startDate;

  const adjustScreens = (delta: number) => {
    onChange('screens', Math.max(1, data.screens + delta));
  };

  return (
    <div className="space-y-8">
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-1">
        <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-foreground">
          Campaign setup
        </motion.h2>
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground">
          Choose your screen count, start date, and duration.
        </motion.p>
      </motion.div>

      {/* Screen tiers */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
        <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Screen plan
        </motion.p>
        <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3 sm:grid-cols-4 mt-5">
          {SCREEN_TIERS.map((t) => {
            const active   = data.screens === t.screens;
            const popular  = 'popular' in t && t.popular;
            return (
              <motion.button
                key={t.screens}
                type="button"
                onClick={() => onChange('screens', t.screens)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className={`relative rounded-xl border border-border bg-card text-left ${popular ? 'pt-8 pb-4 px-4' : 'p-4'}`}
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground whitespace-nowrap shadow-sm ring-2 ring-background">
                    Popular
                  </span>
                )}
                {active && (
                  <motion.div
                    layoutId="tier-ring"
                    className="absolute inset-0 rounded-xl border-2 border-primary bg-primary/5"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <div className="relative space-y-3">
                  <div>
                    <p className="text-2xl font-black text-foreground leading-none">{t.screens}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.screens === 1 ? 'screen' : 'screens'}</p>
                  </div>
                  <div className="border-t border-border pt-3 space-y-1">
                    {t.pricePerScreen < BASE_PRICE ? (
                      <p className="text-[10px] text-muted-foreground/50 line-through leading-none">{fmt(BASE_PRICE)}/screen</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground/50 leading-none invisible">–</p>
                    )}
                    <p className="text-base font-black text-foreground leading-none">{fmt(t.pricePerScreen)}</p>
                    <p className="text-[10px] text-muted-foreground leading-none">per screen / month</p>
                    {t.pricePerScreen < BASE_PRICE && (
                      <p className="text-[11px] font-bold text-green-700 leading-none">
                        Save ₹{BASE_PRICE - t.pricePerScreen}/screen/mo
                      </p>
                    )}
                  </div>
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TrendingUp className="h-3 w-3 shrink-0" />
                      ~{(playsPerScreen * t.screens).toLocaleString('en-IN')}/day
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="h-3 w-3 shrink-0" />
                      {(viewsPerScreenMo * t.screens).toLocaleString('en-IN')}/mo
                    </div>
                  </div>
                </div>
                {active && (
                  <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                )}
              </motion.button>
            );
          })}
        </motion.div>

        {/* Custom stepper */}
        <motion.div
          variants={fadeUp}
          className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3.5"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Custom count</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmt(pricePerScreen)} per screen · {fmt(pricePerScreen * data.screens)}/month
            </p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              type="button"
              onClick={() => adjustScreens(-1)}
              disabled={data.screens <= 1}
              whileTap={{ scale: 0.9 }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-lg font-bold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:opacity-30"
            >
              −
            </motion.button>
            <input
              type="number"
              min={1}
              value={data.screens}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1) onChange('screens', v);
              }}
              className="h-9 w-16 rounded-lg border border-border bg-background text-center text-base font-black text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
            <motion.button
              type="button"
              onClick={() => adjustScreens(1)}
              whileTap={{ scale: 0.9 }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-lg font-bold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              +
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* Duration */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-3">
        <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Duration</motion.p>
        <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DURATION_OPTIONS.map(({ months, label }) => (
            <motion.button
              key={months}
              type="button"
              onClick={() => onChange('months', months)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className={`relative rounded-lg border py-2.5 text-sm font-semibold overflow-hidden transition-colors ${
                data.months === months
                  ? 'border-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {data.months === months && (
                <motion.div
                  layoutId="duration-fill"
                  className="absolute inset-0 bg-primary"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative">{label}</span>
            </motion.button>
          ))}
        </motion.div>
      </motion.div>

      {/* Start date */}
      <motion.div variants={fadeUp}>
        <DatePicker value={data.startDate} onChange={(v) => onChange('startDate', v)} />
      </motion.div>

      {/* Live total */}
      <AnimatePresence>
        {data.screens > 0 && data.months > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Campaign total</p>
                <p className="text-sm text-muted-foreground">
                  {fmt(pricePerScreen)} × {data.screens} {data.screens === 1 ? 'screen' : 'screens'} × {data.months} {data.months === 1 ? 'month' : 'months'}
                </p>
                {pricePerScreen < BASE_PRICE && (
                  <p className="text-xs text-green-600 font-semibold">
                    Saving {fmt((BASE_PRICE - pricePerScreen) * data.screens * data.months)} vs list price
                  </p>
                )}
              </div>
              <div className="text-right">
                <motion.p
                  key={total}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1,    opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="text-3xl font-black text-foreground tracking-tight"
                >
                  {fmt(total)}
                </motion.p>
                <p className="text-xs text-muted-foreground mt-0.5">GST invoice on payment</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4 text-center">
              {[
                { Icon: Monitor,    label: 'Screens',     value: data.screens.toString() },
                { Icon: TrendingUp, label: 'Daily plays', value: `~${(playsPerScreen * data.screens).toLocaleString('en-IN')}` },
                { Icon: Eye,        label: 'Total views', value: `~${(viewsPerScreenMo * data.screens * data.months).toLocaleString('en-IN')}` },
              ].map(({ Icon, label, value }) => (
                <div key={label}>
                  <Icon className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                  <p className="text-sm font-bold text-foreground">{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.3 }}
        className="flex gap-3 pt-2"
      >
        <Button variant="outline" onClick={onBack} className="gap-1.5 h-11">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!valid} className="gap-1.5 h-11 px-7">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </div>
  );
}

function StepAgreement({
  data, onChange, onNext, onBack,
}: {
  data: OnboardingFormData;
  onChange: (k: keyof OnboardingFormData, v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const pricePerScreen = getScreenPrice(data.screens);
  const monthlyFee     = fmt(pricePerScreen * data.screens);
  const effectiveDate  = format(new Date(), 'd MMMM yyyy');

  const clauses = [
    {
      n: '1', title: 'What we provide',
      items: [
        'We display your advertisements on digital screens installed inside kirana stores and retail outlets across your selected locations.',
        'You get a dedicated Account Manager who handles scheduling, creative formatting, and campaign reporting.',
        'We provide screen uptime reports and campaign performance summaries.',
      ],
    },
    {
      n: '2', title: 'Your campaign',
      items: [
        `This campaign runs for ${data.months} ${data.months === 1 ? 'month' : 'months'} across ${data.screens} ${data.screens === 1 ? 'screen' : 'screens'}.`,
        `The monthly fee is ${monthlyFee} plus applicable GST.`,
        'Campaign dates are confirmed after payment and creative submission.',
      ],
    },
    {
      n: '3', title: 'Payment',
      items: [
        'Payment is collected upfront via Razorpay before your campaign is activated.',
        'A GST invoice will be sent to your registered email within 2 business days of payment.',
        'Fees for completed campaign months are non-refundable. If we cancel your campaign for reasons within our control, we will issue a prorated refund.',
        'Late or disputed payments attract interest of 2% per month.',
      ],
    },
    {
      n: '4', title: 'Your content',
      items: [
        'You are solely responsible for ensuring your ad content is accurate, lawful, and complies with applicable advertising regulations.',
        'We may reject or remove content that violates any law, is misleading, or conflicts with our content policies — without liability to you.',
        'Send your ad creative and logo to your Account Manager after payment. Specifications: MP4 or JPEG/PNG, 1920 × 1080 px, max 100 MB.',
      ],
    },
    {
      n: '5', title: 'Intellectual property',
      items: [
        'You retain full ownership of your ad content and brand assets.',
        'You grant us a non-exclusive licence to display your content on our screens for the campaign duration.',
        'We retain ownership of our platform, scheduling software, and reporting tools.',
      ],
    },
    {
      n: '6', title: 'Limitation of liability',
      items: [
        'Our total liability to you for any claim arising from these Terms is limited to the fees you paid for the affected campaign period.',
        'We are not liable for indirect, incidental, or consequential losses, including lost revenue or reputational damage.',
        'We are not liable for screen downtime caused by third-party store closures, power outages, or force majeure events. We will notify you and extend your campaign where reasonably possible.',
      ],
    },
    {
      n: '7', title: 'Ending this agreement',
      items: [
        'Either party may end this agreement with 30 days written notice.',
        'We may suspend or terminate immediately if you breach a material term, including non-payment or submission of unlawful content.',
        'On termination, outstanding fees become immediately due.',
      ],
    },
    {
      n: '8', title: 'Privacy',
      items: [
        'We collect your business details (name, email, phone, GSTIN) to manage your campaign and issue invoices.',
        'We do not sell your information to third parties.',
        'Payment processing is handled by Razorpay, subject to their privacy policy.',
      ],
    },
    {
      n: '9', title: 'Governing law',
      items: [
        'These Terms are governed by the laws of India.',
        'Any disputes will first be addressed through good-faith discussions. If unresolved within 30 days, disputes will be referred to arbitration in Mangaluru, Karnataka, under the Arbitration and Conciliation Act, 1996.',
        'Courts in Mangaluru, Karnataka have exclusive jurisdiction for any proceedings.',
      ],
    },
    {
      n: '10', title: 'Changes to these terms',
      items: [
        'We may update these Terms from time to time. We will notify you of material changes by email.',
        'Continued use of our services after changes take effect means you accept the revised Terms.',
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Terms of Service</h2>
        <p className="text-sm text-muted-foreground">Read the terms below and accept to continue.</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-card px-5 py-4">
          <p className="text-sm font-bold text-foreground">Alive Advertising — Terms of Service</p>
          <p className="text-xs text-muted-foreground mt-0.5">Effective date: {effectiveDate}</p>
        </div>

        {/* No nested scroll — content flows naturally so mobile page scroll works */}
        <div className="px-5 py-5 space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>
            These Terms of Service govern your use of ALIVE&apos;s digital out-of-home advertising platform (the &quot;Platform&quot;). By accepting, <strong className="text-foreground">{data.brandName || 'your organisation'}</strong> enters into a legally binding Campaign Agreement with VS Collective LLP, operating as ALIVE (&quot;ALIVE&quot;).
          </p>

          {/* Parties to the Agreement */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Parties to the Agreement</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Party A — Service Provider</p>
                <p className="font-semibold text-foreground">VS Collective LLP</p>
                <p className="text-muted-foreground">LLP IN-KA43598411418020V</p>
                <p className="text-muted-foreground">#13, First Floor, Highland Manor</p>
                <p className="text-muted-foreground">Falnir, Mangaluru 575002, Karnataka</p>
                <p className="text-muted-foreground">GSTIN: 29AAXFV2589C1ZE</p>
                <p className="text-muted-foreground">hello@wearealive.in · +91 74113 24448</p>
                <p className="text-muted-foreground">Operating as: ALIVE advertising platform</p>
              </div>
              <div className="space-y-1 sm:border-l sm:border-border sm:pl-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Party B — Advertiser</p>
                <p className="font-semibold text-foreground">{data.brandName || '—'}</p>
                {data.contactName && <p className="text-muted-foreground">Contact: {data.contactName}</p>}
                {data.email       && <p className="text-muted-foreground">{data.email}</p>}
                {data.phone       && <p className="text-muted-foreground">+91 {data.phone}</p>}
                {data.gstin       && <p className="text-muted-foreground">GSTIN: {data.gstin}</p>}
              </div>
            </div>
          </div>

          {clauses.map(({ n, title, items }) => (
            <div key={n} className="space-y-2">
              <p className="font-semibold text-foreground text-[13px]">
                <span className="text-primary mr-1">{n}.</span>{title}
              </p>
              <ul className="space-y-1.5 pl-3">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Digital Acceptance block */}
          <div className="pt-4 border-t border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Digital Acceptance</p>
            <p className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
              This agreement is executed electronically under the Information Technology Act, 2000.
              Electronic acceptance via the ALIVE platform constitutes valid execution without physical signatures.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Party A — Service Provider</p>
                <p className="font-semibold text-foreground">VS Collective LLP</p>
                <p className="text-muted-foreground">#13, First Floor, Highland Manor, Falnir, Mangaluru 575002</p>
                <p className="text-muted-foreground">GSTIN: 29AAXFV2589C1ZE</p>
                <p className="text-muted-foreground">Authorised by: ALIVE Platform (automated)</p>
                <p className="text-muted-foreground">Date: {effectiveDate}</p>
              </div>
              <div className="space-y-1 sm:border-l sm:border-border sm:pl-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Party B — Advertiser</p>
                <p className="font-semibold text-foreground">{data.brandName || '—'}</p>
                {data.contactName && <p className="text-muted-foreground">Contact: {data.contactName}</p>}
                {data.email      && <p className="text-muted-foreground">{data.email}</p>}
                {data.phone      && <p className="text-muted-foreground">+91 {data.phone}</p>}
                {data.gstin      && <p className="text-muted-foreground">GSTIN: {data.gstin}</p>}
                <p className="text-muted-foreground">Campaign: {data.screens} screen{data.screens !== 1 ? 's' : ''} · {data.months} month{data.months !== 1 ? 's' : ''} · {monthlyFee}/mo</p>
                <p className="text-muted-foreground">Date of acceptance: {effectiveDate}</p>
              </div>
            </div>
          </div>
          </div>
      </div>

      {/* Accept bar */}
      <div className="pt-2 space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <Checkbox
            id="agree"
            checked={data.agreementSigned}
            onCheckedChange={(v) => onChange('agreementSigned', !!v)}
            className="mt-0.5 shrink-0"
          />
          <label htmlFor="agree" className="text-sm text-muted-foreground leading-relaxed cursor-pointer select-none">
            I have read and agree to the Alive Advertising Terms of Service. I confirm I am
            authorised to enter into this agreement on behalf of{' '}
            <strong className="text-foreground">{data.brandName || 'my organisation'}</strong>.
          </label>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="gap-1.5 h-11">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button onClick={onNext} disabled={!data.agreementSigned} className="flex-1 gap-1.5 h-11">
            Accept &amp; continue <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepPayment({
  data, onSuccess, onConfirm, onBack, isTrial,
}: {
  data: OnboardingFormData;
  onSuccess: (paymentId: string, orderId: string) => void;
  onConfirm: (effectivePricePerScreen: number) => void;
  onBack: () => void;
  isTrial?: boolean;
}) {
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [showPromo, setShowPromo] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; type: 'FLAT' | 'PERCENT'; value: number } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const pricePerScreen = getScreenPrice(data.screens);
  const baseSubtotal   = pricePerScreen * data.screens * data.months;
  // Discount derived live from the coupon rule so it stays correct if the buyer
  // changes screens/months after applying (esp. PERCENT coupons).
  const promoCode      = appliedCoupon?.code ?? '';
  const promoDiscount  = !appliedCoupon ? 0 : appliedCoupon.type === 'PERCENT'
    ? Math.min(baseSubtotal, Math.round((baseSubtotal * appliedCoupon.value) / 100))
    : Math.min(baseSubtotal, appliedCoupon.value);
  const subtotal       = Math.max(0, baseSubtotal - promoDiscount);
  const gstAmount      = Math.round(subtotal * 0.18);
  const total          = isTrial ? 0 : subtotal + gstAmount;

  // Validate the code server-side against the admin-managed coupon list.
  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotal: baseSubtotal }),
      });
      const body = await res.json() as { valid: boolean; code?: string; type?: 'FLAT' | 'PERCENT'; value?: number; error?: string };
      if (body.valid && body.type && body.value) {
        setAppliedCoupon({ code: body.code ?? code, type: body.type, value: body.value });
        setShowPromo(false);
      } else {
        setAppliedCoupon(null);
        setError(body.error ?? 'Invalid promo code');
      }
    } catch {
      setError('Could not validate code. Please try again.');
    } finally {
      setPromoBusy(false);
    }
  };

  const startDate = data.startDate ? new Date(data.startDate + 'T00:00:00') : null;
  const endDate   = startDate ? addMonths(startDate, data.months) : null;

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      await loadRazorpayScript();
      const res  = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Server recomputes the charge from these — `total` is display-only.
          screens:    data.screens,
          months:     data.months,
          couponCode: promoCode || undefined,
          applyGst:   true,
          receipt:    `alive_${Date.now()}`,
          notes:      { brand: data.brandName, email: data.email, screens: data.screens, months: data.months },
        }),
      });
      const body = await res.json() as { id?: string; amount?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not create payment order');

      type RzpI = { open: () => void; on: (e: string, cb: (r: { error: { description: string } }) => void) => void };
      type RzpC = new (o: Record<string, unknown>) => RzpI;

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: body.amount, currency: 'INR', name: 'Alive Media',
        description: `${data.screens} screen${data.screens > 1 ? 's' : ''} · ${data.months} month${data.months > 1 ? 's' : ''}`,
        order_id: body.id,
        handler: async (response: RazorpayResponse) => {
          const verify = await fetch('/api/razorpay/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...response,
              campaign: {
                brandName:      data.brandName,
                contactName:    data.contactName,
                email:          data.email,
                phone:          data.phone,
                gstin:          data.gstin,
                screens:        data.screens,
                months:         data.months,
                startDate:      data.startDate,
                pricePerScreen,
                totalAmount:    total, // actual charged amount, incl. any promo discount + GST
                couponCode:     promoCode || undefined,
              },
            }),
          });
          const result = await verify.json() as { success: boolean };
          if (result.success) { onSuccess(response.razorpay_payment_id, response.razorpay_order_id); }
          else { setError('Payment verification failed. Please contact hello@wearealive.in.'); setLoading(false); }
        },
        prefill: { name: data.contactName, email: data.email, contact: data.phone },
        theme: { color: '#dc2626' },
        modal: { ondismiss: () => setLoading(false) },
      };
      const rzp = new ((window as unknown as { Razorpay: RzpC }).Razorpay)(options as Record<string, unknown>);
      rzp.on('payment.failed', (r) => { setError(r.error.description ?? 'Payment failed.'); setLoading(false); });
      rzp.open();
    } catch (e) {
      setError((e as Error).message ?? 'Something went wrong.'); setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-1">
        <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-foreground">Payment</motion.h2>
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground">Review your order and pay securely.</motion.p>
      </motion.div>

      {/* Order summary */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order summary</p>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          {/* Brand */}
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <span className="text-muted-foreground">Brand</span>
            <span className="font-semibold text-foreground">{data.brandName}</span>
          </motion.div>
          {/* Screens */}
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <span className="text-muted-foreground">Screens</span>
            <span className="font-semibold text-foreground">{data.screens} screen{data.screens > 1 ? 's' : ''}</span>
          </motion.div>
          {/* Duration */}
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-semibold text-foreground">{data.months} month{data.months > 1 ? 's' : ''}</span>
          </motion.div>
          {/* Price per screen */}
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <span className="text-muted-foreground">Price / screen / month</span>
            <span className="flex items-center gap-2 font-semibold text-foreground">
              {pricePerScreen < BASE_PRICE && (
                <span className="text-xs text-muted-foreground/50 line-through">{fmt(BASE_PRICE)}</span>
              )}
              {fmt(pricePerScreen)}
              <span className="text-[10px] text-muted-foreground font-normal">excl. GST</span>
            </span>
          </motion.div>
          {pricePerScreen < BASE_PRICE && (
            <motion.div variants={fadeUp} className="flex items-center justify-between text-green-700 text-xs font-semibold">
              <span>Volume discount</span>
              <span>−₹{BASE_PRICE - pricePerScreen}/screen/mo</span>
            </motion.div>
          )}

          {/* Dates — highlighted */}
          {startDate && (
            <>
              <motion.div variants={fadeUp} className="flex items-center justify-between">
                <span className="text-muted-foreground">Start date</span>
                <span className="font-semibold text-primary bg-primary/10 rounded-md px-2 py-0.5">
                  {format(startDate, 'd MMMM yyyy')}
                </span>
              </motion.div>
              {endDate && (
                <motion.div variants={fadeUp} className="flex items-center justify-between">
                  <span className="text-muted-foreground">Valid till</span>
                  <span className="font-semibold text-primary bg-primary/10 rounded-md px-2 py-0.5">
                    {format(endDate, 'd MMMM yyyy')}
                  </span>
                </motion.div>
              )}
            </>
          )}

          {/* Subtotal + GST */}
          <div className="pt-2 border-t border-border space-y-2">
            <motion.div variants={fadeUp} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold text-foreground">{fmt(baseSubtotal)}</span>
            </motion.div>
            {promoDiscount > 0 && (
              <motion.div variants={fadeUp} className="flex items-center justify-between text-sm text-green-700">
                <span className="font-semibold">Promo ({promoCode})</span>
                <span className="font-semibold">−{fmt(promoDiscount)}</span>
              </motion.div>
            )}
            {isTrial && (
              <motion.div variants={fadeUp} className="flex items-center justify-between text-sm text-green-700">
                <span className="font-semibold">Free trial discount</span>
                <span className="font-semibold">−{fmt(baseSubtotal)}</span>
              </motion.div>
            )}
            <motion.div variants={fadeUp} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">GST (18%)</span>
              <span className="font-semibold text-foreground">{isTrial ? '₹0' : `+${fmt(gstAmount)}`}</span>
            </motion.div>
          </div>

          {/* Promo code */}
          {!isTrial && (
            <div className="pt-1">
              {!showPromo ? (
                <button type="button" onClick={() => setShowPromo(true)} className="text-xs text-primary/70 hover:text-primary underline-offset-2 hover:underline transition-colors">
                  Have a promo code?
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    placeholder="GETALIVENOW"
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                  />
                  <button type="button" onClick={applyPromo} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors">
                    Apply
                  </button>
                  <button type="button" onClick={() => setShowPromo(false)} className="rounded-lg border border-border px-2 py-2 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Total */}
        <motion.div variants={fadeUp} className={`px-5 py-4 border-t border-border flex items-center justify-between ${isTrial ? 'bg-green-50' : 'bg-muted/20'}`}>
          <span className="text-sm font-bold text-foreground uppercase tracking-wide">{isTrial ? 'Trial — ₹0 today' : 'Total (incl. GST)'}</span>
          <motion.span
            key={total}
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1,    opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={`text-2xl font-black ${isTrial ? 'text-green-700' : 'text-foreground'}`}
          >
            {isTrial ? '₹0' : fmt(total)}
          </motion.span>
        </motion.div>
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive overflow-hidden"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* CTA buttons */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.38, ease: [0.22, 1, 0.36, 1] }} className="space-y-3">

        {isTrial ? (
          /* TRIAL MODE — skip payment */
          <button
            type="button"
            onClick={() => onConfirm(0)}
            disabled={loading}
            className="relative w-full overflow-hidden rounded-xl bg-green-700 px-6 py-4 font-bold text-white transition-all hover:bg-green-800 disabled:opacity-60 active:scale-[0.99]"
          >
            <span className="relative flex items-center justify-center gap-2 text-sm">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Claim Free Trial — ₹0 today
            </span>
          </button>
        ) : (
          <>
            {/* PRIMARY — pay now via Razorpay */}
            <button
              type="button"
              onClick={handlePay}
              disabled={loading}
              className="relative w-full overflow-hidden rounded-xl bg-primary px-6 py-4 font-bold text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.99]"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              <span className="relative flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening Razorpay…</>
                    : <><ArrowRight className="h-4 w-4" /> Pay {fmt(total)} now</>}
                </span>
                {!loading && (
                  <span className="flex items-center gap-2 border-l border-primary-foreground/20 pl-3">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary-foreground/60">powered by</span>
                    <RazorpayMark />
                  </span>
                )}
              </span>
            </button>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
              <div className="flex-1 h-px bg-border" />
              <span>or confirm and pay later</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* SECONDARY — confirm booking, pay later */}
            <button
              type="button"
              onClick={() => onConfirm(pricePerScreen)}
              className="relative w-full overflow-hidden rounded-xl border border-border bg-card px-6 py-3.5 font-bold text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground active:scale-[0.99]"
            >
              <span className="relative flex items-center justify-center gap-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Confirm Booking — Pay later
              </span>
            </button>
          </>
        )}

        {!isTrial && (
          <p className="text-center text-[11px] text-muted-foreground/50 leading-relaxed">
            Payment is due 24 hours before your campaign goes live.
          </p>
        )}

        <p className="text-center text-[11px] text-muted-foreground/60 leading-relaxed">
          By confirming, you agree to our{' '}
          <a href="/terms" target="_blank" className="underline hover:text-foreground transition-colors">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" target="_blank" className="underline hover:text-foreground transition-colors">Privacy Policy</a>.
        </p>
      </motion.div>

      <Button variant="ghost" onClick={onBack} className="gap-1.5 w-full">
        <ArrowLeft className="h-4 w-4" /> Back to agreement
      </Button>
    </div>
  );
}

// ── Inline creative uploader on the confirmation page ─────────────────────
function CreativeUploadBox({ paid, paymentId, brandName }: { paid: boolean; paymentId: string; brandName: string }) {
  const [uploads,  setUploads]  = useState<string[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!paid) { setError('Complete payment first to upload creatives.'); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/brand/upload?paymentId=${encodeURIComponent(paymentId)}`, { method: 'POST', body: fd });
      const d   = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Upload failed');
      if (d.url)  setUploads((u) => [...u, d.url!]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  if (!paid) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-left space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary shrink-0" />
          <p className="font-bold text-foreground">Send us your creatives after payment</p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Complete your payment to unlock creative upload. You can also email files to your Account Manager.
        </p>
        <a href={`mailto:hello@wearealive.in?subject=Campaign%20creatives%20—%20${encodeURIComponent(brandName)}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold text-foreground hover:bg-muted transition-colors">
          <Mail className="h-3.5 w-3.5" /> Email AM
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-left space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-primary shrink-0" />
        <p className="font-bold text-foreground">Upload your ad creative</p>
      </div>
      <p className="text-xs text-muted-foreground">
        MP4 or JPEG/PNG · 1920 × 1080 · Max 4 MB per file. Add as many files as you need (creative + logo).
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'} p-6 text-center`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2"><Loader2 className="h-5 w-5 animate-spin text-primary" /><p className="text-xs text-muted-foreground">Uploading…</p></div>
        ) : (
          <label className="flex flex-col items-center gap-2 cursor-pointer">
            <Upload className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">Drop a file or click to pick</p>
            <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          </label>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Uploaded ({uploads.length})</p>
          {uploads.map((u, i) => (
            <div key={u} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              <span className="text-[11px] font-mono text-muted-foreground truncate flex-1">File {i + 1} · {u.split('/').pop()?.slice(0, 30)}</span>
              <button onClick={() => setUploads((u2) => u2.filter((x) => x !== u))} className="text-muted-foreground/50 hover:text-muted-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
        Files are attached to your campaign and visible to the ALIVE team. Your Account Manager will confirm specs and scheduling within 24 hours.
      </p>
    </div>
  );
}

function StepDone({ data, paymentId }: { data: OnboardingFormData; paymentId: string }) {
  const paid    = !!paymentId;
  const subtotal = getScreenPrice(data.screens) * data.screens * data.months;
  const total    = subtotal + Math.round(subtotal * 0.18);

  useEffect(() => {
    const t = setTimeout(() => { window.location.href = '/dashboard'; }, 5000);
    return () => clearTimeout(t);
  }, []);

  const checklist = [
    { label: paid ? 'Payment confirmed' : 'Booking confirmed', value: paid ? paymentId.slice(0, 16) + '…' : 'Pending payment', done: paid },
    { label: 'Screens booked',   value: `${data.screens} screen${data.screens > 1 ? 's' : ''}`, done: true  },
    { label: 'Duration',         value: `${data.months} month${data.months > 1 ? 's' : ''}`,    done: true  },
    { label: paid ? 'Payment' : 'Payment due', value: paid ? 'Paid' : '24 hrs before go-live · via dashboard', done: paid },
    { label: 'Creatives',        value: 'Email to your AM',                                      done: false },
    { label: 'Campaign goes live', value: data.startDate ? format(new Date(data.startDate + 'T00:00:00'), 'd MMM') : 'Per schedule', done: false },
  ];

  return (
    <motion.div
      variants={stagger} initial="hidden" animate="show"
      className="flex flex-col items-center text-center gap-10 py-8"
    >
      <motion.div
        variants={fadeUp}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 ring-8 ring-green-500/5"
      >
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 20 }}
        >
          <CheckCircle2 className="h-10 w-10 text-green-500" />
        </motion.div>
      </motion.div>

      <motion.div variants={fadeUp} className="space-y-3">
        <h2 className="text-3xl font-black tracking-tight text-foreground">
          {paid ? 'Campaign confirmed.' : 'Booking confirmed.'}
        </h2>
        <p className="max-w-md mx-auto text-muted-foreground leading-relaxed">
          Welcome to Alive, <strong className="text-foreground">{data.brandName}</strong>.{' '}
          {paid
            ? <>Your payment of <strong className="text-foreground">{fmt(total)}</strong> is confirmed. A GST invoice will be sent to <strong className="text-foreground">{data.email}</strong> within 2 business days.</>
            : <>Your campaign is booked. Complete payment through your dashboard at least <strong className="text-foreground">24 hours before your campaign goes live</strong> on <strong className="text-foreground">{data.startDate ? format(new Date(data.startDate + 'T00:00:00'), 'd MMMM yyyy') : 'your selected date'}</strong>.</>
          }
        </p>
      </motion.div>

      <motion.div variants={fadeUp} className="w-full max-w-md">
        <CreativeUploadBox paid={paid} paymentId={paymentId} brandName={data.brandName} />
      </motion.div>

      <motion.div variants={stagger} className="w-full max-w-md space-y-2 text-left">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Booking summary</p>
        {checklist.map(({ label, value, done }, i) => (
          <motion.div
            key={label}
            variants={fadeUp}
            custom={i}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? 'bg-green-500/15' : 'bg-muted'}`}>
                {done
                  ? <Check className="h-3 w-3 text-green-500" />
                  : <Clock className="h-3 w-3 text-muted-foreground/50" />}
              </div>
              <span className="text-muted-foreground">{label}</span>
            </div>
            <span className="font-semibold text-foreground font-mono text-xs truncate max-w-[140px]">{value}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* Dashboard redirect */}
      <motion.div variants={fadeUp} className="w-full max-w-md rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-3 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Taking you to your dashboard…</p>
        <p className="text-sm text-muted-foreground">You&apos;ll be redirected in a moment to track your campaign live.</p>
        <a
          href="/dashboard"
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Go to dashboard now →
        </a>
      </motion.div>

      <motion.a
        variants={fadeUp}
        href="/"
        className="text-xs text-muted-foreground/40 hover:text-muted-foreground underline underline-offset-2 transition-colors"
      >
        Return to wearealive.in
      </motion.a>
    </motion.div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

const INITIAL: OnboardingFormData = {
  brandName: '', contactName: '', email: '', phone: '', gstin: '',
  screens: 3, months: 1, startDate: format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd'), agreementSigned: false,
};

const PENDING_KEY = 'alive_pending_campaign';

function BrandOnboardingInner() {
  const searchParams = useSearchParams();
  const isTrial      = searchParams.get('trial') === '1';

  const [step,      setStep]      = useState(1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [form,      setForm]      = useState<OnboardingFormData>(INITIAL);
  const [paymentId, setPaymentId] = useState('');
  const [orderId,   setOrderId]   = useState('');
  const { data: session, status } = useSession();
  const isLoaded    = status !== 'loading';
  const isSignedIn  = status === 'authenticated';

  // Restore a pending campaign if the user left during payment and came back signed in
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const saved = localStorage.getItem(PENDING_KEY);
      if (saved) {
        const { form: savedForm } = JSON.parse(saved) as { form: OnboardingFormData };
        localStorage.removeItem(PENDING_KEY);
        setForm(savedForm);
        setStep(5); // drop straight back to payment
      }
    } catch { /* ignore */ }
  }, [isLoaded, isSignedIn]);

  const update = (key: keyof OnboardingFormData, value: OnboardingFormData[keyof OnboardingFormData]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const next = () => { setDirection(1);  setStep((s) => Math.min(s + 1, STEPS.length + 2)); };
  const back = () => { setDirection(-1); setStep((s) => Math.max(s - 1, 1)); };

  // Save campaign data when the user reaches the payment step
  useEffect(() => {
    if (step === 5) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ form })); } catch { /* ignore */ }
    }
  }, [step, form]);

  const showIndicator = step >= 2 && step <= 5;

  const saveCampaign = (pid: string, oid: string, effectivePricePerScreen: number, status: 'upcoming' | 'pending_payment') => {
    const subtotal    = effectivePricePerScreen * form.screens * form.months;
    const totalAmount = subtotal + Math.round(subtotal * 0.18);
    fetch('/api/campaigns/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName:      form.brandName,
        contactName:    form.contactName,
        email:          form.email,
        phone:          form.phone,
        gstin:          form.gstin,
        screens:        form.screens,
        months:         form.months,
        startDate:      form.startDate,
        pricePerScreen: effectivePricePerScreen,
        totalAmount,
        paymentId:      pid,
        orderId:        oid,
        status,
      }),
    }).catch(() => {});
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  };

  const handleConfirmBooking = (effectivePricePerScreen: number) => {
    saveCampaign('', '', effectivePricePerScreen, 'pending_payment');
    setPaymentId('');
    next();
  };

  const handlePaymentSuccess = async (pid: string, oid: string) => {
    setPaymentId(pid);
    setOrderId(oid);
    // Campaign already saved as 'active' by verify-payment — no duplicate save needed
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    next();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/30 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="opacity-70 hover:opacity-100 transition-opacity">
            <Logo />
          </a>
          {showIndicator && <StepIndicator current={step - 1} />}
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/40">
            Confidential
          </span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 sm:px-6 py-10 sm:py-16">
        {!isLoaded && (
          <div className="space-y-6 animate-pulse">
            <div className="h-8 w-48 rounded-xl bg-muted" />
            <div className="h-4 w-64 rounded-lg bg-muted" />
            <div className="space-y-3 pt-4">
              <div className="h-14 rounded-xl bg-muted" />
              <div className="h-14 rounded-xl bg-muted" />
              <div className="h-14 rounded-xl bg-muted" />
            </div>
            <div className="h-11 rounded-xl bg-muted" />
          </div>
        )}
        {isLoaded && (
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {step === 1 && <StepWelcome onNext={next} />}
              {step === 2 && (
                <StepDetails data={form} onChange={(k, v) => update(k, v as string)} onNext={next} onBack={back} />
              )}
              {step === 3 && (
                <StepCampaign data={form} onChange={(k, v) => update(k, v as number | string)} onNext={next} onBack={back} />
              )}
              {step === 4 && (
                <StepAgreement data={form} onChange={(k, v) => update(k, v as boolean)} onNext={next} onBack={back} />
              )}
              {step === 5 && (
                <StepPayment data={form} onSuccess={handlePaymentSuccess} onConfirm={handleConfirmBooking} onBack={back} isTrial={isTrial} />
              )}
              {step === 6 && <StepDone data={form} paymentId={paymentId} />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      <footer className="border-t border-border/30 py-5 text-center">
        <p className="text-xs text-muted-foreground/40 tracking-wide">
          © 2025 Alive Advertising Solutions Pvt. Ltd. ·{' '}
          <a href="mailto:hello@wearealive.in" className="hover:text-muted-foreground transition-colors">
            hello@wearealive.in
          </a>
        </p>
      </footer>
    </div>
  );
}

export default function BrandOnboardingPage() {
  return (
    <Suspense>
      <BrandOnboardingInner />
    </Suspense>
  );
}
