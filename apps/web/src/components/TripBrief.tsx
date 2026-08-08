import { CalendarDots, Footprints, MapPin, UsersThree } from '@phosphor-icons/react';
import type { FieldValue, ThreadData, TripDetail, TripSpec } from '../types';

function valueText(value: FieldValue<unknown>, empty = '待补充'): string {
  if (value.value === null || value.value === undefined || value.value === '') return empty;
  if (Array.isArray(value.value)) {
    return value.value
      .map((item) => typeof item === 'string' ? item : (item as { relation?: string; name?: string }).relation ?? (item as { name?: string }).name)
      .filter(Boolean)
      .join('、') || empty;
  }
  if (typeof value.value === 'object') return (value.value as { name?: string }).name ?? empty;
  return String(value.value);
}

function stateLabel(state: FieldValue<unknown>['state']) {
  return {
    CONFIRMED: '已确认',
    INFERRED: '待确认',
    ASSUMED: '假设',
    MISSING: '缺少',
    CONFLICTED: '冲突',
  }[state];
}

function BriefRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: FieldValue<unknown> }) {
  return (
    <div className="brief-row">
      <Icon size={19} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{valueText(value)}</strong>
      </div>
      <em data-state={value.state}>{stateLabel(value.state)}</em>
    </div>
  );
}

export function TripBrief({ trip, thread }: { trip: TripDetail; thread?: ThreadData | null }) {
  const spec: TripSpec = trip.trip_spec;
  const dates: FieldValue<unknown> = {
    value: spec.start_date.value && spec.end_date.value ? `${spec.start_date.value} — ${spec.end_date.value}` : null,
    state: spec.start_date.state === 'CONFIRMED' && spec.end_date.state === 'CONFIRMED' ? 'CONFIRMED' : spec.start_date.state,
  };
  const rows = [
    { icon: MapPin, label: '目的地', value: spec.destination },
    { icon: CalendarDots, label: '日期或时长', value: dates.value ? dates : spec.duration_days },
    { icon: UsersThree, label: '同行人', value: spec.travelers },
    { icon: Footprints, label: '节奏', value: spec.pace },
    { icon: MapPin, label: '兴趣', value: spec.interests },
  ];
  const hasValue = (value: FieldValue<unknown>) => value.value !== null && value.value !== undefined && value.value !== '';
  const known = rows.filter((row) => hasValue(row.value) && row.value.state !== 'ASSUMED');
  const assumedRows = rows.filter((row) => hasValue(row.value) && row.value.state === 'ASSUMED');
  const later = [
    { label: '出发城市', value: spec.origin },
    { label: '具体日期', value: dates },
    { label: '预算', value: spec.budget },
    { label: '跨城交通', value: spec.transport_modes },
    { label: '特殊需求', value: spec.traveler_requirements },
  ].filter((item) => item.value.value === null || item.value.value === undefined || item.value.value === '');
  const readinessLabel = {
    not_ready: '还在了解方向',
    orientable: '可以先介绍目的地',
    draftable: '可生成初稿',
    executable: '可核验正式计划',
  }[String(thread?.conversation_state?.readiness?.level ?? '')] ?? '正在整理';
  return (
    <aside className="trip-brief paper-sheet" aria-label="本次旅程摘要">
      <div className="trip-brief-heading">
        <div>
          <p className="section-kicker">TRIP STATE</p>
          <h2>{trip.title}</h2>
        </div>
        <span className="pulse-badge">{readinessLabel}</span>
      </div>
      <section className="brief-section">
        <h3>目前已了解</h3>
        {known.map((row) => <BriefRow key={row.label} icon={row.icon} label={row.label} value={row.value} />)}
        {!known.length && <p className="brief-empty">还没有足够信息，先从目的地和大致天数开始。</p>}
      </section>
      <section className="brief-section brief-assumptions">
        <h3>当前假设</h3>
        {spec.assumptions.length > 0 || assumedRows.length > 0 ? (
          <ul>
            {assumedRows.map((row) => <li key={`field-${row.label}`}>{row.label}：{valueText(row.value)}</li>)}
            {spec.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
        ) : <p className="brief-empty">一切按你所说，暂无兜底假设。</p>}
      </section>
      <section className="brief-section brief-later">
        <h3>稍后可完善 <span>{later.length}</span></h3>
        {later.length ? <ul>{later.map((item) => <li key={item.label}>{item.label}</li>)}</ul> : <p className="brief-empty">当前没有明显缺口。</p>}
      </section>
    </aside>
  );
}
