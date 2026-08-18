'use client';

// Onboarding map picker: live store screens on a Leaflet map, click to select.
// Selection is a routing hint for ops (Campaign.preferredStoreIds), not a hard
// slot reservation — copy in the parent explains that. Leaflet is dynamically
// imported (no react-leaflet — React 19 only) and its CSS ships globally.
//
// Lifecycle rules learned the hard way:
// - The map mounts once; MARKERS are torn down and rebuilt whenever pins change
//   (a startDate refetch changes slotStatus), so click guards and tooltips can
//   never act on stale availability.
// - Store names/localities are partner-entered strings — always HTML-escaped
//   before they touch tooltip markup (stored-XSS on a public payment page
//   otherwise).
// - Errors never unmount the container: a mounted Leaflet map whose DOM node
//   vanishes can't re-init. We overlay a notice instead.

import { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';

const TILE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const MANGALURU: [number, number] = [12.8698, 74.8431];

type ScreenPin = {
  id: string;
  storeName: string;
  locality: string | null;
  city: string | null;
  lat: number;
  lng: number;
  slotStatus: 'available' | 'limited' | 'sold_out' | null;
};

const STATUS_DOT: Record<string, string> = {
  available: '#22c55e',
  limited:   '#eab308',
  sold_out:  '#9ca3af',
  none:      '#22c55e', // schedule-mode stores are selectable
};

const STATUS_LABEL: Record<string, string> = {
  available: 'Slots open',
  limited:   'Few slots left',
  sold_out:  'Sold out',
  none:      'Available',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 36px hit target (touch minimum) around a smaller visual dot.
function markerHtml(pin: ScreenPin, selected: boolean) {
  const dot = STATUS_DOT[pin.slotStatus ?? 'none'];
  const inner = selected
    ? `<div style="width:26px;height:26px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>`
    : `<div style="width:16px;height:16px;border-radius:50%;background:${dot};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;
  return `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center">${inner}</div>`;
}

function tooltipHtml(pin: ScreenPin) {
  return `<strong>${esc(pin.storeName)}</strong><br/>${esc(pin.locality ?? pin.city ?? '')} · ${STATUS_LABEL[pin.slotStatus ?? 'none']}`;
}

export default function ScreenPickerMap({
  selected, onToggle, startDate,
}: {
  selected: string[];
  onToggle: (id: string, storeName: string) => void;
  startDate: string;              // YYYY-MM-DD — availability is shown for this date
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  const [pins, setPins]       = useState<ScreenPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  // Refs so marker handlers always see current state without rebinding.
  const pinsRef = useRef<Map<string, ScreenPin>>(new Map());
  pinsRef.current = new Map(pins.map((p) => [p.id, p]));
  const selectedRef = useRef<string[]>(selected);
  selectedRef.current = selected;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/brand/screens?date=${encodeURIComponent(startDate)}`)
      .then((r) => r.ok ? (r.json() as Promise<{ screens: ScreenPin[] }>) : Promise.reject(new Error()))
      .then((d) => { if (live) { setPins(d.screens); setError(false); } })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [startDate]);

  // Mount the map once when the first pins arrive; REBUILD markers on every
  // pins change so handlers/tooltips always reflect the fetched date.
  useEffect(() => {
    if (!containerRef.current || pins.length === 0) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        const center: [number, number] = [
          pins.reduce((s, p) => s + p.lat, 0) / pins.length,
          pins.reduce((s, p) => s + p.lng, 0) / pins.length,
        ];
        mapRef.current = L.map(containerRef.current, {
          zoomControl: true,
          scrollWheelZoom: false,
          // One-finger drag over a mid-form map is a scroll trap on phones;
          // pinch-zoom still works for positioning.
          dragging: !L.Browser.mobile,
        }).setView(pins.length ? center : MANGALURU, 13);
        L.tileLayer(TILE, { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }).addTo(mapRef.current);
      }

      // Rebuild markers from the current pins.
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();

      for (const pin of pins) {
        const isSel = selectedRef.current.includes(pin.id);
        const icon = L.divIcon({
          html: markerHtml(pin, isSel), className: '',
          iconSize: [36, 36], iconAnchor: [18, 18],
        });
        const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(mapRef.current);
        marker.bindTooltip(tooltipHtml(pin), { direction: 'top', offset: [0, -14] });
        marker.on('click', () => {
          const current = pinsRef.current.get(pin.id);
          if (current?.slotStatus === 'sold_out') return;
          onToggleRef.current(pin.id, current?.storeName ?? pin.storeName);
        });
        markersRef.current.set(pin.id, marker);
      }
    })();
    return () => { cancelled = true; };
  }, [pins]);

  // Restyle markers when the selection changes (no rebuild needed).
  useEffect(() => {
    if (!mapRef.current) return;
    (async () => {
      const L = (await import('leaflet')).default;
      for (const [id, marker] of markersRef.current) {
        const pin = pinsRef.current.get(id);
        if (!pin) continue;
        marker.setIcon(L.divIcon({
          html: markerHtml(pin, selected.includes(id)), className: '',
          iconSize: [36, 36], iconAnchor: [18, 18],
        }));
      }
    })();
  }, [selected]);

  // Tear down on unmount only — the container never unmounts while errors show.
  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    markersRef.current.clear();
  }, []);

  // Genuinely nothing to show (no live geocoded screens): render nothing —
  // the heading lives here, so no orphan section is left behind.
  if (!loading && !error && pins.length === 0) return null;

  const byId = new Map(pins.map((p) => [p.id, p]));

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Pick screens near your customers
      </p>
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[300px] sm:h-[340px] rounded-xl overflow-hidden border border-border bg-muted/30"
        />
        {loading && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center rounded-xl bg-muted/40 text-xs text-muted-foreground">
            Loading live screens…
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-x-0 bottom-0 z-[500] rounded-b-xl bg-background/95 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Couldn&rsquo;t refresh availability — you can still book by screen count below.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" /> Slots open</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500 inline-block" /> Few left</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gray-400 inline-block" /> Sold out</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary inline-block" /> Selected</span>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => {
            const pin = byId.get(id);
            if (!pin) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onToggle(id, pin.storeName)}
                className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/60 transition-colors"
              >
                <MapPin className="h-3 w-3 text-primary" />
                {pin.storeName}
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
