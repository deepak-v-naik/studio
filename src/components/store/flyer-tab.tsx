'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Loader2, RefreshCw, Printer, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { storeFetch } from '@/lib/store-fetch';

type Offer = {
  id: string; productName: string; weight: string | null;
  mrp: number; offerPrice: number; validUntil: string | null;
  productId?: string | null; imageUrl?: string | null;
};

function discount(mrp: number, offer: number) { return Math.round(((mrp - offer) / mrp) * 100); }

// ─── Flyer canvas — renders exactly what gets exported ────────────────────────

function FlyerCanvas({
  offers, storeName, title, dateRange, flyerRef,
}: {
  offers: Offer[]; storeName: string; title: string; dateRange: string;
  flyerRef: React.RefObject<HTMLDivElement>;
}) {
  const grid = offers.slice(0, 9);
  while (grid.length < 9) grid.push(null as unknown as Offer);

  return (
    <div
      ref={flyerRef}
      id="alive-flyer"
      style={{
        width: 630, minHeight: 1120, background: '#c92020',
        fontFamily: "'Arial Black', 'Impact', sans-serif",
        position: 'relative', overflow: 'hidden', flexShrink: 0,
      }}
    >
      {/* Diagonal background shapes */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: -60, right: -80, width: 340, height: 340,
          background: 'rgba(255,255,255,0.10)', transform: 'rotate(30deg)' }} />
        <div style={{ position: 'absolute', top: 20, right: -30, width: 220, height: 220,
          background: 'rgba(255,255,255,0.07)', transform: 'rotate(20deg)' }} />
        <div style={{ position: 'absolute', bottom: 80, left: -40, width: 280, height: 280,
          background: 'rgba(255,255,255,0.06)', transform: 'rotate(-15deg)' }} />
      </div>

      {/* ── Header ── */}
      <div style={{ position: 'relative', zIndex: 1, padding: '18px 20px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>

          {/* Logo + title block */}
          <div>
            {/* ALIVE logo text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: -1, lineHeight: 1 }}>alive</span>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', marginBottom: 2 }} />
            </div>
            {/* WOW label */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: -4 }}>
              <span style={{ fontSize: 52, fontWeight: 900, color: '#fff', letterSpacing: -3, lineHeight: 1, textTransform: 'uppercase' }}>WOW</span>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 2 }}>{title.split(' ')[0] || 'SUMMER'}</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: 2 }}>{title.split(' ').slice(1).join(' ') || 'OFFER'}</span>
              </div>
            </div>
            {/* Edition + date */}
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700 }}>MANGALORE EDITION</span>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: 1, marginTop: 1 }}>{dateRange}</div>
            </div>
          </div>

          {/* 60% OFF badge */}
          <div style={{
            background: '#fff', borderRadius: 8, padding: '8px 14px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: '#c92020', letterSpacing: 1, textTransform: 'uppercase' }}>UP TO</span>
            <span style={{ fontSize: 40, fontWeight: 900, color: '#c92020', lineHeight: 1 }}>60%</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#c92020', letterSpacing: 2 }}>OFF</span>
          </div>
        </div>
      </div>

      {/* ── Store name banner ── */}
      <div style={{
        position: 'relative', zIndex: 1, background: 'rgba(0,0,0,0.55)',
        padding: '10px 20px', margin: '6px 0',
      }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: 0.5 }}>{storeName}</span>
      </div>

      {/* ── 3×3 Product grid ── */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10, padding: '10px 12px',
      }}>
        {grid.map((offer, i) => (
          <ProductCard key={i} offer={offer} />
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: '#1a1a1a', marginTop: 10,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 900, color: '#fff', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            AVAILABLE AT ALL AFFILIATED ALIVE STORES.
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', marginTop: 2, letterSpacing: 0.5 }}>
            CONTACT US TO GET YOUR BRAND ONBOARD ONTO A STORE NEAR YOU.
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 6, letterSpacing: 0.5 }}>
            WEAREALIVE.IN | +91 7411 32 444 8 | HELLO@WEAREALIVE.IN
          </div>
        </div>
        {/* QR placeholder */}
        <div style={{
          width: 60, height: 60, background: '#fff', borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, color: '#888', textAlign: 'center', padding: 4,
        }}>
          <div style={{ fontSize: 6, color: '#aaa' }}>QR<br/>wearealive.in</div>
        </div>
      </div>
    </div>
  );
}

function ProductCard({ offer }: { offer: Offer | null }) {
  if (!offer) {
    return (
      <div style={{
        background: '#2a2a3a', borderRadius: 12,
        minHeight: 175, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 12 }}>—</span>
      </div>
    );
  }

  const pct = discount(offer.mrp, offer.offerPrice);

  return (
    <div style={{
      background: '#1e1e30', borderRadius: 12, padding: '10px 10px 8px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      position: 'relative', minHeight: 175,
    }}>
      {/* % OFF badge */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        background: '#c92020', borderRadius: '50%',
        width: 38, height: 38,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{pct}%</span>
        <span style={{ fontSize: 7, fontWeight: 900, color: '#fff', letterSpacing: 0.5, lineHeight: 1 }}>OFF</span>
      </div>

      {/* MRP strikethrough — top right */}
      <div style={{ alignSelf: 'flex-end', marginTop: 2, marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', textDecoration: 'line-through' }}>₹{offer.mrp}</span>
      </div>

      {/* Product image — catalogue image if linked, letter placeholder otherwise */}
      <div style={{
        width: 70, height: 70, borderRadius: 8, background: '#2e2e45',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 6, flexShrink: 0, overflow: 'hidden',
      }}>
        {offer.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.imageUrl}
            alt={offer.productName}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            crossOrigin="anonymous"
          />
        ) : (
          <span style={{ fontSize: 28, fontWeight: 900, color: 'rgba(255,255,255,0.15)' }}>
            {offer.productName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Offer price */}
      <div style={{ fontSize: 22, fontWeight: 900, color: '#ff4d4d', lineHeight: 1, marginBottom: 4 }}>
        ₹{offer.offerPrice}
      </div>

      {/* Product name */}
      <div style={{
        fontSize: 9, color: '#fff', textAlign: 'center', lineHeight: 1.3,
        fontFamily: 'Arial, sans-serif', fontWeight: 700,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', width: '100%',
      }}>
        {offer.productName}{offer.weight ? ` ${offer.weight}` : ''}
      </div>
    </div>
  );
}

// ─── Main Flyer Tab ───────────────────────────────────────────────────────────

export default function FlyerTab({ storeName }: { storeName: string }) {
  const [offers,      setOffers]      = useState<Offer[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [title,       setTitle]       = useState('SUMMER OFFER');
  const [dateRange,   setDateRange]   = useState(() => {
    const d = new Date();
    const end = new Date(d); end.setDate(d.getDate() + 7);
    const fmt = (x: Date) => x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, ' ');
    return `${fmt(d)} – ${fmt(end)}`;
  });
  const [exporting,   setExporting]   = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const flyerRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement);

  useEffect(() => {
    setLoading(true);
    storeFetch('/api/stores/offers')
      .then((r) => r.json())
      .then((data: unknown) => {
        const list = Array.isArray(data) ? (data as Offer[]) : [];
        setOffers(list);
        setSelected(new Set(list.slice(0, 9).map((o) => o.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleOffer = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < 9) { next.add(id); }
      return next;
    });
  };

  const selectedOffers = offers.filter((o) => selected.has(o.id));

  const exportPng = useCallback(async () => {
    if (!flyerRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(flyerRef.current, {
        scale: 2, useCORS: true, backgroundColor: null,
        logging: false, allowTaint: true,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `alive-flyer-${Date.now()}.png`;
      a.click();
    } catch (e) {
      console.error('Export failed', e);
    } finally { setExporting(false); }
  }, []);

  const inp = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20';

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (offers.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-2">
        <Tag className="h-8 w-8 mx-auto text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground">Add offers first, then generate a flyer.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Controls */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-foreground">Flyer Generator</p>
            <p className="text-xs text-muted-foreground">{selected.size} of 9 slots filled</p>
          </div>
          <button onClick={() => setShowOptions((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Customise {showOptions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {showOptions && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Header title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SUMMER OFFER" className={inp} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date range</label>
              <input value={dateRange} onChange={(e) => setDateRange(e.target.value)} placeholder="May 11–18 | 2026" className={inp} />
            </div>
          </div>
        )}

        {/* Offer picker */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Select up to 9 offers</p>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {offers.map((o) => {
              const isSelected = selected.has(o.id);
              const pct = discount(o.mrp, o.offerPrice);
              return (
                <button key={o.id} onClick={() => toggleOffer(o.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-all border ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/40'
                  } ${!isSelected && selected.size >= 9 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  disabled={!isSelected && selected.size >= 9}>
                  <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>
                    {isSelected && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{o.productName}{o.weight ? ` — ${o.weight}` : ''}</p>
                    <p className="text-[10px] text-muted-foreground">₹{o.offerPrice} <span className="line-through">₹{o.mrp}</span> · {pct}% off</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2 pt-1">
          <button onClick={exportPng} disabled={exporting || selected.size === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-40">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Generating…' : 'Download PNG'}
          </button>
          <button onClick={() => window.print()} className="px-4 rounded-xl border border-border text-muted-foreground hover:bg-muted/40">
            <Printer className="h-4 w-4" />
          </button>
          <button onClick={() => {
            const next = new Set(offers.slice(0, 9).map((o) => o.id));
            setSelected(next);
          }} className="px-4 rounded-xl border border-border text-muted-foreground hover:bg-muted/40" title="Reset selection">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Flyer preview — scrollable */}
      <div className="rounded-2xl border border-border bg-card p-4 overflow-auto">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Preview</p>
        <div className="overflow-x-auto">
          <div style={{ transform: 'scale(0.72)', transformOrigin: 'top left', width: 630 * 0.72, marginBottom: -(1120 * 0.28) }}>
            <FlyerCanvas
              offers={selectedOffers}
              storeName={storeName}
              title={title}
              dateRange={dateRange}
              flyerRef={flyerRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
