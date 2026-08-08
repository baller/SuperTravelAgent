import { ArrowLeft, CheckCircle, Clock, Footprints, SkipForward, WarningCircle } from '@phosphor-icons/react';
import type { ItineraryItem, TripDetail } from '../types';

export function TodayMode({
  trip,
  onBack,
  onAction,
  onAskAgent,
}: {
  trip: TripDetail;
  onBack: () => void;
  onAction: (item: ItineraryItem, action: string, minutes?: number) => Promise<void>;
  onAskAgent: (message: string) => Promise<void>;
}) {
  const plan = trip.current_plan;
  const now = Date.now();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const day = plan?.days.find((item) => item.date === today);
  const firstDay = plan?.days[0];
  const lastDay = plan?.days.at(-1);
  const beforeTrip = Boolean(firstDay && today < firstDay.date);
  const pending = day?.items.filter((item) => item.status === 'PLANNED') ?? [];
  const current = pending.find((item) => new Date(item.end_at).getTime() >= now) ?? pending[0];
  const currentIndex = current ? pending.findIndex((item) => item.id === current.id) : -1;
  const next = currentIndex >= 0 ? pending[currentIndex + 1] : undefined;
  const leg = current && next ? day?.route_legs.find((item) => item.origin_item_id === current.id && item.destination_item_id === next.id) : undefined;
  return (
    <main className="today-mode">
      <button type="button" className="button-tertiary" onClick={onBack}><ArrowLeft size={18} />返回完整行程</button>
      <header>
        <p className="section-kicker">TODAY · {today}</p>
        <h1>{trip.title}</h1>
        <span className="pulse-badge">{trip.pulse}</span>
      </header>
      {!day ? (
        <section className="today-empty">
          <Clock size={32} />
          <h2>{beforeTrip ? '旅程尚未开始' : '这段旅程已经结束'}</h2>
          <p>
            {beforeTrip
              ? `Today Mode 将在 ${firstDay?.date ?? '出发日'} 启用。现在可以继续检查行程、天气和待决定事项。`
              : `计划日期已于 ${lastDay?.date ?? '此前'} 结束，可返回完整行程查看历史版本。`}
          </p>
        </section>
      ) : current ? (
        <section className="now-card">
          <div className="now-label">现在</div>
          <h2>{current.title}</h2>
          <p>{current.reason}</p>
          <div className="now-meta"><Clock size={18} />建议进行至 {new Date(current.end_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
          {day?.weather && <div className="now-meta"><WarningCircle size={18} />百度地图天气：{String(day.weather.text_day ?? day.weather.dayweather ?? day.weather.weather ?? '已取得预报')}</div>}
          {(current.locked || current.reservation_state === 'booked') && <div className="now-meta"><WarningCircle size={18} />这是锁定或已预约项目，普通重排不会移动它。</div>}
          <div className="today-actions">
            <button type="button" className="button-primary" onClick={() => onAction(current, 'COMPLETE')}><CheckCircle size={19} />完成</button>
            <button type="button" className="button-secondary" onClick={() => onAction(current, 'DELAY', 30)}><Clock size={19} />延迟 30 分钟</button>
            <button type="button" className="button-tertiary" onClick={() => onAction(current, 'SKIP')} disabled={current.locked || current.reservation_state === 'booked'}><SkipForward size={19} />跳过</button>
          </div>
        </section>
      ) : (
        <section className="today-empty"><CheckCircle size={32} /><h2>今天的已计划事项已经完成</h2></section>
      )}
      {day && next && (
        <section className="next-card">
          <span>下一站</span><h3>{next.title}</h3>
          {leg ? <p><Footprints size={18} />{leg.summary} · {leg.duration_minutes} 分钟；建议 {new Date(current!.end_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 离开</p> : <p><WarningCircle size={18} />真实路线尚不可用</p>}
        </section>
      )}
      {day && <section className="quick-feedback">
        <h2>遇到变数？立刻呼叫动态护航</h2>
        <div>
          <button type="button" onClick={() => onAskAgent('我有点累了，请只重排今天尚未完成的余程，减少步行并保留锁定项目。')}>我累了</button>
          <button type="button" onClick={() => onAskAgent('现在下雨了，请检查今天尚未完成的户外行程并准备室内 Plan B。')}>下雨了</button>
          <button type="button" onClick={() => onAskAgent('我们比计划晚了，请只重排今天剩余行程并保护已预约项目。')}>我们晚了</button>
        </div>
      </section>}
    </main>
  );
}
