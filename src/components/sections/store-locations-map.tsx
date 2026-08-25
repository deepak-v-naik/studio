'use client';
import { useEffect, useRef, useState } from 'react';

type StorePin = {
  id: string;
  storeName: string;
  locality: string | null;
  city: string | null;
  lat: number;
  lng: number;
};


export default function StoreLocationsMap() {
  const mapRef        = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  const [stores, setStores] = useState<StorePin[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Marker effect must re-run once the async init lands, not just when stores
  // change — otherwise stores loaded before the map is ready never get pins.
  const [mapReady, setMapReady] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  const boundariesLoaded = useRef(false);

  // Fetch store locations
  useEffect(() => {
    fetch('/api/stores/locations')
      .then(r => r.json())
      .then(d => setStores((d.stores ?? []).filter((s: StorePin) => s.lat && s.lng)))
      .catch(() => {});
  }, []);

  // Init Leaflet map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // The guard above runs before the `await` below, so without cancellation a
    // double-fired effect (Strict Mode, HMR) has both runs pass it and the
    // second L.map() throws "Map container is already initialized".
    let cancelled = false;

    async function init() {
      const L = (await import('leaflet')).default;
      if (cancelled || mapInstanceRef.current) return;

      if (!document.querySelector('link[data-leaflet-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.setAttribute('data-leaflet-css', '1');
        document.head.appendChild(link);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (L as any).map(mapRef.current!, {
        center: [12.9377, 74.8543],
        zoom: 12,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L as any).tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 20,
      }).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L as any).control.zoom({ position: 'bottomright' }).addTo(map);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L as any).control.attribution({ position: 'bottomleft', prefix: '© OpenStreetMap · CartoDB' }).addTo(map);

      mapInstanceRef.current = map;
      setMapReady(true);

      // Load GeoJSON ward boundaries
      loadWards(L, map);
    }

    init();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      // Markers/wards belonged to the destroyed map — reset so a remount
      // (Strict Mode's second pass, HMR) recreates them on the new instance.
      markersRef.current.clear();
      boundariesLoaded.current = false;
      setMapReady(false);
    };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function loadWards(L: any, map: any) {
    if (boundariesLoaded.current) return;
    boundariesLoaded.current = true;
    try {
      const res = await fetch('/mangaluru-wards.geojson');
      const geojson = await res.json();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L as any).geoJSON(geojson, {
        style: {
          color: '#dc2626',
          weight: 1.5,
          opacity: 0.5,
          fillColor: '#dc2626',
          fillOpacity: 0.04,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature: (feature: any, layer: any) => {
          const name = feature.properties?.ward_name ?? '';
          const no   = feature.properties?.ward_no ?? '';
          if (name) {
            layer.bindTooltip(
              `<span style="font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.15em;text-transform:uppercase;font-weight:600;color:#dc2626;">${name} · Ward ${no}</span>`,
              { permanent: false, direction: 'center', opacity: 1 }
            );
            layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.14, opacity: 0.75 }));
            layer.on('mouseout',  () => layer.setStyle({ fillOpacity: 0.04, opacity: 0.5  }));
          }
        },
      }).addTo(map);
    } catch {
      // decorative — fail silently
    }
  }

  // Add store markers when data loads
  useEffect(() => {
    if (!mapInstanceRef.current || stores.length === 0) return;

    async function addMarkers() {
      const L = (await import('leaflet')).default;
      const map = mapInstanceRef.current;
      if (!map) return; // unmounted while the import was in flight

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const makeIcon = (active: boolean) => (L as any).divIcon({
        className: '',
        html: `<div style="width:${active ? 18 : 14}px;height:${active ? 18 : 14}px;border-radius:50%;background:#dc2626;border:${active ? 3 : 2.5}px solid #fff;box-shadow:0 2px ${active ? 14 : 8}px rgba(220,38,38,${active ? '.6' : '.4'});cursor:pointer;transition:all .2s;"></div>`,
        iconSize:   [active ? 18 : 14, active ? 18 : 14],
        iconAnchor: [active ? 9  : 7,  active ? 9  : 7],
        popupAnchor: [0, -12],
      });

      const pinIcon   = makeIcon(false);
      const activePin = makeIcon(true);

      stores.forEach(store => {
        if (markersRef.current.has(store.id)) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const marker = (L as any).marker([store.lat, store.lng], { icon: pinIcon })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:Manrope,sans-serif;min-width:140px;padding:2px 0;">
              <p style="font-size:13px;font-weight:700;margin:0 0 2px;">${store.storeName}</p>
              <p style="font-size:11px;color:#666;margin:0;">${[store.locality, store.city].filter(Boolean).join(' · ')}</p>
            </div>`,
            { closeButton: false, className: 'alive-popup' }
          );

        marker.on('click', () => {
          setSelected(store.id);
          markersRef.current.forEach((m, id) => m.setIcon(id === store.id ? activePin : pinIcon));
        });

        markersRef.current.set(store.id, marker);
      });

      if (stores.length > 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const group = (L as any).featureGroup(Array.from(markersRef.current.values()));
        map.fitBounds(group.getBounds().pad(0.3), { maxZoom: 14 });
      }
    }

    addMarkers();
  }, [stores, mapReady]);

  const flyTo = (store: StorePin) => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo([store.lat, store.lng], 16, { duration: 0.8 });
    markersRef.current.get(store.id)?.openPopup();
    setSelected(store.id);
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: stores.length > 0 ? '1fr 260px' : '1fr',
      height: 520,
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid var(--rule)',
    }}>
      {/* Map */}
      <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#f5f5f5' }} />

      {/* Store sidebar */}
      {stores.length > 0 && (
        <div style={{ background: '#fff', borderLeft: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
            <p style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#dc2626', fontWeight: 600 }}>
              {stores.length} live screen{stores.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {stores.map(store => (
              <button
                key={store.id}
                onClick={() => flyTo(store)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 16px',
                  borderBottom: '1px solid var(--rule)', background: selected === store.id ? '#fef2f2' : 'transparent',
                  cursor: 'pointer', transition: 'background .15s', display: 'block',
                  borderLeft: `2.5px solid ${selected === store.id ? '#dc2626' : 'transparent'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ marginTop: 4, width: 7, height: 7, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />
                  <div>
                    <p style={{ fontFamily: '"Manrope",sans-serif', fontSize: 13, fontWeight: 600, color: '#0a0a0a', lineHeight: 1.3, margin: 0 }}>{store.storeName}</p>
                    <p style={{ fontFamily: '"DM Mono",monospace', fontSize: 10, color: '#888', marginTop: 2, letterSpacing: '0.05em' }}>
                      {[store.locality, store.city].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .alive-popup .leaflet-popup-content-wrapper{border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.12);padding:0;}
        .alive-popup .leaflet-popup-content{margin:10px 14px;}
        .alive-popup .leaflet-popup-tip-container{display:none;}
        .leaflet-control-zoom{border:1px solid #e5e5e5 !important;border-radius:8px !important;overflow:hidden;box-shadow:none !important;}
        .leaflet-control-zoom a{width:30px !important;height:30px !important;line-height:30px !important;font-size:16px !important;color:#333 !important;}
        .leaflet-control-attribution{font-size:10px !important;background:rgba(255,255,255,.7) !important;}
      `}</style>
    </div>
  );
}
