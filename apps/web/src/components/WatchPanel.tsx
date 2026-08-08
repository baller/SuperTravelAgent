import { BellRinging, CheckCircle, Clock, Train, WarningCircle } from '@phosphor-icons/react';
import type { Decision, Watch } from '../types';

function dateTime(value?: string | null) {
  if (!value) return '尚未检查';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function WatchPanel({
  watches,
  decisions,
  onResolve,
}: {
  watches: Watch[];
  decisions: Decision[];
  onResolve: (decisionId: string, optionId: string) => Promise<void>;
}) {
  return (
    <div className="watch-panel">
      <section>
        <div className="panel-heading"><BellRinging size={20} /><div><strong>需要你决定</strong><span>{decisions.filter((item) => item.state === 'OPEN').length} 项待处理</span></div></div>
        <div className="decision-list">
          {decisions.filter((item) => item.state === 'OPEN').map((decision) => (
            <article key={decision.id} className={`decision-card risk-${decision.risk_level.toLowerCase()}`}>
              <div><WarningCircle size={19} /><strong>{decision.title}</strong></div>
              <p>{decision.detail}</p>
              <div className="decision-actions">
                {decision.options.map((option) => (
                  <button key={option.id} type="button" onClick={() => onResolve(decision.id, option.id)} className={option.id === decision.recommended_option ? 'is-recommended' : ''}>{option.label}</button>
                ))}
              </div>
            </article>
          ))}
          {!decisions.some((item) => item.state === 'OPEN') && <div className="quiet-state"><CheckCircle size={22} /><span>目前没有需要你决定的事项</span></div>}
        </div>
      </section>
      <section>
        <div className="panel-heading"><Clock size={20} /><div><strong>静默巡航中</strong><span>后台动态护航</span></div></div>
        <div className="watch-list">
          {watches.map((watch) => (
            <article key={watch.id}>
              {watch.type === 'RAIL' ? <Train size={19} /> : <BellRinging size={19} />}
              <div><strong>{watch.type === 'WEATHER' ? '目的地天气' : '铁路信息'}</strong><span>{watch.state} · 上次 {dateTime(watch.last_checked_at)}</span></div>
              <em>下次 {dateTime(watch.next_check_at)}</em>
            </article>
          ))}
          {watches.length === 0 && <div className="quiet-state"><Clock size={22} /><span>行程确定后，将自动开启全天候巡航与兜底</span></div>}
        </div>
      </section>
    </div>
  );
}

