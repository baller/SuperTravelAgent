import { ArrowRight, BellRinging, CheckCircle } from '@phosphor-icons/react';
import type { TripSummary } from '../types';

export function DecisionCenter({ trips, onOpenTrip }: { trips: TripSummary[]; onOpenTrip: (tripId: string) => Promise<void> }) {
  const pending = trips.filter((item) => item.pending_decisions > 0);
  return (
    <main id="main-content" className="standalone-page decision-center">
      <header><span>待决定</span><h1>把排雷交给我们，把决定权交给你</h1><p>遇到突发变故，动态护航系统会先在后台计算 Plan B，只在真正需要你拍板时出现。</p></header>
      <section>
        {pending.map((item) => <button type="button" key={item.id} onClick={() => onOpenTrip(item.id)}><BellRinging size={23} /><div><small>{item.pulse}</small><strong>{item.title}</strong><span>{item.pending_decisions} 项等待处理</span></div><ArrowRight size={21} /></button>)}
        {pending.length === 0 && <div className="decision-empty"><CheckCircle size={36} weight="duotone" /><strong>一切尽在掌控，暂无意外发生</strong><p>所有已知风险皆已兜底，静默巡航中，请放心体验。</p></div>}
      </section>
    </main>
  );
}
