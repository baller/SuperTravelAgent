import { MapPin, Star, WarningCircle, X } from '@phosphor-icons/react';
import L, { LayerGroup, Map as LeafletMap, TileLayer } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinates, ItineraryItem, RouteLeg } from '../types';

const X_PI = (Math.PI * 3000) / 180;
const PI = Math.PI;
const A = 6378245;
const EE = 0.006693421622965943;

function outsideChina(longitude: number, latitude: number) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(longitude: number, latitude: number) {
  let value = -100 + 2 * longitude + 3 * latitude + 0.2 * latitude * latitude;
  value += 0.1 * longitude * latitude + 0.2 * Math.sqrt(Math.abs(longitude));
  value += ((20 * Math.sin(6 * longitude * PI) + 20 * Math.sin(2 * longitude * PI)) * 2) / 3;
  value += ((20 * Math.sin(latitude * PI) + 40 * Math.sin((latitude / 3) * PI)) * 2) / 3;
  value += ((160 * Math.sin((latitude / 12) * PI) + 320 * Math.sin((latitude * PI) / 30)) * 2) / 3;
  return value;
}

function transformLongitude(longitude: number, latitude: number) {
  let value = 300 + longitude + 2 * latitude + 0.1 * longitude * longitude;
  value += 0.1 * longitude * latitude + 0.1 * Math.sqrt(Math.abs(longitude));
  value += ((20 * Math.sin(6 * longitude * PI) + 20 * Math.sin(2 * longitude * PI)) * 2) / 3;
  value += ((20 * Math.sin(longitude * PI) + 40 * Math.sin((longitude / 3) * PI)) * 2) / 3;
  value += ((150 * Math.sin((longitude / 12) * PI) + 300 * Math.sin((longitude / 30) * PI)) * 2) / 3;
  return value;
}

function gcj02ToWgs84(longitude: number, latitude: number): [number, number] {
  if (outsideChina(longitude, latitude)) return [longitude, latitude];
  let deltaLatitude = transformLatitude(longitude - 105, latitude - 35);
  let deltaLongitude = transformLongitude(longitude - 105, latitude - 35);
  const radianLatitude = (latitude / 180) * PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  deltaLatitude = (deltaLatitude * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  deltaLongitude = (deltaLongitude * 180) / ((A / sqrtMagic) * Math.cos(radianLatitude) * PI);
  return [longitude * 2 - (longitude + deltaLongitude), latitude * 2 - (latitude + deltaLatitude)];
}

function bd09ToWgs84(point: Coordinates): [number, number] {
  const x = point.longitude - 0.0065;
  const y = point.latitude - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  const gcjLongitude = z * Math.cos(theta);
  const gcjLatitude = z * Math.sin(theta);
  return gcj02ToWgs84(gcjLongitude, gcjLatitude);
}

function placeIntroduction(item: ItineraryItem) {
  if (!item.place) return '';
  const location = item.place.address
    || [item.place.district, item.place.city].filter(Boolean).join('，');
  const category = item.place.category || '地点';
  const tags = item.place.content_tags.length > 0
    ? `百度地图将它标注为“${item.place.content_tags.join('、')}”。`
    : '';
  return `${item.place.name}是百度地图收录的${category}${location ? `，位于${location}` : ''}。${tags}`;
}

export function TripMapCanvas({
  items,
  routeLegs,
  activeId,
  onSelect,
}: {
  items: ItineraryItem[];
  routeLegs: RouteLeg[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const overlayRef = useRef<LayerGroup | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const fallbackUsedRef = useRef(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [tileWarning, setTileWarning] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === activeId && item.place) ?? null,
    [activeId, items],
  );

  useEffect(() => {
    setDetailOpen(Boolean(selectedItem));
  }, [selectedItem]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: [34.3, 108.9],
      zoom: 5,
      zoomControl: true,
      attributionControl: true,
    });
    const overlays = L.layerGroup().addTo(map);
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      crossOrigin: true,
    });
    let errors = 0;
    const activateFallback = () => {
      if (fallbackUsedRef.current) {
        setTileWarning('地图瓦片网络暂时不可用，地点与路线图层仍然保留。');
        return;
      }
      fallbackUsedRef.current = true;
      if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
      const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
        crossOrigin: true,
      });
      carto.on('load', () => {
        setTilesReady(true);
        setTileWarning('主瓦片源不可用，已自动切换备用底图。');
      });
      carto.on('tileerror', () => setTileWarning('地图瓦片网络暂时不可用，地点与路线图层仍然保留。'));
      baseLayerRef.current = carto.addTo(map);
    };
    osm.on('load', () => setTilesReady(true));
    osm.on('tileerror', () => {
      errors += 1;
      if (errors >= 3) activateFallback();
    });
    baseLayerRef.current = osm.addTo(map);
    mapRef.current = map;
    overlayRef.current = overlays;
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      baseLayerRef.current = null;
      fallbackUsedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const overlays = overlayRef.current;
    if (!map || !overlays) return;
    overlays.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    routeLegs.forEach((leg) => {
      if (leg.polyline.length < 2) return;
      const points = leg.polyline.map((point) => {
        const [longitude, latitude] = bd09ToWgs84(point);
        return [latitude, longitude] as [number, number];
      });
      bounds.push(...points);
      L.polyline(points, {
        color: leg.fact_state === 'stale' ? '#a9423a' : '#3f6b57',
        weight: 5,
        opacity: 0.88,
        dashArray: leg.fact_state === 'stale' ? '7 7' : undefined,
      }).bindTooltip(`${leg.summary} · ${leg.duration_minutes} 分钟`).addTo(overlays);
    });

    items.forEach((item, index) => {
      if (!item.place) return;
      const [longitude, latitude] = bd09ToWgs84(item.place.coordinates);
      const point: [number, number] = [latitude, longitude];
      bounds.push(point);
      const marker = L.marker(point, {
        title: item.title,
        icon: L.divIcon({
          className: 'trip-map-marker-shell',
          html: `<span class="trip-map-marker${item.id === activeId ? ' is-active' : ''}"><b>${index + 1}</b></span>`,
          iconSize: [34, 40],
          iconAnchor: [17, 36],
        }),
      });
      marker.bindTooltip(item.title, { direction: 'top', offset: [0, -26] });
      marker.on('click', () => {
        onSelect(item.id);
        setDetailOpen(true);
      });
      marker.addTo(overlays);
    });

    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [48, 48], maxZoom: 15 });
    else if (bounds.length === 1) map.setView(bounds[0], 14);
    else map.setView([34.3, 108.9], 5);
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [items, routeLegs, activeId, onSelect]);

  const hasPlaces = items.some((item) => item.place);
  return (
    <div className="trip-map-shell">
      <div ref={containerRef} className="trip-map-canvas" aria-label="行程基础地图、地点与路线" />
      {!tilesReady && !tileWarning && <div className="map-loading-chip" role="status">正在加载基础地图瓦片…</div>}
      {!hasPlaces && (
        <div className="map-empty-chip" role="status">
          <MapPin size={18} aria-hidden="true" />确认真实地点后，会在底图上叠加路线
        </div>
      )}
      {tileWarning && (
        <div className="map-warning-chip" role="status">
          <WarningCircle size={17} aria-hidden="true" />{tileWarning}
        </div>
      )}
      <div className="map-source-note">底图：OSM / CARTO · 地点与路线：百度地图 · BD-09 转 WGS84 仅用于显示</div>
      {detailOpen && selectedItem?.place && (
        <aside className="map-place-detail" aria-label={`${selectedItem.place.name}地点详情`}>
          <header>
            <div>
              <span>真实地点详情</span>
              <h3>{selectedItem.place.name}</h3>
              <p>{[selectedItem.place.category, selectedItem.place.district, selectedItem.place.city].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" onClick={() => setDetailOpen(false)} aria-label="关闭地点详情"><X size={19} /></button>
          </header>
          <div className="map-place-detail-scroll">
            {(selectedItem.place.overall_rating !== null && selectedItem.place.overall_rating !== undefined) && (
              <div className="place-rating"><Star size={17} weight="fill" /><strong>{selectedItem.place.overall_rating.toFixed(1)}</strong><span>百度地图评分</span>{selectedItem.place.comment_count !== null && selectedItem.place.comment_count !== undefined && <span>{selectedItem.place.comment_count} 条评价</span>}</div>
            )}
            {selectedItem.place.content_tags.length > 0 && <div className="place-tags">{selectedItem.place.content_tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
            <section>
              <h4>地点介绍</h4>
              <p>{placeIntroduction(selectedItem)}</p>
            </section>
            <section>
              <h4>为什么进入这版行程</h4>
              <p>{selectedItem.reason}</p>
            </section>
            <section>
              <h4>百度地图事实</h4>
              <dl className="place-facts">
                <div><dt>地址</dt><dd>{selectedItem.place.address || '供应商未返回'}</dd></div>
                <div><dt>开放时间</dt><dd>{selectedItem.place.opening_hours || '尚未核验'}</dd></div>
                <div><dt>电话</dt><dd>{selectedItem.place.telephone || '供应商未返回'}</dd></div>
                <div><dt>坐标</dt><dd>{selectedItem.place.coordinates.longitude.toFixed(6)}, {selectedItem.place.coordinates.latitude.toFixed(6)}（BD-09）</dd></div>
              </dl>
              {selectedItem.place.detail_url && <a className="place-source-link" href={selectedItem.place.detail_url} target="_blank" rel="noreferrer">查看百度地图地点页</a>}
            </section>
            {selectedItem.place.community_notes.length > 0 && (
              <section>
                <h4>小红书实际检索内容</h4>
                <div className="community-note-list">{selectedItem.place.community_notes.map((note, index) => (
                  <article key={`${String(note.url ?? '')}-${index}`}>
                    <strong>{String(note.title ?? `社区笔记 ${index + 1}`)}</strong>
                    {Boolean(note.excerpt) && <p>{String(note.excerpt)}</p>}
                    {Boolean(note.url) && <a href={String(note.url)} target="_blank" rel="noreferrer">打开原笔记</a>}
                  </article>
                ))}</div>
              </section>
            )}
            <footer>地点数据查询于 {new Date(selectedItem.place.observed_at).toLocaleString('zh-CN')} · 来源 {selectedItem.place.source}</footer>
          </div>
        </aside>
      )}
    </div>
  );
}
