import {
  Archive,
  ArrowDown,
  CalendarDots,
  Check,
  ChatsCircle,
  CurrencyCircleDollar,
  Gauge,
  GitDiff,
  CaretDown,
  CheckCircle,
  MapPin,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Robot,
  StopCircle,
  Trash,
  UsersThree,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownContent } from './MarkdownContent';
import type { AgentActivityEventData, AgentRunData, RunProcessStep, RunStatus, SourceRecordData, ThreadData, ThreadSummary, UIComponentData } from '../types';

function today(offset = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
}

function railOptionTitle(option: Record<string, unknown>, index: number): string {
  return String(option.label ?? option.title ?? option.name ?? option.train_code ?? option.start_train_code ?? `选项 ${index + 1}`);
}

function railOptionDetail(option: Record<string, unknown>): string {
  const route = [option.departure_station ?? option.from_station, option.arrival_station ?? option.to_station]
    .filter(Boolean)
    .map(String)
    .join(' → ');
  const times = option.departure_time && option.arrival_time
    ? `${String(option.departure_time)}—${String(option.arrival_time)}`
    : '';
  const duration = option.duration ?? option.lishi;
  const seatPrice = [option.seat, option.price != null ? `¥${String(option.price)}` : null]
    .filter(Boolean)
    .map(String)
    .join(' · ');
  const features = Array.isArray(option.features) ? option.features.map(String).join(' · ') : '';
  return [option.detail ?? option.description, route, times, duration, seatPrice, features]
    .filter(Boolean)
    .map(String)
    .join(' · ');
}

function ComponentCard({
  component,
  onSubmit,
}: {
  component: UIComponentData;
  onSubmit: (component: UIComponentData, value: Record<string, unknown>) => Promise<void>;
}) {
  const savedValue = component.value ?? {};
  const [submitting, setSubmitting] = useState(false);
  const [startDate, setStartDate] = useState(String(savedValue.start_date ?? today(14)));
  const [endDate, setEndDate] = useState(String(savedValue.end_date ?? today(16)));
  const [budgetMode, setBudgetMode] = useState(String(savedValue.budget_mode ?? 'estimate'));
  const [budget, setBudget] = useState(savedValue.budget == null ? '' : String(savedValue.budget));
  const [pace, setPace] = useState(String(savedValue.pace ?? '适中'));
  const [interests, setInterests] = useState<string[]>(() => (
    Array.isArray(savedValue.interests) ? savedValue.interests.map(String) : []
  ));
  const [planningScope, setPlanningScope] = useState<'local_only' | 'door_to_door'>(
    savedValue.planning_scope === 'door_to_door' ? 'door_to_door' : 'local_only',
  );
  const [origin, setOrigin] = useState(String(savedValue.origin ?? ''));
  const [transportModes, setTransportModes] = useState<string[]>(() => (
    Array.isArray(savedValue.transport_modes) ? savedValue.transport_modes.map(String) : []
  ));
  const [travelerNeeds, setTravelerNeeds] = useState<string[]>(() => (
    Array.isArray(savedValue.requirements) ? savedValue.requirements.map(String) : []
  ));
  const [customTravelerNeed, setCustomTravelerNeed] = useState('');
  const [mustVisit, setMustVisit] = useState('');
  const [avoid, setAvoid] = useState('');
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>(() => (
    ((component.props.required_ids ?? []) as unknown[]).map(String)
  ));
  const interactive = ['PRESENTED', 'CREATED'].includes(component.state);

  const submit = async (value: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await onSubmit(component, value);
    } finally {
      setSubmitting(false);
    }
  };

  if (component.type === 'destination_disambiguation') {
    const options = (component.props.options ?? []) as Array<Record<string, unknown>>;
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><MapPin size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        {Boolean(component.props.source_notice) && <p className="component-source-note">{String(component.props.source_notice)}</p>}
        <div className="destination-options">
          {options.map((option) => (
            <button
              key={String(option.provider_place_id)}
              type="button"
              disabled={!interactive || submitting}
              onClick={() => submit({ option })}
            >
              <strong>{String(option.name)}</strong>
              <span>{[option.city, option.district].filter(Boolean).map(String).join(' · ') || '百度地图地点'}</span>
            </button>
          ))}
        </div>
        {!interactive && <p className="component-resolved"><Check size={17} />已处理</p>}
      </section>
    );
  }

  if (component.type === 'decision_options' || component.type === 'rail_options') {
    const options = (component.props.options ?? []) as Array<Record<string, unknown>>;
    const selectedOption = asRecord(savedValue.option);
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><CheckCircle size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="destination-options">
          {options.map((option, index) => (
            <button
              key={String(option.id ?? index)}
              type="button"
              className={selectedOption?.id === option.id ? 'is-selected' : ''}
              disabled={!interactive || submitting}
              onClick={() => submit({ option })}
            >
              <strong>{component.type === 'rail_options' ? railOptionTitle(option, index) : String(option.label ?? option.title ?? option.name ?? `选项 ${index + 1}`)}</strong>
              {Boolean(component.type === 'rail_options' ? railOptionDetail(option) : (option.detail ?? option.description)) && (
                <span>{component.type === 'rail_options' ? railOptionDetail(option) : String(option.detail ?? option.description)}</span>
              )}
            </button>
          ))}
        </div>
        {!interactive && <p className="component-resolved"><Check size={17} />已处理</p>}
      </section>
    );
  }

  if (component.type === 'quick_choice') {
    const options = (component.props.options ?? []) as Array<Record<string, unknown>>;
    const selectedOption = asRecord(savedValue.option);
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><CheckCircle size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <p className="component-source-note">选择一个最接近的范围即可，具体日期之后仍可以调整。</p>
        <div className="choice-grid">
          {options.map((option, index) => (
            <button
              key={String(option.id ?? index)}
              type="button"
              className={selectedOption?.id === option.id ? 'is-selected' : ''}
              disabled={!interactive || submitting}
              onClick={() => submit({ option })}
            >
              {String(option.label ?? `选项 ${index + 1}`)}
            </button>
          ))}
        </div>
        {!interactive && <p className="component-resolved"><Check size={17} />已处理</p>}
      </section>
    );
  }

  if (component.type === 'date_range_picker') {
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><CalendarDots size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="date-fields">
          <label>出发日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={!interactive} /></label>
          <label>结束日期<input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={!interactive} /></label>
        </div>
        {interactive ? (
          <button type="button" className="button-primary" disabled={submitting || endDate < startDate} onClick={() => submit({ start_date: startDate, end_date: endDate })}>
            <Check size={18} />确认日期
          </button>
        ) : <p className="component-resolved"><Check size={17} />已确认 {startDate} — {endDate}</p>}
      </section>
    );
  }

  if (component.type === 'traveler_selector') {
    const options = (component.props.options ?? []) as Array<{ id: string; label: string; travelers: Array<Record<string, unknown>> }>;
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><UsersThree size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="choice-grid">
          {options.map((option) => (
            <button key={option.id} type="button" disabled={!interactive || submitting} onClick={() => submit({ travelers: option.travelers })}>
              {option.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (component.type === 'origin_transport_selector') {
    const options = (component.props.options ?? []) as Array<{ id: 'local_only' | 'door_to_door'; label: string; detail: string }>;
    const modes = (component.props.transport_modes ?? []) as Array<{ id: string; label: string }>;
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><MapPin size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="destination-options">
          {options.map((option) => (
            <button key={option.id} type="button" className={planningScope === option.id ? 'is-selected' : ''} disabled={!interactive} onClick={() => setPlanningScope(option.id)}>
              <strong>{option.label}</strong><span>{option.detail}</span>
            </button>
          ))}
        </div>
        {planningScope === 'door_to_door' && (
          <div className="component-form-stack">
            <label>从哪里出发<input value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="例如：上海" disabled={!interactive} /></label>
            <fieldset><legend>跨城交通偏好</legend><div className="choice-grid">{modes.map((mode) => (
              <button key={mode.id} type="button" className={transportModes.includes(mode.id) ? 'is-selected' : ''} disabled={!interactive} onClick={() => setTransportModes((current) => current.includes(mode.id) ? current.filter((item) => item !== mode.id) : [...current, mode.id])}>{mode.label}</button>
            ))}</div></fieldset>
          </div>
        )}
        <button type="button" className="button-primary" disabled={!interactive || submitting || (planningScope === 'door_to_door' && (!origin.trim() || !transportModes.length))} onClick={() => submit({ planning_scope: planningScope, origin: planningScope === 'door_to_door' ? origin.trim() : null, transport_modes: planningScope === 'door_to_door' ? transportModes : ['local'] })}>
          <Check size={18} />确认规划范围
        </button>
      </section>
    );
  }

  if (component.type === 'traveler_needs_selector') {
    const options = (component.props.options ?? []) as string[];
    const addCustom = () => {
      const value = customTravelerNeed.trim();
      if (value && !travelerNeeds.includes(value)) setTravelerNeeds((current) => [...current, value]);
      setCustomTravelerNeed('');
    };
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><UsersThree size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="choice-grid">{options.map((option) => <button key={option} type="button" className={travelerNeeds.includes(option) ? 'is-selected' : ''} disabled={!interactive} onClick={() => setTravelerNeeds((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])}>{option}</button>)}</div>
        <div className="inline-custom-field"><label htmlFor={`traveler-need-${component.id}`}>其他需要</label><input id={`traveler-need-${component.id}`} value={customTravelerNeed} onChange={(event) => setCustomTravelerNeed(event.target.value)} disabled={!interactive} placeholder="例如：对海鲜过敏" /><button type="button" onClick={addCustom} disabled={!interactive || !customTravelerNeed.trim()}>添加</button></div>
        {travelerNeeds.length > 0 && <p className="selected-summary">已选择：{travelerNeeds.join('、')}</p>}
        <button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ requirements: travelerNeeds })}><Check size={18} />{travelerNeeds.length ? '确认这些需要' : '没有特别需要'}</button>
      </section>
    );
  }

  if (component.type === 'budget_selector') {
    const options = (component.props.options ?? []) as Array<{ id: string; label: string; budget_mode: string; needs_amount?: boolean }>;
    const selected = options.find((option) => option.budget_mode === budgetMode);
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><CurrencyCircleDollar size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="choice-grid">
          {options.map((option) => (
            <button key={option.id} type="button" className={budgetMode === option.budget_mode ? 'is-selected' : ''} disabled={!interactive} onClick={() => setBudgetMode(option.budget_mode)}>{option.label}</button>
          ))}
        </div>
        {selected?.needs_amount && <label className="budget-input">总预算（元）<input type="number" min="1" step="100" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>}
        <button type="button" className="button-primary" disabled={!interactive || submitting || Boolean(selected?.needs_amount && !budget)} onClick={() => submit({ budget_mode: budgetMode, budget: budget ? Number(budget) : null })}>
          <Check size={18} />确认预算方式
        </button>
      </section>
    );
  }

  if (component.type === 'pace_interest_selector') {
    const paces = (component.props.paces ?? []) as string[];
    const interestOptions = (component.props.interests ?? []) as string[];
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><Gauge size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <p className="choice-label">旅行节奏</p>
        <div className="choice-grid">{paces.map((option) => <button key={option} type="button" className={pace === option ? 'is-selected' : ''} disabled={!interactive} onClick={() => setPace(option)}>{option}</button>)}</div>
        <p className="choice-label">更关注</p>
        <div className="choice-grid">{interestOptions.map((option) => <button key={option} type="button" className={interests.includes(option) ? 'is-selected' : ''} disabled={!interactive} onClick={() => setInterests((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])}>{option}</button>)}</div>
        <button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ pace, interests })}><Check size={18} />确认偏好</button>
      </section>
    );
  }

  if (component.type === 'trip_priorities_selector') {
    const split = (value: string) => value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean);
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><MapPin size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <p className="component-source-note">{String(component.props.notice ?? '')}</p>
        <div className="component-form-stack">
          <label>必须去或必须保留<input value={mustVisit} onChange={(event) => setMustVisit(event.target.value)} disabled={!interactive} placeholder="没有可留空；多个地点用逗号分隔" /></label>
          <label>一定要避开<input value={avoid} onChange={(event) => setAvoid(event.target.value)} disabled={!interactive} placeholder="例如：排长队、爬山；没有可留空" /></label>
        </div>
        <button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ must_visit: split(mustVisit), avoid: split(avoid) })}><Check size={18} />确认取舍</button>
      </section>
    );
  }

  if (component.type === 'place_candidates') {
    const options = (component.props.options ?? []) as Array<Record<string, unknown>>;
    const requiredIds = new Set(((component.props.required_ids ?? []) as unknown[]).map(String));
    const toggle = (id: string) => setSelectedPlaces((current) => current.includes(id) ? (requiredIds.has(id) ? current : current.filter((item) => item !== id)) : [...current, id]);
    return (
      <section className="agent-component place-candidate-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><MapPin size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <p className="component-source-note">{String(component.props.source_notice ?? '')}</p>
        <div className="candidate-check-list">
          {options.map((option, index) => {
            const id = String(option.id ?? option.provider_place_id ?? index);
            const checked = selectedPlaces.includes(id);
            return <label key={id} className={checked ? 'is-selected' : ''}><input type="checkbox" checked={checked} disabled={!interactive || requiredIds.has(id)} onChange={() => toggle(id)} /><span><strong>{String(option.label ?? option.name)}</strong><small>{String(option.detail ?? '')}</small></span>{requiredIds.has(id) && <em>必去</em>}</label>;
          })}
        </div>
        <button type="button" className="button-primary" disabled={!interactive || submitting || !selectedPlaces.length} onClick={() => submit({ selected_ids: selectedPlaces })}><Check size={18} />用这 {selectedPlaces.length} 个地点排程</button>
      </section>
    );
  }

  if (['rail_options', 'decision_options'].includes(component.type)) {
    const options = (component.props.options ?? []) as Array<Record<string, unknown>>;
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><MapPin size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        {Boolean(component.props.source_notice) && <p className="component-source-note">{String(component.props.source_notice)}</p>}
        <div className="destination-options">
          {options.map((option, index) => <button key={String(option.id ?? option.provider_place_id ?? index)} type="button" disabled={!interactive || submitting} onClick={() => submit({ option })}><strong>{component.type === 'rail_options' ? railOptionTitle(option, index) : String(option.label ?? option.name ?? `选项 ${index + 1}`)}</strong><span>{component.type === 'rail_options' ? railOptionDetail(option) : String(option.detail ?? option.summary ?? '')}</span></button>)}
        </div>
      </section>
    );
  }

  if (component.type === 'preference_confirmation') {
    const preferenceValue = component.props.value as Record<string, unknown> | undefined;
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><Check size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="preference-candidate">
          <strong>{String(component.props.key)}</strong>
          <span>{preferenceValue ? Object.values(preferenceValue).map(String).join(' · ') : ''}</span>
          <p>依据：{String(component.props.evidence)}</p>
        </div>
        <p className="component-source-note">{String(component.props.notice ?? '')}</p>
        <div className="component-actions">
          <button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ action: 'confirm' })}>保存为长期偏好</button>
          <button type="button" className="button-tertiary" disabled={!interactive || submitting} onClick={() => submit({ action: 'reject' })}>仅用于本次</button>
        </div>
      </section>
    );
  }

  if (component.type === 'assumption_confirmation') {
    const assumptions = ((component.props.assumptions ?? []) as unknown[])
      .map((item, index) => {
        const record = asRecord(item);
        const text = typeof item === 'string'
          ? item
          : String(record?.text ?? record?.label ?? '');
        return {
          id: String(record?.id ?? index),
          text,
          status: record?.status ? String(record.status) : undefined,
        };
      })
      .filter((item) => item.text);
    const missingFields = ((component.props.missing_fields ?? []) as unknown[])
      .map((item, index) => {
        const record = asRecord(item);
        return {
          id: String(record?.key ?? index),
          label: typeof item === 'string' ? item : String(record?.label ?? record?.key ?? ''),
          required: Boolean(record?.required),
        };
      })
      .filter((item) => item.label);
    const statusLabels: Record<string, string> = {
      CONFIRMED: '已确认',
      INFERRED: '根据表述推断',
      ASSUMED: '临时假设',
      MISSING: '待补充',
      CONFLICTED: '有冲突',
    };
    return (
      <section className="agent-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><Check size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <ul className="assumption-list">
          {assumptions.map((assumption) => (
            <li key={assumption.id}>
              <span>{assumption.text}</span>
              {assumption.status && <em data-status={assumption.status}>{statusLabels[assumption.status] ?? assumption.status}</em>}
            </li>
          ))}
        </ul>
        {missingFields.length > 0 && (
          <div className="assumption-missing">
            <strong>接下来还会确认</strong>
            <p>{missingFields.map((field) => `${field.label}${field.required ? '（必填）' : ''}`).join('、')}</p>
          </div>
        )}
        <div className="component-actions"><button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ action: 'confirm' })}>按这些假设继续</button><button type="button" className="button-tertiary" disabled={!interactive || submitting} onClick={() => submit({ action: 'revise' })}>我要补充</button></div>
      </section>
    );
  }

  if (component.type === 'plan_preview') {
    const plan = component.props.plan as { days?: Array<{ day_index: number; date: string; title: string; items: Array<{ id: string; title: string }> }>; conflicts?: Array<{ level: string; title: string }> };
    const blocking = plan.conflicts?.filter((item) => item.level === 'blocking').length ?? 0;
    return (
      <section className="agent-component plan-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><GitDiff size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <div className="plan-preview-days">
          {plan.days?.map((day) => (
            <div key={day.day_index}>
              <strong>第 {day.day_index} 天 · {day.title}</strong>
              <span>{day.date} · {day.items.map((item) => item.title).join(' → ') || '无地点'}</span>
            </div>
          ))}
        </div>
        {blocking > 0 && <p className="blocking-note"><WarningCircle size={18} />仍有 {blocking} 个阻断项，确认后也不会标记为“基本就绪”。</p>}
        <div className="component-actions">
          <button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ action: 'apply' })}>应用为首版计划</button>
          <button type="button" className="button-tertiary" disabled={!interactive || submitting} onClick={() => submit({ action: 'reject' })}>先不应用</button>
        </div>
      </section>
    );
  }

  if (component.type === 'plan_patch_preview') {
    const patch = component.props.patch as { reason?: string; operations?: Array<{ op: string; item_id?: string }>; impact?: { changed_days?: number[]; added?: string[]; removed?: string[]; moved?: string[]; protected?: string[] } };
    return (
      <section className="agent-component plan-component" aria-labelledby={`component-${component.id}`}>
        <div className="component-heading"><GitDiff size={21} /><h3 id={`component-${component.id}`}>{String(component.props.title)}</h3></div>
        <p>{patch.reason}</p>
        <dl className="patch-impact">
          <div><dt>影响日期</dt><dd>{patch.impact?.changed_days?.map((day) => `第 ${day} 天`).join('、') || '待校验'}</dd></div>
          <div><dt>新增</dt><dd>{patch.impact?.added?.join('、') || '无'}</dd></div>
          <div><dt>移除</dt><dd>{patch.impact?.removed?.join('、') || '无'}</dd></div>
          <div><dt>移动</dt><dd>{patch.impact?.moved?.join('、') || '无'}</dd></div>
          <div><dt>保持保护</dt><dd>{patch.impact?.protected?.join('、') || '无受影响项目'}</dd></div>
        </dl>
        <div className="component-actions">
          <button type="button" className="button-primary" disabled={!interactive || submitting} onClick={() => submit({ action: 'apply' })}>应用调整</button>
          <button type="button" className="button-tertiary" disabled={!interactive || submitting} onClick={() => submit({ action: 'reject' })}>保留原计划</button>
        </div>
      </section>
    );
  }

  return null;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function resultItems(value: unknown): string[] {
  const recordValue = asRecord(value);
  const nestedRows = recordValue
    ? ['results', 'places', 'pois', 'notes', 'trains', 'routes', 'items', 'stations', 'forecasts']
      .map((key) => recordValue[key])
      .find(Array.isArray)
    : undefined;
  const rows = Array.isArray(value) ? value : nestedRows ?? (recordValue ? [recordValue] : []);
  return rows.slice(0, 6).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return typeof item === 'string' ? [item] : [];
    if (record.error) return [`未完成 · ${String(record.error)}`];
    if (record.date && (record.text_day || record.text_night)) {
      const temperature = record.low !== undefined && record.high !== undefined
        ? `${String(record.low)}–${String(record.high)}℃`
        : '';
      const weather = [record.text_day, record.text_night]
        .filter(Boolean)
        .map(String)
        .filter((entry, entryIndex, entries) => entries.indexOf(entry) === entryIndex)
        .join('转');
      return [`${String(record.date)} · ${weather}${temperature ? ` · ${temperature}` : ''}`];
    }
    if (record.mode && (record.duration_seconds !== undefined || record.distance_meters !== undefined)) {
      const duration = Number(record.duration_seconds || 0) > 0 ? `${Math.round(Number(record.duration_seconds) / 60)} 分钟` : '';
      const distance = Number(record.distance_meters || 0) > 0 ? `${(Number(record.distance_meters) / 1000).toFixed(1)} 公里` : '';
      const routeSummary = [String(record.mode), duration, distance].filter(Boolean).join(' · ');
      return [routeSummary];
    }
    const title = record.title ?? record.name ?? record.label ?? record.train_code ?? record.station_name;
    const detail = record.address ?? record.district ?? record.description ?? record.snippet
      ?? record.departure_time ?? record.weather ?? record.status;
    if (!title && !detail) return [];
    return [`${title ? String(title) : ''}${title && detail ? ' · ' : ''}${detail ? String(detail) : ''}`];
  });
}

function toolQuerySummary(step: RunProcessStep): string | null {
  const args = step.arguments;
  if (!args) return null;
  const fields = [
    ['query', '关键词'],
    ['keyword', '关键词'],
    ['place_name', '地点'],
    ['origin', '出发地'],
    ['destination', '目的地'],
    ['from', '出发地'],
    ['to', '目的地'],
    ['start_date', '开始日期'],
    ['end_date', '结束日期'],
    ['date', '日期'],
    ['city', '城市'],
    ['region', '区域'],
    ['address', '地址'],
    ['mode', '方式'],
  ] as const;
  const values = fields
    .filter(([key]) => args[key] !== undefined && args[key] !== null && String(args[key]).trim())
    .map(([key, label]) => `${label}：${String(args[key])}`);
  return values.length ? values.join(' · ') : '已按当前旅行上下文查询';
}

function cacheStateLabel(value: RunProcessStep['cache_state']): string | null {
  return value === 'cached' ? '复用了缓存结果' : value === 'stale' ? '使用了过期缓存并标记待核验' : value === 'live' ? '刚从真实服务取得' : null;
}

function SourceLinks({ sources }: { sources: SourceRecordData[] }) {
  if (!sources.length) return null;
  const unique = Array.from(new Map(sources.map((source) => [source.id, source])).values());
  return (
    <div className="process-source-links" aria-label="本步骤真实来源">
      {unique.map((source) => source.canonical_url ? (
        <a key={source.id} href={source.canonical_url} target="_blank" rel="noreferrer" title={source.snippet || source.title}>
          {source.publisher || source.provider} · {source.title}
        </a>
      ) : (
        <span key={source.id} title={source.snippet || source.title}>{source.publisher || source.provider} · {source.title}</span>
      ))}
    </div>
  );
}

function ProcessEntry({ step, index }: { step: RunProcessStep; index: number }) {
  const rows = resultItems(step.result);
  const stateText = step.status === 'running' ? '正在进行' : step.status === 'waiting' ? '等待确认' : step.status === 'failed' ? '未完成' : '已完成';
  return (
    <li className={`public-process-step is-${step.kind} is-${step.status}`}>
      <span className="public-process-index" aria-hidden="true">{step.status === 'completed' ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>
      <details open={step.kind === 'tool' || step.status === 'running' || step.status === 'waiting'}>
        <summary>
          <span><small>{stateText}</small><strong>{step.label}</strong></span>
          <CaretDown size={14} aria-hidden="true" />
        </summary>
        <div>
          {step.detail && <p>{step.detail}</p>}
          {step.kind === 'tool' && toolQuerySummary(step) && <p><strong>查询内容：</strong>{toolQuerySummary(step)}</p>}
          {step.kind === 'tool' && step.result_count !== null && step.result_count !== undefined && <p>获得 {step.result_count} 条可用结果。</p>}
          {step.kind === 'tool' && cacheStateLabel(step.cache_state) && <p><strong>数据状态：</strong>{cacheStateLabel(step.cache_state)}</p>}
          {rows.length > 0 && <ul>{rows.map((row, rowIndex) => <li key={`${row}-${rowIndex}`}>{row}</li>)}</ul>}
          <SourceLinks sources={step.sources || []} />
          <time>{new Date(step.occurred_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </details>
    </li>
  );
}

function activityTitle(activity: AgentActivityEventData): string {
  const name = String(activity.detail?.name ?? '');
  const labels: Record<string, string> = {
    map_search_places: '查找真实地点',
    map_place_details: '核验地点详情',
    map_geocode: '解析地理位置',
    map_directions: '检查相邻路线',
    map_weather: '核对天气',
    'query-tickets': '查询车次',
    web_search: '搜索公开资料',
    web_fetch: '阅读公开资料',
    xhs_search_notes: '整理社区体验',
    xhs_get_note_content: '阅读社区笔记',
  };
  return labels[name] ?? activity.title;
}

function ActivityEntry({ activity, index }: { activity: AgentActivityEventData; index: number }) {
  const detail = activity.detail ?? {};
  const argumentsValue = detail.arguments;
  const query = argumentsValue && typeof argumentsValue === 'object'
    ? toolQuerySummary({
      id: activity.activity_id,
      kind: 'tool',
      label: activityTitle(activity),
      detail: activity.summary ?? '',
      status: activity.status === 'waiting' ? 'waiting' : activity.status === 'failed' ? 'failed' : activity.status === 'running' ? 'running' : 'completed',
      occurred_at: activity.created_at,
      result: detail.result,
      result_count: typeof detail.result_count === 'number' ? detail.result_count : null,
      arguments: argumentsValue as Record<string, unknown>,
      sources: Array.isArray(detail.sources) ? detail.sources as SourceRecordData[] : [],
    })
    : null;
  const stateText = activity.status === 'running' ? '进行中' : activity.status === 'waiting' ? '等待确认' : activity.status === 'failed' ? '未完成' : activity.status === 'cancelled' ? '已停止' : '已完成';
  return (
    <li className={`public-process-step activity-step is-${activity.kind} is-${activity.status}`}>
      <span className="public-process-index" aria-hidden="true">{activity.status === 'completed' ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>
      <details open={activity.status === 'running' || activity.status === 'waiting'}>
        <summary>
          <span><small>{stateText}</small><strong>{activityTitle(activity)}</strong></span>
          <CaretDown size={14} aria-hidden="true" />
        </summary>
        <div>
          {activity.summary && <p>{activity.summary}</p>}
          {query && <p><strong>查询内容：</strong>{query}</p>}
          {typeof detail.result_count === 'number' && <p>获得 {detail.result_count} 条可用结果。</p>}
          {detail.cache_state === 'cached' && <p><strong>数据状态：</strong>复用了缓存结果</p>}
          {Array.isArray(detail.sources) && <SourceLinks sources={detail.sources as SourceRecordData[]} />}
          <time>{new Date(activity.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </details>
    </li>
  );
}

function WorkProcess({ run, visible }: { run: AgentRunData; visible: boolean }) {
  if (!visible) return null;
  const activities = Array.from(
    (run.activities ?? []).reduce((map, activity) => map.set(activity.activity_id, activity), new Map<string, AgentActivityEventData>()).values(),
  ).sort((a, b) => a.sequence - b.sequence);
  const steps = run.steps.length > 0 ? run.steps : (['QUEUED', 'RUNNING', 'PARTIAL'].includes(run.status) ? [{
    id: `placeholder:${run.id}`,
    kind: 'progress' as const,
    label: '正在处理当前请求',
    detail: '公开执行状态正在同步；真实工具与来源会在返回后补齐。',
    status: 'running' as const,
    occurred_at: run.created_at,
    result: null,
    sources: [],
  }] : []);
  if (!activities.length && !steps.length) return null;
  const currentActivity = activities.find((item) => item.status === 'running' || item.status === 'waiting');
  const completedCount = activities.filter((item) => item.status === 'completed').length;
  return (
    <details className="work-process public-work-process" open={['RUNNING', 'WAITING_USER'].includes(run.status)}>
      <summary>
        <span><Robot size={17} weight="duotone" /><strong>{currentActivity ? activityTitle(currentActivity) : '本轮工作已整理好'}</strong></span>
        <small>{activities.length ? `${completedCount}/${activities.length} 项` : `${steps.length} 步`}</small>
      </summary>
      <p className="process-disclosure">这里展示公开的决策摘要、真实工具和结果；不会展示隐藏思维链、提示词或底层请求结构。</p>
      <ol className="public-process-list">
        {activities.length
          ? activities.map((activity, index) => <ActivityEntry key={activity.activity_id} activity={activity} index={index} />)
          : steps.map((step, index) => <ProcessEntry key={step.id} step={step} index={index} />)}
      </ol>
    </details>
  );
}

function MessageText({ content, sources }: { content: string; sources: SourceRecordData[] }) {
  return <MarkdownContent content={content} sources={sources} />;
}

function ThreadManager({
  threads,
  currentId,
  onSelect,
  onNew,
  onRename,
  onArchive,
  onDelete,
}: {
  threads: ThreadSummary[];
  currentId?: string;
  onSelect: (threadId: string) => Promise<void>;
  onNew: () => Promise<void>;
  onRename: (threadId: string, title: string) => Promise<void>;
  onArchive: (thread: ThreadSummary) => Promise<void>;
  onDelete: (thread: ThreadSummary) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState('');
  const [busyAction, setBusyAction] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary>();
  const activeThreads = threads.filter((item) => item.status === 'ACTIVE');
  const archivedThreads = threads.filter((item) => item.status === 'ARCHIVED');
  const beginRename = (thread: ThreadSummary) => {
    setEditingId(thread.id);
    setDraftTitle(thread.title);
  };
  const saveRename = async () => {
    if (!editingId || !draftTitle.trim()) return;
    setBusyAction(`rename:${editingId}`);
    try {
      await onRename(editingId, draftTitle.trim());
      setEditingId(undefined);
    } finally {
      setBusyAction(undefined);
    }
  };
  const renderThreads = (items: ThreadSummary[], label: string) => (
    <section className="thread-group" aria-label={label}>
      <h3>{label}<span>{items.length}</span></h3>
      {items.length ? items.map((item) => (
        <article key={item.id} className={`${item.id === currentId ? 'is-current' : ''} ${item.status === 'ARCHIVED' ? 'is-archived' : ''}`}>
          {editingId === item.id ? (
            <div className="thread-title-editor">
              <label className="sr-only" htmlFor={`thread-title-${item.id}`}>对话名称</label>
              <input id={`thread-title-${item.id}`} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={120} autoFocus disabled={busyAction === `rename:${item.id}`} />
              <button type="button" onClick={() => void saveRename()} disabled={busyAction === `rename:${item.id}`} aria-label="保存名称"><Check size={15} /></button>
              <button type="button" onClick={() => setEditingId(undefined)} disabled={busyAction === `rename:${item.id}`} aria-label="取消重命名"><X size={15} /></button>
            </div>
          ) : (
            <button
              type="button"
              className="thread-select"
              onClick={() => {
                setBusyAction(`select:${item.id}`);
                void onSelect(item.id).finally(() => setBusyAction(undefined));
              }}
              disabled={Boolean(busyAction)}
              aria-current={item.id === currentId ? 'true' : undefined}
            >
              <strong>{item.title}</strong>
              <span>{item.message_count} 条消息 · {item.run_count} 次运行 · {item.last_message_at ? new Date(item.last_message_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未开始'}</span>
            </button>
          )}
          <div className="thread-row-actions">
            <button type="button" onClick={() => beginRename(item)} disabled={Boolean(busyAction)} aria-label={`重命名 ${item.title}`}><PencilSimple size={15} /></button>
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => {
                setBusyAction(`archive:${item.id}`);
                void onArchive(item).finally(() => setBusyAction(undefined));
              }}
              aria-label={item.status === 'ARCHIVED' ? `恢复 ${item.title}` : `归档 ${item.title}`}
            ><Archive size={15} /></button>
            <button type="button" onClick={() => setDeleteTarget(item)} disabled={Boolean(busyAction)} aria-label={`删除 ${item.title}`}><Trash size={15} /></button>
          </div>
        </article>
      )) : <p className="thread-group-empty">暂无{label}</p>}
    </section>
  );
  return (
    <section className="thread-manager" aria-label="对话记录">
      <header><strong>当前旅程的对话</strong><button type="button" disabled={Boolean(busyAction)} onClick={() => { setBusyAction('new'); void onNew().finally(() => setBusyAction(undefined)); }}><Plus size={16} />{busyAction === 'new' ? '创建中' : '新对话'}</button></header>
      <div className="thread-list">
        {renderThreads(activeThreads, '进行中的对话')}
        {archivedThreads.length > 0 && renderThreads(archivedThreads, '已归档')}
      </div>
      <DeleteThreadDialog
        target={deleteTarget}
        busy={busyAction === `delete:${deleteTarget?.id}`}
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setBusyAction(`delete:${deleteTarget.id}`);
          try {
            await onDelete(deleteTarget);
            setDeleteTarget(undefined);
          } finally {
            setBusyAction(undefined);
          }
        }}
      />
    </section>
  );
}

function DeleteThreadDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target?: ThreadSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    if (!target && dialog.open) dialog.close();
  }, [target]);
  return (
    <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="delete-thread-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <div className="confirm-dialog-card">
        <Trash size={22} aria-hidden="true" />
        <h2 id="delete-thread-title">删除这段对话？</h2>
        <p>“{target?.title}”的消息、运行过程、工具记录和检查点都会永久删除；同一 Trip 的行程版本不会受影响。</p>
        <div>
          <button type="button" className="button-tertiary" onClick={onCancel} disabled={busy} autoFocus>取消</button>
          <button type="button" className="button-danger" onClick={() => void onConfirm()} disabled={busy}>{busy ? '删除中…' : '确认删除'}</button>
        </div>
      </div>
    </dialog>
  );
}

export function AgentThread({
  thread,
  threads,
  runStatus,
  runConnection,
  error,
  onSend,
  onSubmitComponent,
  onCancel,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
  onRetry,
  retryableRunId,
  showWorkProcess,
  onShowWorkProcessChange,
}: {
  thread: ThreadData | null;
  threads: ThreadSummary[];
  runStatus: RunStatus;
  runConnection: 'connected' | 'reconnecting';
  error?: string | null;
  onSend: (message: string) => Promise<void>;
  onSubmitComponent: (component: UIComponentData, value: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onNewThread: () => Promise<void>;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
  onArchiveThread: (thread: ThreadSummary) => Promise<void>;
  onDeleteThread: (thread: ThreadSummary) => Promise<void>;
  onRetry?: (runId: string) => Promise<void>;
  retryableRunId?: string | null;
  showWorkProcess: boolean;
  onShowWorkProcessChange: (enabled: boolean) => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [threadTransitioning, setThreadTransitioning] = useState(false);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const runGroups = useMemo(
    () => thread?.runs.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map((run) => ({
      run,
      userMessages: thread.messages.filter((item) => item.run_id === run.id && item.role === 'user'),
      assistantItems: [
        ...thread.messages
          .filter((item) => {
            if (item.run_id !== run.id || item.role !== 'assistant') return false;
            // A Run may fail once and then recover from its checkpoint. Keep
            // the audit record in the database, but do not show the transient
            // error beside the successful answer.
            if (item.meta?.kind === 'run_error_recovered') return false;
            if (item.meta?.kind === 'run_error' && run.status !== 'FAILED') return false;
            return true;
          })
          .map((item) => ({ kind: 'message' as const, createdAt: item.created_at, item })),
        ...thread.components
          .filter((component) => component.run_id === run.id && !['SUPERSEDED', 'EXPIRED', 'FAILED', 'CANCELLED'].includes(component.state))
          .map((item) => ({ kind: 'component' as const, createdAt: item.created_at, item })),
      ].sort((a, b) => {
        if (
          a.kind === 'message'
          && a.item.meta?.kind === 'component_prompt'
          && b.kind === 'component'
          && a.item.meta?.component_type === b.item.type
        ) return -1;
        if (
          b.kind === 'message'
          && b.item.meta?.kind === 'component_prompt'
          && a.kind === 'component'
          && b.item.meta?.component_type === a.item.type
        ) return 1;
        return a.createdAt.localeCompare(b.createdAt);
      }),
    })) ?? [],
    [thread],
  );
  const orphanMessages = thread?.messages.filter((item) => !item.run_id) ?? [];
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followOutputRef = useRef(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const running = ['QUEUED', 'RUNNING', 'PARTIAL'].includes(runStatus);
  const retryTargetRunId = retryableRunId
    ?? [...(thread?.runs ?? [])].reverse().find((run) => run.status === 'FAILED')?.id
    ?? null;
  const pendingRunPlaceholder: AgentRunData | null = running && !thread?.runs.some((run) => ['QUEUED', 'RUNNING', 'PARTIAL'].includes(run.status))
    ? {
      id: 'pending-run-placeholder',
      status: runStatus,
      intent: null,
      current_step: '正在同步公开状态',
      created_at: new Date().toISOString(),
      completed_at: null,
      steps: [],
      activities: [],
      sources: [],
    }
    : null;
  const outputSignature = useMemo(() => [
    thread?.id ?? 'empty',
    ...(thread?.messages ?? []).map((item) => `${item.id}:${item.content.length}`),
    ...(thread?.components ?? []).map((item) => `${item.id}:${item.state}`),
    ...(thread?.runs ?? []).flatMap((item) => [
      `${item.id}:${item.status}:${item.current_step}`,
      ...item.steps.map((step) => `${step.id}:${step.status}:${step.detail}`),
      ...item.activities.map((activity) => `${activity.activity_id}:${activity.status}:${activity.summary ?? ''}:${activity.sequence}`),
    ]),
  ].join('|'), [thread]);
  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const node = messagesRef.current;
    if (!node) return;
    followOutputRef.current = true;
    node.scrollTop = node.scrollHeight;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setShowScrollToLatest(false);
  };
  const handleMessagesScroll = () => {
    const node = messagesRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const nearLatest = distance < 96;
    followOutputRef.current = nearLatest;
    setShowScrollToLatest(!nearLatest);
  };
  useEffect(() => {
    followOutputRef.current = true;
    setShowScrollToLatest(false);
    const node = messagesRef.current;
    if (!node) return undefined;
    const scroll = () => {
      if (followOutputRef.current) node.scrollTop = node.scrollHeight;
    };
    const first = requestAnimationFrame(scroll);
    const second = requestAnimationFrame(scroll);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scroll) : null;
    observer?.observe(node);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      observer?.disconnect();
    };
  }, [thread?.id]);
  useEffect(() => {
    if (!followOutputRef.current) return;
    const first = requestAnimationFrame(() => scrollToLatest(running ? 'auto' : 'smooth'));
    const second = requestAnimationFrame(() => scrollToLatest('auto'));
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [outputSignature, running, error]);
  const retry = async () => {
    if (!onRetry || !retryTargetRunId || retryingRunId) return;
    setRetryingRunId(retryTargetRunId);
    try {
      await onRetry(retryTargetRunId);
    } finally {
      setRetryingRunId(null);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = message.trim();
    if (!value || sending) return;
    followOutputRef.current = true;
    setShowScrollToLatest(false);
    setSending(true);
    setMessage('');
    try {
      await onSend(value);
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  };
  return (
    <section className="agent-thread" aria-label="SuperTravel 旅行管家">
      <header className="agent-thread-header">
        <div className="agent-avatar"><Robot size={22} weight="duotone" /></div>
        <div><strong>{thread?.title || 'SuperTravel 管家'}</strong><span>{runConnection === 'reconnecting' ? '连接已断开，正在重连并补回事件…' : running ? '正在处理并核验真实数据' : runStatus === 'WAITING_USER' ? '等待你的确认' : '独立对话 · Trip State 共享'}</span></div>
        <label className="trace-mode-switch" title="显示管家正在处理的任务、真实工具与来源">
          <input
            type="checkbox"
            checked={showWorkProcess}
            onChange={(event) => onShowWorkProcessChange(event.target.checked)}
            aria-describedby="work-process-mode-description"
          />
          <span className="trace-switch-track" aria-hidden="true"><i /></span>
          <span className="trace-switch-copy"><strong>工作过程</strong><small id="work-process-mode-description">{showWorkProcess ? '已开启' : '已关闭'}</small></span>
        </label>
        <button type="button" className={`thread-history-button ${showThreads ? 'is-active' : ''}`} onClick={() => setShowThreads((value) => !value)} aria-expanded={showThreads} aria-label="管理对话记录"><ChatsCircle size={19} /></button>
        {running && <button type="button" className="stop-button" onClick={onCancel}><StopCircle size={19} />停止</button>}
      </header>
      {showThreads && (
        <ThreadManager
          threads={threads}
          currentId={thread?.id}
          onSelect={async (threadId) => {
            setThreadTransitioning(true);
            try { await onSelectThread(threadId); setShowThreads(false); } finally { setThreadTransitioning(false); }
          }}
          onNew={async () => {
            setThreadTransitioning(true);
            try { await onNewThread(); setShowThreads(false); } finally { setThreadTransitioning(false); }
          }}
          onRename={async (threadId, title) => {
            setThreadTransitioning(true);
            try { await onRenameThread(threadId, title); } finally { setThreadTransitioning(false); }
          }}
          onArchive={async (item) => {
            setThreadTransitioning(true);
            try { await onArchiveThread(item); } finally { setThreadTransitioning(false); }
          }}
          onDelete={async (item) => {
            setThreadTransitioning(true);
            try { await onDeleteThread(item); } finally { setThreadTransitioning(false); }
          }}
        />
      )}
      <div className="agent-messages-shell">
        <div className="agent-messages" ref={messagesRef} onScroll={handleMessagesScroll} aria-live="polite">
          {!thread?.messages.length && (
            <div className="agent-welcome">
              <strong>告诉我你想去哪、和谁出发，以及最在意什么。</strong>
              <p>我会先整理 Trip State，只追问会真正改变方案的问题。</p>
            </div>
          )}
          {orphanMessages.map((item) => (
            <article key={item.id} className={`message-bubble is-${item.role}`}>
              <span>{item.role === 'user' ? '你' : '旅行管家'}</span>
              <div className="message-content"><MarkdownContent content={item.content} /></div>
            </article>
          ))}
          {runGroups.map(({ run, userMessages, assistantItems }) => (
            <section key={run.id} className="conversation-turn" data-run-id={run.id} data-run-status={run.status}>
              {userMessages.map((item) => (
                <article key={item.id} className="message-bubble is-user"><span>你</span><div className="message-content"><MarkdownContent content={item.content} /></div></article>
              ))}
              <WorkProcess run={run} visible={showWorkProcess} />
              {assistantItems.length > 0 && (
                <section className="concierge-response" aria-label="旅行管家的回复和交互">
                  <header><span className="agent-avatar"><Robot size={18} weight="duotone" /></span><strong>护航管家</strong></header>
                  <div>
                    {assistantItems.map((entry) => entry.kind === 'message' ? (
                      <article key={entry.item.id} className="concierge-message">
                        <MessageText content={entry.item.content} sources={run.sources} />
                        {Array.isArray(entry.item.meta?.citation_ids) && (
                          <SourceLinks sources={run.sources.filter((source) => (entry.item.meta?.citation_ids as unknown[]).map(String).includes(source.id))} />
                        )}
                      </article>
                    ) : (
                      <ComponentCard key={entry.item.id} component={entry.item} onSubmit={onSubmitComponent} />
                    ))}
                  </div>
                </section>
              )}
            </section>
          ))}
          {pendingRunPlaceholder && <WorkProcess run={pendingRunPlaceholder} visible={showWorkProcess} />}
          {running && <div className="agent-progress" role="status"><i /><span>正在理解、调用工具并校验结果…</span></div>}
          {error && <div className="inline-error" role="alert"><WarningCircle size={19} /><span>{error}</span>{onRetry && retryTargetRunId && <button type="button" onClick={() => void retry()} disabled={Boolean(retryingRunId)}>{retryingRunId ? '重试中…' : '重试'}</button>}</div>}
        </div>
        {showScrollToLatest && <button type="button" className="agent-scroll-latest" onClick={() => scrollToLatest()}><ArrowDown size={16} />回到最新</button>}
      </div>
      <form className="agent-composer" onSubmit={submit}>
        <label htmlFor="agent-message">告诉护航管家你想了解、调整或兜底什么</label>
        <div>
          <textarea ref={composerRef} id="agent-message" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} rows={2} placeholder={thread?.status === 'ARCHIVED' ? '该对话已归档，请恢复或新建对话' : '例如：第二天下午轻松一点，但保留已预约的博物馆'} disabled={thread?.status === 'ARCHIVED' || threadTransitioning} />
          <button type="submit" className="send-button" disabled={!message.trim() || sending || running || thread?.status === 'ARCHIVED' || threadTransitioning} aria-label="发送">
            <PaperPlaneTilt size={20} weight="fill" />
          </button>
        </div>
      </form>
    </section>
  );
}
