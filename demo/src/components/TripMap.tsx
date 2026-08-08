import { ArrowClockwise, WifiSlash } from '@phosphor-icons/react';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import type { ItineraryItem } from '../types';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

type TileStatus = 'loading' | 'ready' | 'error';

function createMarkerIcon(index: number, active: boolean) {
  return L.divIcon({
    className: 'trip-map-marker-wrap',
    html: `<span class="trip-map-marker${active ? ' trip-map-marker-active' : ''}" aria-hidden="true">${index + 1}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

export function TripMap({
  items,
  activeId,
  onSelect,
}: {
  items: ItineraryItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const onSelectRef = useRef(onSelect);
  const [tileStatus, setTileStatus] = useState<TileStatus>('loading');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setTileStatus('loading');
    let receivedTile = false;
    let errorTimer: number | undefined;
    const map = L.map(container, {
      attributionControl: true,
      scrollWheelZoom: false,
      zoomControl: false,
    });
    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const tileLayer = L.tileLayer(TILE_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    });
    tileLayer.on('tileload', () => {
      receivedTile = true;
      if (errorTimer) window.clearTimeout(errorTimer);
      setTileStatus('ready');
    });
    tileLayer.on('tileerror', () => {
      if (!receivedTile && !errorTimer) {
        errorTimer = window.setTimeout(() => setTileStatus('error'), 1800);
      }
    });
    tileLayer.addTo(map);

    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => {
      window.cancelAnimationFrame(frame);
      if (errorTimer) window.clearTimeout(errorTimer);
      markersRef.current.clear();
      routeLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [retryKey]);

  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer || items.length === 0) return;

    routeLayer.clearLayers();
    markersRef.current.clear();
    const points = items.map((item) => L.latLng(item.coordinates[0], item.coordinates[1]));
    const outline = L.polyline(points, {
      color: '#fffaf0',
      opacity: 0.95,
      weight: 8,
    }).addTo(routeLayer);
    L.polyline(points, {
      color: '#3f6b57',
      dashArray: '3 7',
      lineCap: 'round',
      opacity: 0.95,
      weight: 4,
    }).addTo(routeLayer);

    items.forEach((item, index) => {
      const marker = L.marker(item.coordinates, {
        alt: `路线第 ${index + 1} 站：${item.title}`,
        icon: createMarkerIcon(index, item.id === activeId),
        keyboard: true,
        riseOnHover: true,
        title: item.title,
      }).addTo(routeLayer);
      marker.on('click', () => onSelectRef.current(item.id));
      marker.bindTooltip(`${index + 1}. ${item.title}`, {
        direction: 'top',
        offset: [0, -20],
      });
      const element = marker.getElement();
      element?.setAttribute('role', 'button');
      element?.setAttribute('aria-label', `查看路线第 ${index + 1} 站：${item.title}`);
      element?.setAttribute('aria-pressed', String(item.id === activeId));
      markersRef.current.set(item.id, marker);
    });

    map.fitBounds(outline.getBounds(), {
      maxZoom: 14,
      padding: [38, 38],
    });
  }, [items, retryKey]);

  useEffect(() => {
    items.forEach((item, index) => {
      const marker = markersRef.current.get(item.id);
      if (!marker) return;
      marker.setIcon(createMarkerIcon(index, item.id === activeId));
      const element = marker.getElement();
      element?.setAttribute('role', 'button');
      element?.setAttribute('aria-label', `查看路线第 ${index + 1} 站：${item.title}`);
      element?.setAttribute('aria-pressed', String(item.id === activeId));
    });

    const active = items.find((item) => item.id === activeId);
    if (active && mapRef.current) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      mapRef.current.panInside(active.coordinates, {
        animate: !reducedMotion,
        padding: [56, 56],
      });
    }
  }, [activeId, items, retryKey]);

  return (
    <div className="trip-map-shell">
      <div
        ref={containerRef}
        className="trip-map-canvas"
        aria-label="苏州行程真实地图，可拖动并使用加减按钮缩放"
      />

      {tileStatus === 'loading' && (
        <div className="trip-map-loading" role="status">
          <span className="trip-map-loading-line" />
          <span>正在加载真实地图…</span>
        </div>
      )}

      {tileStatus === 'error' && (
        <div className="trip-map-error" role="alert">
          <WifiSlash size={22} aria-hidden="true" />
          <div>
            <strong>地图底图加载失败</strong>
            <p>地点列表仍可使用，请检查网络后重试。</p>
          </div>
          <button type="button" onClick={() => setRetryKey((current) => current + 1)}>
            <ArrowClockwise size={17} aria-hidden="true" />重试
          </button>
        </div>
      )}

      <div className="trip-map-note">真实地点 · 连线仅表示行程顺序</div>
      <span className="sr-only" aria-live="polite">
        {tileStatus === 'ready' ? '真实地图加载完成' : ''}
      </span>
    </div>
  );
}
