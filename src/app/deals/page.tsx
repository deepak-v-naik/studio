'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Logo } from '@/components/icons/logo';
import type { Flyer } from '@/app/api/flyers/save/route';

// ─── Animation variants ────────────────────────────────────────────────────────

const stagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day:   '2-digit',
      month: 'short',
      year:  'numeric',
    });
  } catch {
    return iso;
  }
}

function resolveImage(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}


function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Flyer" className="max-h-[90vh] max-w-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">✕</button>
    </div>
  );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
      <div className="aspect-video bg-muted" />
      <div className="p-4 space-y-3">
        <div className="h-3 w-20 rounded-full bg-muted" />
        <div className="h-4 w-3/4 rounded-full bg-muted" />
        <div className="h-3 w-full rounded-full bg-muted" />
        <div className="h-3 w-2/3 rounded-full bg-muted" />
        <div className="h-3 w-24 rounded-full bg-muted mt-2" />
      </div>
    </div>
  );
}

// ─── Flyer card ───────────────────────────────────────────────────────────────

function FlyerCard({ flyer, onOpen }: { flyer: Flyer; onOpen: (src: string) => void }) {
  const imgSrc = resolveImage(flyer.imageBase64);

  return (
    <motion.div
      variants={fadeUp}
      className="rounded-xl border border-border bg-card overflow-hidden flex flex-col hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => imgSrc && onOpen(imgSrc)}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={flyer.title}
          className="w-full aspect-video object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full aspect-video bg-muted flex items-center justify-center">
          <span className="text-3xl text-muted-foreground/30">🛍</span>
        </div>
      )}

      <div className="flex-1 flex flex-col p-4 space-y-2">
        {/* Store chip */}
        <span className="inline-flex self-start items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          {flyer.storeName}
        </span>

        {/* Title */}
        <h3 className="text-sm font-bold text-foreground leading-snug">
          {flyer.title}
        </h3>

        {/* Description — 2-line clamp */}
        {flyer.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {flyer.description}
          </p>
        )}

        {/* Validity */}
        <p className="mt-auto pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Valid until{' '}
          <span className="text-foreground/70">
            {formatDate(flyer.validUntil)}
          </span>
        </p>
      </div>
    </motion.div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const [flyers,  setFlyers]  = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [modal,   setModal]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/flyers/save')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load deals');
        return res.json() as Promise<Flyer[]>;
      })
      .then((data) => {
        if (!cancelled) setFlyers(data);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message ?? 'Could not load deals');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/30 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <a href="/" className="opacity-70 hover:opacity-100 transition-opacity">
            <Logo />
          </a>
        </div>
      </header>

      {modal && <ImageModal src={modal} onClose={() => setModal(null)} />}

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-10 sm:py-14">

        {/* Hero heading */}
        <motion.div
          variants={stagger} initial="hidden" animate="show"
          className="mb-10 space-y-2"
        >
          <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Local deals
          </motion.p>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Deals <span className="text-primary">near you</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-sm text-muted-foreground">
            Exclusive offers from kirana stores in your area.
          </motion.p>
        </motion.div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">
            {error}
          </div>
        ) : flyers.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center justify-center py-24 text-center space-y-3"
          >
            <div className="text-5xl">🛒</div>
            <h2 className="text-lg font-bold text-foreground">No deals yet</h2>
            <p className="text-sm text-muted-foreground">Check back soon — new offers are added regularly.</p>
          </motion.div>
        ) : (
          <motion.div
            variants={stagger} initial="hidden" animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {flyers.map((flyer) => (
              <FlyerCard key={flyer.id} flyer={flyer} onOpen={setModal} />
            ))}
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 py-5 text-center">
        <p className="text-xs text-muted-foreground/40">
          © 2025 VS Collective LLP · hello@wearealive.in
        </p>
      </footer>
    </div>
  );
}
