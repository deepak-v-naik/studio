'use client';
import { useState, useEffect, useRef } from 'react';
import { Upload, RotateCcw, Link, Eye } from 'lucide-react';
import { adminGetObject } from '@/lib/admin-fetch';

const MEDIA_SLOTS = [
  // Hero carousel (3 rotating panels)
  { key: 'hero-brand',      label: 'Hero — Brands',               hint: '/for-brands.jpg',              section: 'Hero carousel' },
  { key: 'hero-kirana',     label: 'Hero — Kiranas',              hint: '/kirana-best-practice.jpg',    section: 'Hero carousel' },
  { key: 'hero-consumer',   label: 'Hero — Consumers',            hint: '/india-street.jpg',            section: 'Hero carousel' },
  // Audience cards (the 3-column "who it's for" grid) — independent of the hero slots above
  { key: 'vessel-brand',    label: 'Audience card — Brands',      hint: '/for-brands.jpg',               section: 'Audience cards' },
  { key: 'kirana-shop',     label: 'Audience card — Kiranas',     hint: '/kirana-shop.jpg',              section: 'Audience cards' },
  { key: 'vessel-consumer', label: 'Audience card — Consumers',   hint: '/india-street.jpg',             section: 'Audience cards' },
  // Product / proof section
  { key: 'product-shot',    label: 'Product shot',                 hint: '/alive-product-shot.png',      section: 'Product section' },
  // Testimonials (4 quotes with headshots) — independent of the hero slots above
  { key: 'testimonial-kirana', label: 'Testimonial — Kirana Owner', hint: '/kirana-best-practice.jpg',   section: 'Testimonials' },
  { key: 'store-shelf',     label: 'Testimonial — Brand Manager',  hint: '/store-shelf.jpg',              section: 'Testimonials' },
  { key: 'store-aisle',     label: 'Testimonial — Shopper',        hint: '/store-aisle.jpg',              section: 'Testimonials' },
  { key: 'alive-after',     label: 'Testimonial — Field Lead',     hint: '/alive-after.png',              section: 'Testimonials' },
  // OG / social share
  { key: 'og-cover',        label: 'OG / Social cover',            hint: '/og-image.jpg',                 section: 'Meta' },
];

type Slot = typeof MEDIA_SLOTS[number];

export default function SiteMediaTab({ adminPassword }: { adminPassword: string }) {
  const headers = { 'admin-password': adminPassword };
  const [media, setMedia] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlSlot, setUrlSlot] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSlotRef = useRef<string | null>(null);

  useEffect(() => {
    adminGetObject<Record<string, string>>('/api/admin/site-media', adminPassword)
      .then(setMedia)
      .catch(() => setMedia({}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPassword]);

  const saveUrl = async (slot: string, url: string) => {
    await fetch('/api/admin/site-media', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, url }),
    });
    setMedia(m => ({ ...m, [slot]: url }));
  };

  // Server-side proxy upload — avoids CORS on direct R2 PUT
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = activeSlotRef.current;
    if (!file || !slot) return;
    e.target.value = '';
    setError(null);
    setUploading(slot);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const key = `site-media/${slot}.${ext}`;

      const form = new FormData();
      form.append('file', file);
      form.append('key', key);

      const res = await fetch('/api/admin/r2-upload', {
        method: 'POST',
        headers: { 'admin-password': adminPassword },
        body: form,
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      const { publicUrl: cdnUrl } = await res.json() as { publicUrl: string };
      await saveUrl(slot, cdnUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
      activeSlotRef.current = null;
    }
  };

  const handlePasteUrl = async () => {
    if (!urlSlot || !urlInput.trim()) return;
    await saveUrl(urlSlot, urlInput.trim());
    setUrlSlot(null);
    setUrlInput('');
  };

  const resetSlot = async (slot: string) => {
    await fetch('/api/admin/site-media', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, url: '' }),
    });
    setMedia(m => { const n = { ...m }; delete n[slot]; return n; });
  };

  const sections = Array.from(new Set(MEDIA_SLOTS.map(s => s.section)));

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="mb-2">
        <p className="admin-font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-primary mb-0.5">Site management</p>
        <h1 className="admin-font-display text-3xl font-bold text-foreground tracking-tight">
          <em className="not-italic text-primary">{MEDIA_SLOTS.length}</em> homepage slots.
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Upload per-slot images · R2 CDN · reflects live within 60 s</p>
      </div>

      {/* Homepage skeleton preview */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Homepage layout map</p>
        </div>
        <div className="rounded-xl border border-border/60 overflow-hidden bg-background" style={{ maxWidth: 480 }}>
          {/* Hero skeleton */}
          <div className="relative bg-gray-100 h-24 flex items-center justify-center border-b border-border/40">
            <div className="absolute inset-0 flex">
              {['hero-brand','hero-kirana','hero-consumer'].map((k, i) => (
                <div key={k} className={`flex-1 flex items-center justify-center text-[9px] font-mono font-semibold text-white/80 ${i===0?'bg-primary/60':i===1?'bg-gray-500/50':'bg-gray-400/50'}`}>
                  {media[k] ? '● CUSTOM' : `hero-${['brand','kirana','consumer'][i]}`}
                </div>
              ))}
            </div>
            <span className="relative z-10 text-[9px] font-mono bg-black/40 text-white px-2 py-0.5 rounded">HERO CAROUSEL</span>
          </div>
          {/* Audience cards skeleton */}
          <div className="flex border-b border-border/40">
            {['vessel-brand','kirana-shop','vessel-consumer'].map((k, i) => (
              <div key={k} className={`flex-1 h-14 flex items-center justify-center text-[8px] font-mono ${media[k]?'bg-green-50 text-green-700':'bg-muted/40 text-muted-foreground'} ${i<2?'border-r border-border/40':''}`}>
                {['brands','kiranas','consumers'][i]}
              </div>
            ))}
          </div>
          {/* Product shot */}
          <div className={`h-12 flex items-center justify-center text-[8px] font-mono border-b border-border/40 ${media['product-shot']?'bg-green-50 text-green-700':'bg-muted/40 text-muted-foreground'}`}>
            product-shot
          </div>
          {/* Testimonials */}
          <div className="flex">
            {['testimonial-kirana','store-shelf','store-aisle','alive-after'].map((k, i) => (
              <div key={k} className={`flex-1 h-12 flex items-center justify-center text-[8px] font-mono ${media[k]?'bg-green-50 text-green-700':'bg-muted/40 text-muted-foreground'} ${i<3?'border-r border-border/40':''}`}>
                {['kirana','shelf','aisle','after'][i]}
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Green = custom image set · Gray = using default fallback</p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive flex justify-between items-start gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-bold">×</button>
        </div>
      )}

      {/* Paste URL panel */}
      {urlSlot && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold">Paste URL for: {MEDIA_SLOTS.find(s => s.key === urlSlot)?.label}</p>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://..."
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button onClick={() => void handlePasteUrl()} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white">Set</button>
            <button onClick={() => { setUrlSlot(null); setUrlInput(''); }} className="rounded-lg border border-border px-3 py-2 text-xs">Cancel</button>
          </div>
        </div>
      )}

      {sections.map(section => (
        <div key={section}>
          <p className="admin-font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2 mt-2">{section}</p>
          <div className="grid grid-cols-3 gap-3">
          {MEDIA_SLOTS.filter(s => s.section === section).map(slot => {
          const currentUrl = media[slot.key];
          const isUploading = uploading === slot.key;
          const isVideo = currentUrl?.match(/\.mp4(\?|$)/);
          const isGif   = currentUrl?.match(/\.gif(\?|$)/);

          return (
            <div key={slot.key} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Thumbnail */}
              <div className="relative aspect-video bg-muted/30 flex items-center justify-center overflow-hidden">
                {currentUrl ? (
                  isVideo ? (
                    <video src={currentUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={currentUrl} alt={slot.label} className="w-full h-full object-cover" />
                  )
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.hint} alt={slot.label} className="w-full h-full object-cover" />
                )}
                <span className={`absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-semibold ${
                  currentUrl ? 'bg-green-600 text-white' : 'bg-black/40 text-white/80'
                }`}>
                  {currentUrl ? 'custom' : 'default'}
                </span>
                {isUploading && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <div className="text-xs text-muted-foreground animate-pulse">Uploading…</div>
                  </div>
                )}
                {(isGif || isVideo) && (
                  <span className="absolute top-2 right-2 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded font-mono uppercase">
                    {isVideo ? 'mp4' : 'gif'}
                  </span>
                )}
              </div>

              {/* Label + actions */}
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">{slot.label}</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { activeSlotRef.current = slot.key; fileInputRef.current?.click(); }}
                    disabled={isUploading}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    <Upload className="h-3 w-3" />
                    {currentUrl ? 'Replace' : 'Upload'}
                  </button>
                  <button
                    onClick={() => { setUrlSlot(slot.key); setUrlInput(''); }}
                    title="Paste URL"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Link className="h-3 w-3" />
                  </button>
                  {currentUrl && (
                    <button
                      onClick={() => resetSlot(slot.key)}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
                      title="Reset to default"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
          </div>
        </div>
      ))}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,.gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
