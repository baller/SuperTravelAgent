import {
  CheckCircle,
  Clock,
  CurrencyCny,
  Footprints,
  LockSimple,
  MapPin,
  SkipForward,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ItineraryItem, TripDay } from '../types';

function time(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00:00+08:00`));
}

export function Timeline({
  day,
  activeId,
  onSelect,
  onAction,
}: {
  day: TripDay;
  activeId?: string;
  onSelect: (id: string) => void;
  onAction: (item: ItineraryItem, action: string, minutes?: number) => void;
}) {
  return (
    <section className="timeline-panel" aria-label={`第 ${day.day_index} 天行程`}>
      <header className="timeline-heading">
        <div>
          <p className="section-kicker">DAY {String(day.day_index).padStart(2, '0')}</p>
          <h2>{day.title}</h2>
          <span>{dateLabel(day.date)}</span>
        </div>
        {day.weather && (
          <div className="weather-note">
            <strong>{day.weather.text_day ?? day.weather.dayweather ?? '天气待核验'}</strong>
            <span>{day.weather.high ? `最高 ${day.weather.high}℃` : '百度地图天气'}</span>
          </div>
        )}
      </header>
      <div className="timeline-list">
        {day.items.map((item, index) => {
          const leg = index > 0 ? day.route_legs[index - 1] : null;
          return (
            <div key={item.id}>
              {leg && (
                <div className={`route-leg ${leg.fact_state === 'stale' ? 'is-stale' : ''}`}>
                  <Footprints size={17} aria-hidden="true" />
                  <span>{leg.summary}</span>
                  <strong>{leg.duration_minutes} 分钟 · {(leg.distance_meters / 1000).toFixed(1)} km</strong>
                  <em>{leg.fact_state === 'live' ? '实时路线' : leg.fact_state === 'cached' ? '缓存路线' : '已过期'}</em>
                </div>
              )}
              <article
                className={`itinerary-card ${activeId === item.id ? 'is-active' : ''} is-${item.status.toLowerCase()}`}
                id={`item-${item.id}`}
              >
                <button type="button" className="itinerary-card-main" onClick={() => onSelect(item.id)}>
                  <div className="itinerary-time"><strong>{time(item.start_at)}</strong><span>{time(item.end_at)}</span></div>
                  <div className="itinerary-body">
                    <div className="itinerary-title-row">
                      <span className="stop-number">{index + 1}</span>
                      <h3>{item.title}</h3>
                      {item.locked && <LockSimple size={17} weight="fill" aria-label="已锁定" />}
                      {item.status === 'COMPLETED' && <CheckCircle size={18} weight="fill" aria-label="已完成" />}
                    </div>
                    <p>{item.reason}</p>
                    <div className="item-meta">
                      <span><MapPin size={15} />{item.place?.district ?? item.category}</span>
                      <span><Clock size={15} />{Math.round((new Date(item.end_at).getTime() - new Date(item.start_at).getTime()) / 60000)} 分钟</span>
                      <span><CurrencyCny size={15} />{item.cost_cny == null ? '费用未知' : `¥${item.cost_cny}`}</span>
                    </div>
                    <div className="source-line">
                      {item.source} · {item.opening_state === 'verified' ? '开放状态已核验' : '开放时间待核验'}
                    </div>
                  </div>
                </button>
                <div className="item-actions" aria-label={`${item.title} 操作`}>
                  <button type="button" onClick={() => onAction(item, 'COMPLETE')} disabled={item.status === 'COMPLETED'}><CheckCircle size={17} />完成</button>
                  <button type="button" onClick={() => onAction(item, 'SKIP')} disabled={item.locked}><SkipForward size={17} />跳过</button>
                  <button type="button" onClick={() => onAction(item, item.locked ? 'UNLOCK' : 'LOCK')}><LockSimple size={17} />{item.locked ? '解锁' : '锁定'}</button>
                </div>
              </article>
            </div>
          );
        })}
        {day.items.length === 0 && (
          <div className="timeline-empty"><WarningCircle size={26} /><strong>当天还没有可执行地点</strong></div>
        )}
      </div>
    </section>
  );
}
