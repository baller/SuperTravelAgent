import { ArrowRight, BellRinging, Check, CheckSquare, MagnifyingGlass, PaperPlaneTilt, Robot, SlidersHorizontal, Tag, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Readiness, TripSummary, UserProfile } from '../types';

export const TRIP_CATEGORIES = ['未分类', '休闲度假', '亲子出行', '情侣出行', '朋友出行', '工作出差'] as const;

function destinationName(trip: TripSummary) {
  const value = trip.trip_spec.destination.value;
  if (!value) return '目的地待确认';
  return typeof value === 'string' ? value : value.name;
}

function dateRange(trip: TripSummary) {
  const start = trip.trip_spec.start_date.value;
  const end = trip.trip_spec.end_date.value;
  return start && end ? `${start} — ${end}` : '日期待确认';
}

const lifecycleText: Record<string, string> = {
  CLARIFYING: '补充信息', RESEARCHING: '研究中', PLANNING: '规划中', REVIEWING: '待确认', READY: '已就绪', IN_TRIP: '旅行中', COMPLETED: '已完成', DRAFT: '草稿', ARCHIVED: '已归档',
};

export function HomePage({ readiness, trips, profile, onStart, onOpenTrip, onUpdateCategories, onDeleteTrips, onResume, onDecisions, onSettings, error }: {
  readiness: Readiness | null;
  trips: TripSummary[];
  profile: UserProfile | null;
  onStart: (message: string) => Promise<void>;
  onOpenTrip: (tripId: string) => Promise<void>;
  onUpdateCategories: (tripIds: string[], category: string) => Promise<void>;
  onDeleteTrips: (tripIds: string[]) => Promise<void>;
  onResume: () => Promise<void>;
  onDecisions: () => void;
  onSettings: () => void;
  error: string | null;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'ready' | 'in_trip'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryToApply, setCategoryToApply] = useState<string>(TRIP_CATEGORIES[0]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [hasResumeTarget] = useState(() => Boolean(window.localStorage.getItem('supertravel:last-workspace-location')));
  const pendingTrips = trips.filter((item) => item.pending_decisions > 0);
  const filteredTrips = useMemo(() => trips.filter((item) => {
    const matchesQuery = !query.trim() || `${item.title} ${destinationName(item)}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === 'all'
      || (filter === 'attention' && (item.pending_decisions > 0 || ['存在阻断', '需要关注', '需要补充'].includes(item.pulse)))
      || (filter === 'ready' && item.lifecycle === 'READY')
      || (filter === 'in_trip' && item.lifecycle === 'IN_TRIP');
    const matchesCategory = categoryFilter === 'all' || (item.category || '未分类') === categoryFilter;
    return matchesQuery && matchesFilter && matchesCategory;
  }), [categoryFilter, filter, query, trips]);
  const visibleIds = filteredTrips.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const missingCount = readiness?.services.filter((item) => item.required && !item.ready).length ?? 0;
  const toggleSelection = (tripId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId);
      return next;
    });
  };
  const toggleVisibleSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const applyCategory = async () => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onUpdateCategories([...selectedIds], categoryToApply);
      exitSelectionMode();
    } catch {
      // The parent displays the user-facing API error; keep the selection so it
      // can be retried without making the user choose the trips again.
    } finally {
      setBulkBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (deleteIds.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onDeleteTrips(deleteIds);
      setDeleteIds([]);
      exitSelectionMode();
    } catch {
      // Keep the confirmation open when deletion fails so the user can retry
      // after the parent reports the failure.
    } finally {
      setBulkBusy(false);
    }
  };
  return (
    <main id="main-content" className="home-page home-dashboard">
      <section className="home-intro">
        <div>
          <p>早上好，{profile?.display_name || '旅行者'}</p>
          <h1>世界充满变量，你的旅程永远有人兜底。</h1>
          <span>SuperTravel 是一位全天候运转的 AI 旅行管家。从起心动念到平安回家，它在后台静默排查天气、路况与突发变故。去放肆体验未知吧，一切意外，我们兜底。</span>
          {hasResumeTarget && <div className="home-intro-actions"><button type="button" className="button-secondary" onClick={() => void onResume()}><ArrowRight size={17} />继续上次对话</button></div>}
        </div>
        <dl className="care-overview" aria-label="旅程照看概览">
          <div><dt>进行中的旅程</dt><dd>{trips.filter((item) => !['COMPLETED', 'ARCHIVED'].includes(item.lifecycle)).length}</dd></div>
          <div><dt>待你决定</dt><dd>{trips.reduce((sum, item) => sum + item.pending_decisions, 0)}</dd></div>
          <div><dt>已经就绪</dt><dd>{trips.filter((item) => item.lifecycle === 'READY').length}</dd></div>
        </dl>
      </section>
      <section className="home-prompt-panel" aria-label="开始一段新旅程">
        <div className="concierge-presence"><Robot size={22} weight="duotone" /><span><strong>SuperTravel 动态护航管家</strong><small>7×24小时后台静默盯盘，提前备好 Plan B</small></span></div>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!message.trim()) return;
          setSending(true);
          void onStart(message.trim()).finally(() => setSending(false));
        }}>
          <label className="sr-only" htmlFor="trip-command">描述你想开始的旅程</label>
          <textarea id="trip-command" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="卸下做攻略的重负。例如：十月带父母去青岛，想看海，每天别走太多路..." rows={3} />
          <button type="submit" className="button-primary" disabled={!message.trim() || sending || !readiness?.ready}><PaperPlaneTilt size={19} weight="fill" />体验永远有 Plan B 的旅程</button>
        </form>
        <div className="prompt-examples"><span>模糊灵感也能落地：</span>{['周末两个人去苏州放松', '带孩子去北京看博物馆', '帮我规划一次轻松的云南旅行'].map((example) => <button type="button" key={example} onClick={() => setMessage(example)}>{example}</button>)}</div>
      </section>
      {missingCount > 0 && <section className="home-service-banner" role="alert"><WarningCircle size={20} /><div><strong>开始规划前还需配置 {missingCount} 项核心服务</strong><span>缺少密钥时系统不会生成伪造结果。</span></div><button type="button" onClick={onSettings}>前往设置</button></section>}
      {error && <div className="inline-error home-inline-error" role="alert"><WarningCircle size={19} />{error}</div>}
      {pendingTrips.length > 0 && (
        <section className="home-decisions">
          <header><div><span>需要你决定</span><h2>管家已经把选择准备好了</h2></div><button type="button" onClick={onDecisions}>查看全部 <ArrowRight size={17} /></button></header>
          <div>{pendingTrips.slice(0, 3).map((item) => <button type="button" key={item.id} onClick={() => onOpenTrip(item.id)}><BellRinging size={20} /><span><strong>{item.title}</strong><small>{item.pending_decisions} 项待决定 · {item.pulse}</small></span><ArrowRight size={18} /></button>)}</div>
        </section>
      )}
      <section className="trip-library">
        <header>
          <div><span>旅程管理</span><h2>所有被护航的旅程</h2><p>每段旅程都拥有独立的后台巡航与预案日志。</p></div>
          <div className="trip-library-tools">
            <label><MagnifyingGlass size={17} /><span className="sr-only">搜索旅程</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索目的地或旅程" /></label>
            <label><SlidersHorizontal size={17} /><span className="sr-only">筛选旅程</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">全部</option><option value="attention">需要关注</option><option value="ready">已经就绪</option><option value="in_trip">旅行中</option></select></label>
            <label><Tag size={17} /><span className="sr-only">按归类筛选</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">所有归类</option>{TRIP_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
            <button type="button" className={selectionMode ? 'button-tertiary is-active' : 'button-tertiary'} onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}><CheckSquare size={17} />{selectionMode ? '取消选择' : '选择'}</button>
          </div>
        </header>
        {selectionMode && (
          <div className="trip-selection-toolbar" role="toolbar" aria-label="批量管理旅程">
            <label className="trip-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} disabled={visibleIds.length === 0} /><span>{allVisibleSelected ? '取消全选当前结果' : '全选当前结果'}</span></label>
            <span className="trip-selection-count">已选择 {selectedIds.size} 段旅程</span>
            <label className="trip-category-action"><Tag size={16} /><span>归类为</span><select value={categoryToApply} onChange={(event) => setCategoryToApply(event.target.value)} disabled={selectedIds.size === 0 || bulkBusy}>{TRIP_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
            <button type="button" className="button-tertiary" onClick={() => void applyCategory()} disabled={selectedIds.size === 0 || bulkBusy}><Tag size={16} />应用归类</button>
            <button type="button" className="button-danger trip-delete-button" onClick={() => setDeleteIds([...selectedIds])} disabled={selectedIds.size === 0 || bulkBusy}><Trash size={16} />删除</button>
          </div>
        )}
        <div className="trip-library-grid">
          {filteredTrips.map((item) => (
            <article key={item.id} className={`trip-record-card ${selectedIds.has(item.id) ? 'is-selected' : ''}`}>
              <div className="trip-record-card-top">
                {selectionMode && <label className="trip-record-check"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelection(item.id)} aria-label={`选择${item.title}`} /><span aria-hidden="true"><Check size={14} /></span></label>}
                <span className="trip-record-state">{lifecycleText[item.lifecycle] || item.lifecycle}</span>
                <span className="trip-record-category">{item.category || '未分类'}</span>
              </div>
              <button type="button" className="trip-record-open" onClick={() => onOpenTrip(item.id)}>
                <strong>{item.title}</strong><small>{destinationName(item)} · {dateRange(item)}</small>
                <footer><span>{item.pulse}</span>{item.pending_decisions > 0 && <em>{item.pending_decisions} 项待决定</em>}<ArrowRight size={19} /></footer>
              </button>
            </article>
          ))}
          {filteredTrips.length === 0 && <div className="empty-trips"><Robot size={30} /><strong>{trips.length ? '没有符合条件的旅程' : '还没有旅程'}</strong><p>{trips.length ? '换一个筛选条件，或从上方开始新旅程。' : '从上方告诉管家你想去哪。'}</p></div>}
        </div>
      </section>
      <TripDeleteDialog count={deleteIds.length} busy={bulkBusy} onCancel={() => { if (!bulkBusy) setDeleteIds([]); }} onConfirm={() => void confirmDelete()} />
    </main>
  );
}

function TripDeleteDialog({ count, busy, onCancel, onConfirm }: { count: number; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (count > 0 && !dialog.open) dialog.showModal();
    if (count === 0 && dialog.open) dialog.close();
  }, [count]);
  return (
    <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="delete-trips-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <div className="confirm-dialog-card">
        <Trash size={22} aria-hidden="true" />
        <h2 id="delete-trips-title">删除选中的旅程？</h2>
        <p>将归档并从旅程首页移除 {count} 段旅程，同时停止其中仍在运行的 Agent Run。对话、计划和版本会保留在归档数据中。</p>
        <div><button type="button" className="button-tertiary" onClick={onCancel} disabled={busy}><X size={16} />取消</button><button type="button" className="button-danger" onClick={onConfirm} disabled={busy}>{busy ? '删除中…' : '确认删除'}</button></div>
      </div>
    </dialog>
  );
}
