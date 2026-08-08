import {
  Archive,
  ArrowCounterClockwise,
  ArrowRight,
  Bookmarks,
  CalendarDots,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  CheckCircle,
  ClipboardText,
  Clock,
  CloudRain,
  CloudSun,
  Compass,
  CurrencyCny,
  DownloadSimple,
  Footprints,
  ForkKnife,
  GitDiff,
  House,
  Info,
  ListChecks,
  LockSimple,
  MapPin,
  MapTrifold,
  Notebook,
  PaperPlaneTilt,
  Paperclip,
  PencilLine,
  Plus,
  SealCheck,
  Stamp,
  StopCircle,
  SuitcaseRolling,
  Ticket,
  Train,
  Umbrella,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { baseDays, initialVersions, rainPlanItems } from './data';
import { BrandMark, CityLineDoodle, EmptyNotebook, NotebookHero } from './components/Doodles';
import type { Page, PlanVersion, RightPanel, RunState, TripDay } from './types';

const TripMap = lazy(() => import('./components/TripMap').then((module) => ({ default: module.TripMap })));

const cloneDays = (): TripDay[] => baseDays.map((day) => ({ ...day, items: day.items.map((item) => ({ ...item })) }));

function App() {
  const [page, setPage] = useState<Page>('home');
  const [days, setDays] = useState<TripDay[]>(cloneDays);
  const [versions, setVersions] = useState<PlanVersion[]>(initialVersions);
  const [tripCreated, setTripCreated] = useState(false);

  const navigate = (next: Page) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const applyRainPlan = () => {
    setDays((current) =>
      current.map((day) =>
        day.id === 'day-2' ? { ...day, title: '雨天园林与评弹慢游', walking: '4.8 km', items: rainPlanItems } : day,
      ),
    );
    setVersions([
      {
        id: 'v2',
        title: 'V2 · 雨天轻松方案',
        time: '刚刚',
        note: '第 2 天减少 4.6 km 步行，保留留园',
        active: true,
      },
      ...initialVersions.map((version) => ({ ...version, active: false })),
    ]);
  };

  const restoreInitialPlan = () => {
    setDays(cloneDays());
    setVersions(initialVersions);
  };

  return (
    <div className="min-h-dvh bg-[var(--color-canvas)] text-[var(--color-ink)]">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <GlobalHeader page={page} onNavigate={navigate} tripCreated={tripCreated} />
      <main id="main-content" tabIndex={-1}>
        {page === 'home' && <HomePage onStart={() => navigate('create')} onOpenTrip={() => navigate('workspace')} />}
        {page === 'create' && (
          <CreateTripPage
            onBack={() => navigate('home')}
            onComplete={() => {
              setTripCreated(true);
              navigate('inspiration');
            }}
            onSkip={() => {
              setTripCreated(true);
              navigate('workspace');
            }}
          />
        )}
        {page === 'inspiration' && <InspirationPage onGenerate={() => navigate('workspace')} />}
        {page === 'workspace' && (
          <WorkspacePage
            days={days}
            versions={versions}
            onApplyRainPlan={applyRainPlan}
            onRestore={restoreInitialPlan}
            onToday={() => navigate('today')}
          />
        )}
        {page === 'today' && <TodayPage day={days[0]} onWorkspace={() => navigate('workspace')} />}
        {page === 'review' && <ReviewPage days={days} />}
      </main>
    </div>
  );
}

function GlobalHeader({
  page,
  onNavigate,
  tripCreated,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  tripCreated: boolean;
}) {
  const navItems: Array<{ page: Page; label: string; icon: typeof House }> = [
    { page: 'home', label: '旅行', icon: House },
    { page: 'inspiration', label: '灵感', icon: Bookmarks },
    { page: 'review', label: '回顾', icon: Archive },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)]/80 bg-[var(--color-canvas)]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1520px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          className="flex min-h-11 items-center gap-2 rounded-[10px] px-1 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--color-focus)]/35"
          onClick={() => onNavigate('home')}
          aria-label="返回 SuperTravel 首页"
        >
          <BrandMark className="h-9 w-9 text-[var(--color-primary)]" />
          <span>
            <span className="block font-display text-lg font-semibold leading-none">SuperTravel</span>
            <span className="mt-1 hidden text-[11px] font-medium tracking-[0.12em] text-[var(--color-ink-muted)] sm:block">TRAVEL SKETCHBOOK</span>
          </span>
        </button>

        <nav aria-label="主导航" className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] p-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = page === item.page;
            return (
              <button
                key={item.page}
                type="button"
                className={`nav-pill ${active ? 'nav-pill-active' : ''}`}
                onClick={() => onNavigate(item.page)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-[var(--color-warning-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-ink)] md:flex">
            <Info size={15} aria-hidden="true" /> 演示数据
          </span>
          <button
            type="button"
            className="global-header-action button-secondary hidden sm:inline-flex"
            onClick={() => onNavigate(tripCreated ? 'workspace' : 'create')}
          >
            {tripCreated ? <MapTrifold size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            {tripCreated ? '打开行程' : '新建旅行'}
          </button>
        </div>
      </div>
    </header>
  );
}

function HomePage({ onStart, onOpenTrip }: { onStart: () => void; onOpenTrip: () => void }) {
  return (
    <div className="paper-noise">
      <section className="mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1440px] items-center gap-10 px-5 py-12 md:grid-cols-[0.88fr_1.12fr] md:px-10 lg:gap-16 lg:px-16">
        <div className="max-w-[610px]">
          <div className="mb-7 flex items-center gap-3 text-sm font-semibold text-[var(--color-primary)]">
            <span className="h-px w-10 bg-[var(--color-primary)]" />
            一份会跟着旅途变化的计划
          </div>
          <h1 className="font-display text-[clamp(2.8rem,6vw,5.8rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            把零散灵感，
            <span className="relative mt-2 inline-block text-[var(--color-primary)]">
              变成真正能走的行程
              <span className="hand-underline" aria-hidden="true" />
            </span>
          </h1>
          <p className="mt-8 max-w-[55ch] text-base leading-8 text-[var(--color-ink-muted)] md:text-lg">
            SuperTravel 把攻略、约束和临时变化收进同一本数字旅行手帐。你负责决定，旅行搭子负责整理、检查和重排。
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button type="button" className="button-primary" onClick={onStart}>
              开始规划一次旅行 <ArrowRight size={19} aria-hidden="true" />
            </button>
            <button type="button" className="button-secondary" onClick={onOpenTrip}>
              直接体验苏州 Demo <Notebook size={19} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-10 grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-5 border-t border-[var(--color-line)] pt-6 text-sm">
            <span className="font-display text-2xl font-semibold text-[var(--color-coral)]">01</span>
            <p><strong>收集灵感</strong><span className="ml-2 text-[var(--color-ink-muted)]">攻略、截图和必去地点进入候选池</span></p>
            <span className="font-display text-2xl font-semibold text-[var(--color-sky)]">02</span>
            <p><strong>推演行程</strong><span className="ml-2 text-[var(--color-ink-muted)]">时间、预算、路程和开放状态一起校验</span></p>
            <span className="font-display text-2xl font-semibold text-[var(--color-primary)]">03</span>
            <p><strong>旅中重排</strong><span className="ml-2 text-[var(--color-ink-muted)]">变化先预览，应用后仍能撤销</span></p>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[720px]">
          <div className="absolute -left-3 top-14 hidden -rotate-6 rounded-[8px] bg-[var(--color-warning-bg)] px-5 py-3 font-display text-lg font-semibold text-[var(--color-warning-ink)] shadow-[0_12px_32px_rgba(47,51,47,.1)] lg:block">
            慢一点，才看得见
          </div>
          <NotebookHero />
        </div>
      </section>

      <section className="border-y border-[var(--color-line)] bg-[var(--color-paper)]/55">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-14 md:grid-cols-[0.7fr_1.3fr] md:px-10 lg:px-16">
          <div>
            <p className="section-kicker">RECENT NOTEBOOK</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight">继续你的旅行手帐</h2>
            <p className="mt-4 max-w-sm leading-7 text-[var(--color-ink-muted)]">每个 Trip 都保留约束、来源、修改记录和实际完成情况。</p>
          </div>
          <button type="button" className="trip-cover group text-left" onClick={onOpenTrip}>
            <div className="trip-cover-art">
              <CityLineDoodle className="h-full w-full text-[var(--color-ink)]" />
              <span className="stamp-mark">SUZHOU<br />2026</span>
            </div>
            <div className="flex items-end justify-between gap-5">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-coral)]">即将出发 · 3 DAYS</p>
                <h3 className="mt-2 font-display text-3xl font-semibold">带妈妈去苏州</h3>
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">10月2日—4日 · 预算 ¥5,000 · 4 个必去</p>
              </div>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[var(--color-primary)] text-[var(--color-primary)] transition-transform group-hover:translate-x-1">
                <ArrowRight size={22} aria-hidden="true" />
              </span>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
}

function CreateTripPage({
  onBack,
  onComplete,
  onSkip,
}: {
  onBack: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState('十一带妈妈去苏州三天，预算 5000，不想太赶，必须去拙政园和平江路。');

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-10 md:px-10 md:py-16">
      <button type="button" className="button-tertiary mb-8" onClick={step === 0 ? onBack : () => setStep(0)}>
        <CaretLeft size={18} aria-hidden="true" /> 返回
      </button>
      <div className="grid items-start gap-10 lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="lg:sticky lg:top-28">
          <p className="section-kicker">NEW TRIP · {step + 1}/2</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">先说说这次想怎么走</h1>
          <p className="mt-5 max-w-md leading-8 text-[var(--color-ink-muted)]">不用一次填完所有表格。旅行搭子会先整理已有信息，只追问真正影响方案的问题。</p>
          <CityLineDoodle className="mt-9 hidden w-full max-w-sm text-[var(--color-ink-muted)] lg:block" />
        </aside>

        {step === 0 ? (
          <div className="paper-sheet p-6 md:p-9">
            <label htmlFor="trip-idea" className="field-label">描述旅行想法</label>
            <p id="trip-idea-help" className="mb-3 text-sm leading-6 text-[var(--color-ink-muted)]">可以包含目的地、日期、同行人、预算、必去和不喜欢的安排。</p>
            <textarea
              id="trip-idea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-describedby="trip-idea-help"
              className="min-h-44 w-full resize-y rounded-[12px] border border-[var(--color-line)] bg-[var(--color-paper)] p-5 text-base leading-7 outline-none transition focus:border-[var(--color-primary)] focus:ring-3 focus:ring-[var(--color-focus)]/20"
            />
            <div className="mt-5 flex flex-wrap gap-2" aria-label="示例补充条件">
              {['不想早起', '每天步行少于 8 公里', '喜欢园林和人文', '需要清淡餐厅'].map((item) => (
                <button key={item} type="button" className="suggestion-chip" onClick={() => setPrompt((value) => `${value} ${item}。`)}>{item}</button>
              ))}
            </div>
            <div className="mt-9 flex justify-end">
              <button type="button" className="button-primary" onClick={() => setStep(1)} disabled={!prompt.trim()}>
                整理旅行需求 <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="sticky-note flex gap-4" role="status">
              <PencilLine size={25} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">旅行搭子已经整理好需求</p>
                <p className="mt-1 text-sm leading-6">日期暂按 10 月 2 日至 4 日，并假设妈妈可以正常步行但需要每 2 小时休息。你可以稍后修改。</p>
              </div>
            </div>
            <div className="paper-sheet p-6 md:p-8">
              <div className="mb-7 flex items-center justify-between border-b border-[var(--color-line)] pb-5">
                <div>
                  <p className="section-kicker">TRIP SPEC</p>
                  <h2 className="mt-2 font-display text-3xl font-semibold">苏州慢游手帐</h2>
                </div>
                <span className="rounded-full bg-[var(--color-success-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-hover)]">草稿已保存</span>
              </div>
              <dl className="spec-grid">
                <SpecItem icon={MapPin} label="目的地" value="苏州" />
                <SpecItem icon={CalendarDots} label="日期" value="10月2日—4日 · 3天" note="假设" />
                <SpecItem icon={SuitcaseRolling} label="同行人" value="你和妈妈 · 2人" />
                <SpecItem icon={CurrencyCny} label="总预算" value="¥5,000" />
                <SpecItem icon={Footprints} label="旅行节奏" value="舒缓 · 每日 2–4 个地点" />
                <SpecItem icon={LockSimple} label="必须保留" value="拙政园、平江路" />
              </dl>
              <div className="mt-7 border-t border-dashed border-[var(--color-line)] pt-6">
                <p className="field-label">系统假设</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="assumption-tag">每天 09:00 后出发</span>
                  <span className="assumption-tag">每 2 小时安排休息</span>
                  <span className="assumption-tag">优先地铁与短程打车</span>
                </div>
              </div>
              <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
                <button type="button" className="button-tertiary" onClick={onSkip}>跳过素材，直接生成</button>
                <button type="button" className="button-primary" onClick={onComplete}>
                  确认并收集灵感 <Paperclip size={19} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SpecItem({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="spec-item">
      <Icon size={21} className="text-[var(--color-primary)]" aria-hidden="true" />
      <dt className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="col-start-2 font-semibold">{value} {note && <span className="ml-2 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-[11px] text-[var(--color-warning-ink)]">{note}</span>}</dd>
    </div>
  );
}

function InspirationPage({ onGenerate }: { onGenerate: () => void }) {
  const [imported, setImported] = useState(false);
  const [selected, setSelected] = useState(() => new Set(['拙政园', '平江路', '苏州博物馆', '虎丘', '留园']));
  const candidates = ['拙政园', '平江路', '苏州博物馆', '虎丘', '留园', '山塘街', '金鸡湖', '诚品书店'];

  const toggleCandidate = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <section className="mx-auto max-w-[1480px] px-5 py-8 md:px-8">
      <div className="mb-8 flex flex-col justify-between gap-5 border-b border-[var(--color-line)] pb-7 md:flex-row md:items-end">
        <div>
          <p className="section-kicker">INSPIRATION INBOX</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">把收藏夹倒进旅行手帐</h1>
          <p className="mt-3 text-[var(--color-ink-muted)]">系统先提取地点和证据，是否进入行程由你决定。</p>
        </div>
        <button type="button" className="button-primary" onClick={onGenerate}>
          用 {selected.size} 个地点生成行程 <ArrowRight size={19} aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <div className="space-y-5">
          <button type="button" className="import-zone" onClick={() => setImported(true)}>
            <UploadSimple size={28} aria-hidden="true" />
            <span className="font-semibold">导入一张示例攻略截图</span>
            <span className="text-sm text-[var(--color-ink-muted)]">Demo 会模拟 OCR、地点识别与去重</span>
          </button>
          <SourceCard title="苏州三日园林路线" source="攻略文本 · 1,286 字" status="已识别 6 个地点" accent="coral" />
          <SourceCard title="带父母苏州慢游清单" source="网页链接 · 5 分钟前" status="已识别 5 个地点" accent="sky" />
          {imported && <SourceCard title="雨天苏州也好逛" source="截图 OCR · 刚刚" status="已识别 4 个地点，1 个待确认" accent="stamp" />}
        </div>

        <div className="paper-sheet p-5 md:p-7">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] pb-5">
            <div>
              <p className="section-kicker">PLACE CANDIDATES</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">候选地点</h2>
            </div>
            <span className="text-sm font-semibold text-[var(--color-primary)]">已选 {selected.size} / {candidates.length}</span>
          </div>
          <ul className="divide-y divide-[var(--color-line)]" aria-label="候选地点列表">
            {candidates.map((name, index) => (
              <li key={name} className="flex items-center gap-4 py-4">
                <input
                  id={`place-${index}`}
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--color-primary)]"
                  checked={selected.has(name)}
                  onChange={() => toggleCandidate(name)}
                />
                <label htmlFor={`place-${index}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block font-semibold">{name}</span>
                  <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">来自 {index % 3 === 0 ? '2' : '1'} 份素材 · 置信度 {91 - index}%</span>
                </label>
                {index < 2 && <span className="rounded-full bg-[var(--color-warning-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--color-warning-ink)]">必去</span>}
                {index === 5 && <span className="rounded-full border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]">重复已合并</span>}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-start gap-3 rounded-[10px] bg-[var(--color-success-bg)] p-4 text-sm text-[var(--color-primary-hover)]">
            <SealCheck size={21} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p><strong>证据已保留。</strong> 每个候选地点都能回到原始攻略片段，重复项不会丢失来源。</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceCard({
  title,
  source,
  status,
  accent,
}: {
  title: string;
  source: string;
  status: string;
  accent: 'coral' | 'sky' | 'stamp';
}) {
  const accentClass = {
    coral: 'bg-[var(--color-coral)]',
    sky: 'bg-[var(--color-sky)]',
    stamp: 'bg-[var(--color-stamp)]',
  }[accent];
  return (
    <article className="source-clip">
      <span className={`absolute left-0 top-5 h-12 w-1.5 rounded-r-full ${accentClass}`} aria-hidden="true" />
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-[var(--color-paper-muted)] text-[var(--color-primary)]"><Paperclip size={22} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{source}</p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)]"><CheckCircle size={15} weight="fill" aria-hidden="true" /> {status}</p>
        </div>
        <button type="button" className="icon-button" aria-label={`查看 ${title} 的来源详情`}><CaretRight size={19} aria-hidden="true" /></button>
      </div>
    </article>
  );
}

function WorkspacePage({
  days,
  versions,
  onApplyRainPlan,
  onRestore,
  onToday,
}: {
  days: TripDay[];
  versions: PlanVersion[];
  onApplyRainPlan: () => void;
  onRestore: () => void;
  onToday: () => void;
}) {
  const [dayIndex, setDayIndex] = useState(1);
  const [panel, setPanel] = useState<RightPanel>('map');
  const [activeItemId, setActiveItemId] = useState(days[1].items[0].id);
  const [command, setCommand] = useState('');
  const [submittedCommand, setSubmittedCommand] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const timers = useRef<number[]>([]);
  const activeDay = days[dayIndex];
  const rainPlanApplied = versions.some((version) => version.id === 'v2');

  useEffect(() => {
    if (!activeDay.items.some((item) => item.id === activeItemId)) setActiveItemId(activeDay.items[0].id);
  }, [activeDay, activeItemId]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  };

  const startRun = (value: string) => {
    if (!value.trim()) return;
    clearTimers();
    setSubmittedCommand(value.trim());
    setCommand('');
    setPanel('agent');
    setRunState('understanding');
    timers.current.push(window.setTimeout(() => setRunState('validating'), 650));
    timers.current.push(window.setTimeout(() => setRunState('preview'), 1450));
  };

  const stopRun = () => {
    clearTimers();
    setRunState('cancelled');
  };

  const applyPatch = () => {
    onApplyRainPlan();
    setDayIndex(1);
    setRunState('succeeded');
  };

  const restore = () => {
    onRestore();
    setRunState('idle');
    setPanel('versions');
  };

  const panelTabs: Array<{ id: RightPanel; label: string; icon: typeof MapTrifold; badge?: number }> = [
    { id: 'map', label: '地图', icon: MapTrifold },
    { id: 'agent', label: '旅行搭子', icon: ChatCircleDots },
    { id: 'conflicts', label: '冲突', icon: WarningCircle, badge: rainPlanApplied ? 0 : 2 },
    { id: 'versions', label: '版本', icon: GitDiff },
  ];

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)]">
            <span>我的旅行</span><CaretRight size={13} aria-hidden="true" /><span>苏州慢游手帐</span>
          </div>
          <h1 className="mt-1 truncate font-display text-2xl font-semibold">带妈妈去苏州</h1>
        </div>
        <div className="hidden items-center gap-5 text-sm lg:flex">
          <span><strong className="tabular-nums">¥1,107</strong><span className="text-[var(--color-ink-muted)]"> / ¥5,000</span></span>
          <span className="inline-flex items-center gap-1.5 text-[var(--color-primary)]"><CheckCircle size={17} weight="fill" aria-hidden="true" /> 已自动保存</span>
        </div>
        <button type="button" className="button-secondary" onClick={onToday}>
          <Compass size={18} aria-hidden="true" /> 今日模式
        </button>
      </header>

      <div className="workspace-grid">
        <aside className="day-rail" aria-label="旅行日期">
          <div className="mb-5 px-2">
            <p className="section-kicker">3 DAYS</p>
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">10月2日—4日</p>
          </div>
          <div className="space-y-2">
            {days.map((day, index) => (
              <button
                key={day.id}
                type="button"
                className={`day-button ${dayIndex === index ? 'day-button-active' : ''}`}
                onClick={() => setDayIndex(index)}
                aria-pressed={dayIndex === index}
              >
                <span className="font-display text-2xl font-semibold tabular-nums">{index + 1}</span>
                <span className="min-w-0 text-left">
                  <span className="block text-xs font-semibold">{day.date} · {day.weekday}</span>
                  <span className="mt-1 block truncate text-[11px] opacity-70">{day.title}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-6 space-y-3 border-t border-[var(--color-line)] px-2 pt-5 text-sm">
            <p className="flex items-center gap-2"><LockSimple size={17} aria-hidden="true" /><span>3 个锁定地点</span></p>
            <p className="flex items-center gap-2"><Footprints size={17} aria-hidden="true" /><span>总步行 20.8 km</span></p>
            <p className="flex items-center gap-2"><CurrencyCny size={17} aria-hidden="true" /><span>预算余量 77%</span></p>
          </div>
        </aside>

        <section className="itinerary-pane" aria-label={`${activeDay.date}行程`}>
          <div className="itinerary-scroll">
            <div className="mb-6 flex flex-col justify-between gap-4 border-b border-[var(--color-line)] pb-5 sm:flex-row sm:items-end">
              <div>
                <p className="section-kicker">DAY {dayIndex + 1} · {activeDay.date}</p>
                <h2 className="mt-2 font-display text-3xl font-semibold">{activeDay.title}</h2>
              </div>
              <div className="flex items-center gap-4 text-sm text-[var(--color-ink-muted)]">
                <span className="inline-flex items-center gap-1.5">{activeDay.weather.includes('雨') ? <CloudRain size={19} aria-hidden="true" /> : <CloudSun size={19} aria-hidden="true" />}{activeDay.weather}</span>
                <span className="inline-flex items-center gap-1.5"><Footprints size={19} aria-hidden="true" />{activeDay.walking}</span>
              </div>
            </div>

            {dayIndex === 1 && !rainPlanApplied && (
              <button type="button" className="conflict-banner" onClick={() => setPanel('conflicts')}>
                <WarningCircle size={22} weight="fill" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left"><strong>这一天可能太累</strong><span className="ml-2 text-sm">雨天步行 9.4 km，山塘街石板路湿滑</span></span>
                <span className="text-sm font-semibold">查看 2 个风险</span><CaretRight size={18} aria-hidden="true" />
              </button>
            )}

            <ol className="timeline-list">
              {activeDay.items.map((item, index) => (
                <li key={item.id} className="timeline-row">
                  <div className="timeline-time tabular-nums">{item.time}</div>
                  <div className="timeline-marker" aria-hidden="true"><span>{index + 1}</span></div>
                  <article className={`itinerary-item ${activeItemId === item.id ? 'itinerary-item-active' : ''}`}>
                    <button type="button" className="absolute inset-0 rounded-[12px]" onClick={() => setActiveItemId(item.id)} aria-label={`在地图中查看 ${item.title}`} />
                    <div className="relative pointer-events-none">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold">{item.title}</h3>
                            {item.locked && <span className="status-tag"><LockSimple size={13} aria-hidden="true" />已锁定</span>}
                            {item.status === 'booked' && <span className="status-tag status-tag-booked"><Ticket size={13} aria-hidden="true" />已预约</span>}
                          </div>
                          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{item.category} · {item.duration} · 预计 ¥{item.cost}</p>
                        </div>
                        <span className="rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ink-muted)]">{item.freshness}</span>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-[var(--color-ink-muted)]">{item.reason}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-muted)]">
                        <span>来源：{item.source}</span>
                        <span className="font-medium text-[var(--color-primary)]">为什么这样排</span>
                      </div>
                    </div>
                  </article>
                  {index < activeDay.items.length - 1 && (
                    <div className="route-leg">
                      <span>{activeDay.items[index + 1].travel ?? '步行 10 分钟'}</span>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <form
            className="command-bar"
            onSubmit={(event) => {
              event.preventDefault();
              startRun(command);
            }}
            aria-busy={runState === 'understanding' || runState === 'validating'}
          >
            <div className="mb-2 flex items-center justify-between gap-3 px-1 text-xs font-semibold text-[var(--color-ink-muted)]">
              <span>正在修改：{activeDay.date}</span>
              <button type="button" className="text-[var(--color-primary)] hover:underline" onClick={() => setCommand('第二天下雨，而且妈妈累了，请减少步行但保留留园。')}>填入演示指令</button>
            </div>
            <div className="flex items-end gap-2 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-paper)] p-2 shadow-[0_12px_32px_rgba(47,51,47,.1)] focus-within:border-[var(--color-primary)] focus-within:ring-3 focus-within:ring-[var(--color-focus)]/15">
              <label htmlFor="trip-command" className="sr-only">告诉旅行搭子想修改的行程</label>
              <textarea
                id="trip-command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                rows={1}
                className="min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base outline-none"
                placeholder="告诉旅行搭子你想改哪里…"
              />
              {runState === 'understanding' || runState === 'validating' ? (
                <button type="button" className="command-stop" onClick={stopRun}><StopCircle size={20} aria-hidden="true" />停止</button>
              ) : (
                <button type="submit" className="command-send" disabled={!command.trim()} aria-label="发送行程修改指令"><PaperPlaneTilt size={21} weight="fill" aria-hidden="true" /></button>
              )}
            </div>
          </form>
        </section>

        <aside className="right-panel">
          <div className="right-tabs" role="tablist" aria-label="行程辅助面板">
            {panelTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={panel === tab.id}
                  className={`right-tab ${panel === tab.id ? 'right-tab-active' : ''}`}
                  onClick={() => setPanel(tab.id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{tab.label}</span>
                  {!!tab.badge && <span className="tab-badge" aria-label={`${tab.badge} 项`}>{tab.badge}</span>}
                </button>
              );
            })}
          </div>
          <div className="right-panel-content" role="tabpanel">
            {panel === 'map' && <MapPanel day={activeDay} activeId={activeItemId} onSelect={setActiveItemId} />}
            {panel === 'agent' && (
              <AgentPanel
                state={runState}
                command={submittedCommand}
                onRun={() => startRun('第二天下雨，而且妈妈累了，请减少步行但保留留园。')}
                onApply={applyPatch}
                onStop={stopRun}
              />
            )}
            {panel === 'conflicts' && <ConflictPanel resolved={rainPlanApplied} onPreview={() => startRun('修复第二天的雨天步行风险，但保留留园。')} />}
            {panel === 'versions' && <VersionsPanel versions={versions} onRestore={restore} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MapPanel({ day, activeId, onSelect }: { day: TripDay; activeId: string; onSelect: (id: string) => void }) {
  const active = day.items.find((item) => item.id === activeId) ?? day.items[0];
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Suspense fallback={<div className="trip-map-placeholder" role="status">正在准备地图组件…</div>}>
        <TripMap items={day.items} activeId={activeId} onSelect={onSelect} />
      </Suspense>
      <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
        <p className="section-kicker">SELECTED PLACE</p>
        <div className="mt-2 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-success-bg)] text-[var(--color-primary)]"><MapPin size={21} weight="fill" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{active.title}</h3>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{active.time} · {active.duration}</p>
          </div>
        </div>
        <a
          className="map-external-link"
          href={`https://www.openstreetmap.org/?mlat=${active.coordinates[0]}&mlon=${active.coordinates[1]}#map=16/${active.coordinates[0]}/${active.coordinates[1]}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`在 OpenStreetMap 查看 ${active.title}（新窗口）`}
        >
          在 OpenStreetMap 查看 <CaretRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function AgentPanel({
  state,
  command,
  onRun,
  onApply,
  onStop,
}: {
  state: RunState;
  command: string;
  onRun: () => void;
  onApply: () => void;
  onStop: () => void;
}) {
  if (state === 'idle') {
    return (
      <div className="flex h-full flex-col justify-between gap-8">
        <div>
          <p className="section-kicker">TRAVEL COMPANION</p>
          <h2 className="mt-2 font-display text-2xl font-semibold">我可以帮你局部调整</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">我会先说明改动范围，再给出可预览的方案。锁定地点不会被静默删除。</p>
          <div className="mt-7 space-y-2">
            {['第二天下雨，而且妈妈累了', '把第二天下午安排得轻松一点', '预算减少 20% 会影响什么'].map((item) => (
              <button key={item} type="button" className="agent-suggestion" onClick={item.startsWith('第二天') ? onRun : onRun}>
                <PencilLine size={18} aria-hidden="true" /><span>{item}</span><CaretRight size={16} className="ml-auto" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <EmptyNotebook label="试着描述天气、体力、预算或某一天的变化。" />
      </div>
    );
  }

  if (state === 'understanding' || state === 'validating') {
    return (
      <div aria-live="polite" className="flex h-full flex-col">
        <p className="section-kicker">AGENT RUN</p>
        <h2 className="mt-2 font-display text-2xl font-semibold">{state === 'understanding' ? '正在理解修改范围' : '正在检查新方案'}</h2>
        <blockquote className="mt-5 rounded-[10px] border-l-4 border-[var(--color-coral)] bg-[var(--color-paper)] p-4 text-sm leading-6">“{command}”</blockquote>
        <ol className="mt-7 space-y-5">
          <ProgressStep done title="作用范围" detail="第 2 天 · 未执行项目" />
          <ProgressStep done={state === 'validating'} active={state === 'understanding'} title="保护内容" detail="留园、已预约与锁定项目" />
          <ProgressStep active={state === 'validating'} title="约束校验" detail="天气、步行量、交通与预算" />
        </ol>
        <button type="button" className="button-secondary mt-auto" onClick={onStop}><StopCircle size={18} aria-hidden="true" />停止这次调整</button>
      </div>
    );
  }

  if (state === 'preview') {
    return (
      <div className="space-y-5">
        <div>
          <p className="section-kicker">CHANGE PREVIEW</p>
          <h2 className="mt-2 font-display text-2xl font-semibold">雨天轻松方案</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">仅调整第 2 天，留园保持不变。预计步行从 9.4 km 降至 4.8 km，费用增加 ¥65。</p>
        </div>
        <div className="patch-summary">
          <PatchRow kind="替换" oldValue="虎丘" newValue="苏州丝绸博物馆" reason="减少坡路与雨中步行" />
          <PatchRow kind="移动" oldValue="松鹤楼 12:10" newValue="松鹤楼 11:50" reason="衔接室内路线" />
          <PatchRow kind="保留" oldValue="留园 14:20" newValue="留园 13:40" reason="保留用户选定园林" />
          <PatchRow kind="替换" oldValue="山塘街夜游" newValue="评弹茶馆" reason="避开湿滑石板路" />
        </div>
        <div className="sticky-note text-sm leading-6"><strong>仍有假设：</strong>评弹茶馆当天有 16:30 场次；当前使用演示数据，应用后会标记来源。</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="button-primary flex-1" onClick={onApply}><Check size={18} aria-hidden="true" />应用第二天变更</button>
          <button type="button" className="button-secondary" onClick={onStop}>保留原计划</button>
        </div>
      </div>
    );
  }

  if (state === 'succeeded') {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center" aria-live="polite">
        <span className="success-stamp"><Stamp size={42} aria-hidden="true" /></span>
        <p className="section-kicker mt-6">VERSION 2 SAVED</p>
        <h2 className="mt-2 font-display text-3xl font-semibold">第二天已经轻松一些</h2>
        <p className="mt-4 max-w-xs text-sm leading-6 text-[var(--color-ink-muted)]">4 项变更已应用并重新校验。原方案仍保存在版本记录中。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center text-center" aria-live="polite">
      <StopCircle size={50} className="text-[var(--color-ink-muted)]" aria-hidden="true" />
      <h2 className="mt-5 font-display text-2xl font-semibold">已停止这次调整</h2>
      <p className="mt-3 max-w-xs text-sm leading-6 text-[var(--color-ink-muted)]">行程没有被修改。你可以换一种说法，或继续使用当前计划。</p>
      <button type="button" className="button-secondary mt-6" onClick={onRun}><ArrowCounterClockwise size={18} aria-hidden="true" />重新生成</button>
    </div>
  );
}

function ProgressStep({ done, active, title, detail }: { done?: boolean; active?: boolean; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${done ? 'border-[var(--color-primary)] bg-[var(--color-success-bg)] text-[var(--color-primary)]' : active ? 'agent-pulse border-[var(--color-coral)] text-[var(--color-coral)]' : 'border-[var(--color-line)] text-[var(--color-ink-muted)]'}`}>
        {done ? <Check size={15} weight="bold" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{detail}</p></div>
    </li>
  );
}

function PatchRow({ kind, oldValue, newValue, reason }: { kind: string; oldValue: string; newValue: string; reason: string }) {
  return (
    <div className="border-b border-[var(--color-line)] py-4 last:border-0">
      <div className="flex items-center gap-2"><span className="patch-kind">{kind}</span><span className="text-xs text-[var(--color-ink-muted)]">{reason}</span></div>
      <p className="mt-3 text-sm text-[var(--color-ink-muted)] line-through decoration-[var(--color-danger)]">{oldValue}</p>
      <p className="mt-1 flex items-center gap-2 font-semibold text-[var(--color-primary-hover)]"><ArrowRight size={15} aria-hidden="true" />{newValue}</p>
    </div>
  );
}

function ConflictPanel({ resolved, onPreview }: { resolved: boolean; onPreview: () => void }) {
  if (resolved) return <EmptyNotebook label="当前计划没有阻断项。第二天的雨天步行风险已经处理。" />;
  return (
    <div>
      <p className="section-kicker">2 RISKS FOUND</p>
      <h2 className="mt-2 font-display text-2xl font-semibold">需要留意的现实条件</h2>
      <div className="mt-6 space-y-4">
        <article className="conflict-card conflict-warning">
          <div className="flex gap-3"><WarningCircle size={23} weight="fill" className="shrink-0" aria-hidden="true" /><div><p className="font-semibold">雨天步行量偏高</p><p className="mt-2 text-sm leading-6">第 2 天共步行 9.4 km，超出长辈同行的建议范围约 2.4 km。</p></div></div>
          <button type="button" className="button-secondary mt-4 w-full" onClick={onPreview}>预览雨天修复</button>
        </article>
        <article className="conflict-card conflict-suggestion">
          <div className="flex gap-3"><Umbrella size={23} className="shrink-0" aria-hidden="true" /><div><p className="font-semibold">山塘街石板路湿滑</p><p className="mt-2 text-sm leading-6">建议准备室内替代，不直接删除原计划。</p></div></div>
          <button type="button" className="button-tertiary mt-3" onClick={onPreview}>一起处理</button>
        </article>
      </div>
    </div>
  );
}

function VersionsPanel({ versions, onRestore }: { versions: PlanVersion[]; onRestore: () => void }) {
  return (
    <div>
      <p className="section-kicker">PLAN HISTORY</p>
      <h2 className="mt-2 font-display text-2xl font-semibold">行程版本</h2>
      <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">每次 Agent 修改都创建版本，不覆盖原计划。</p>
      <ol className="mt-6 space-y-3">
        {versions.map((version) => (
          <li key={version.id} className={`version-item ${version.active ? 'version-item-active' : ''}`}>
            <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{version.title}</h3>{version.active && <span className="status-tag">当前</span>}</div>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{version.time}</p>
            <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">{version.note}</p>
            {!version.active && <button type="button" className="button-tertiary mt-3" onClick={onRestore}><ArrowCounterClockwise size={17} aria-hidden="true" />恢复这个版本</button>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TodayPage({ day, onWorkspace }: { day: TripDay; onWorkspace: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(1);
  const current = day.items[currentIndex];
  const next = day.items[currentIndex + 1];
  return (
    <section className="mx-auto max-w-[1080px] px-5 py-8 md:px-10 md:py-12">
      <div className="mb-8 flex flex-col justify-between gap-5 border-b border-[var(--color-line)] pb-6 sm:flex-row sm:items-end">
        <div><p className="section-kicker">TODAY · {day.date}</p><h1 className="mt-2 font-display text-4xl font-semibold">正在苏州的第一天</h1></div>
        <button type="button" className="button-secondary" onClick={onWorkspace}><MapTrifold size={18} aria-hidden="true" />查看完整行程</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <article className="paper-sheet p-6 md:p-9">
          <div className="flex items-center justify-between gap-4"><span className="rounded-full bg-[var(--color-success-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-hover)]">当前事项</span><span className="text-sm font-semibold tabular-nums">{current.time}</span></div>
          <div className="mt-8 flex items-start gap-5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-[var(--color-primary)] bg-[var(--color-paper)] text-[var(--color-primary)]"><MapPin size={27} weight="fill" aria-hidden="true" /></span>
            <div><h2 className="font-display text-3xl font-semibold">{current.title}</h2><p className="mt-2 text-[var(--color-ink-muted)]">预计停留 {current.duration} · {current.category}</p></div>
          </div>
          <div className="my-8 h-px bg-[var(--color-line)]" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="field-label">为什么现在去</p><p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">{current.reason}</p></div>
            <div><p className="field-label">现场信息</p><p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">预约二维码已保存 · 演示数据<br />建议 12:40 前离开</p></div>
          </div>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button type="button" className="button-primary flex-1" onClick={() => setCurrentIndex((value) => Math.min(value + 1, day.items.length - 1))}><CheckCircle size={20} weight="fill" aria-hidden="true" />完成这一站</button>
            <button type="button" className="button-secondary" onClick={() => setCurrentIndex((value) => Math.min(value + 1, day.items.length - 1))}>跳过</button>
          </div>
        </article>

        <div className="space-y-5">
          <article className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
            <p className="section-kicker">NEXT</p>
            {next ? <><h2 className="mt-2 text-xl font-semibold">{next.time} · {next.title}</h2><p className="mt-3 text-sm text-[var(--color-ink-muted)]">{next.travel ?? '步行约 10 分钟'}</p><div className="mt-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)]"><Clock size={18} aria-hidden="true" />建议 13:58 出发</div></> : <p className="mt-3 text-sm text-[var(--color-ink-muted)]">今天的安排已经完成。</p>}
          </article>
          <article className="sticky-note">
            <div className="flex gap-3"><CloudSun size={23} className="shrink-0" aria-hidden="true" /><div><p className="font-semibold">24°，傍晚转多云</p><p className="mt-2 text-sm leading-6">平江路 17:00 后体感更舒适，当前计划无需调整。</p></div></div>
          </article>
          <button type="button" className="replan-button" onClick={onWorkspace}><PencilLine size={21} aria-hidden="true" /><span><strong>临时有变化？</strong><small>告诉旅行搭子，只重排剩余行程</small></span><CaretRight size={18} className="ml-auto" aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  );
}

function ReviewPage({ days }: { days: TripDay[] }) {
  const [pace, setPace] = useState('刚刚好');
  const downloadReview = () => {
    const content = `# 带妈妈去苏州\n\n- 3 天 2 夜\n- ${days.reduce((sum, day) => sum + day.items.length, 0)} 个行程节点\n- 计划预算 ¥5,000\n\n由 SuperTravel Demo 导出。`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'supertravel-suzhou-review.md';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-10 md:px-10 md:py-16">
      <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
        <div><p className="section-kicker">TRIP REVIEW</p><h1 className="mt-3 font-display text-5xl font-semibold tracking-tight">苏州，慢慢走完的一页</h1><p className="mt-4 max-w-2xl leading-8 text-[var(--color-ink-muted)]">把计划与实际放在一起，下次旅行会更懂你的节奏。</p></div>
        <button type="button" className="button-secondary" onClick={downloadReview}><DownloadSimple size={19} aria-hidden="true" />导出回顾</button>
      </div>
      <div className="review-book mt-10">
        <div className="review-page review-page-left">
          <CityLineDoodle className="w-full text-[var(--color-ink)]" />
          <div className="mt-8 grid grid-cols-2 gap-x-7 gap-y-8 border-t border-[var(--color-line)] pt-8">
            <ReviewStat value="3" label="旅行天数" />
            <ReviewStat value="11" label="实际到访" />
            <ReviewStat value="17.6" label="步行公里" />
            <ReviewStat value="¥1,284" label="实际花费" />
          </div>
          <span className="review-stamp"><Stamp size={28} aria-hidden="true" /> COMPLETED</span>
        </div>
        <div className="review-page">
          <p className="section-kicker">YOUR NOTES</p>
          <h2 className="mt-2 font-display text-3xl font-semibold">这次节奏怎么样？</h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {['有点赶', '刚刚好', '还可以更丰富'].map((item) => <button key={item} type="button" className={`suggestion-chip ${pace === item ? 'suggestion-chip-active' : ''}`} onClick={() => setPace(item)} aria-pressed={pace === item}>{item}</button>)}
          </div>
          <div className="mt-8 space-y-4">
            <div className="memory-note"><CheckCircle size={20} weight="fill" aria-hidden="true" /><p><strong>记忆候选：</strong>与长辈同行时，每天步行约 6 km 最舒服。</p></div>
            <div className="memory-note"><ForkKnife size={20} aria-hidden="true" /><p><strong>饮食偏好：</strong>午餐优先清淡本地菜，避开连续排队餐厅。</p></div>
          </div>
          <div className="mt-8 flex gap-3"><button type="button" className="button-primary"><Check size={18} aria-hidden="true" />保存这些偏好</button><button type="button" className="button-tertiary">暂不保存</button></div>
        </div>
      </div>
    </section>
  );
}

function ReviewStat({ value, label }: { value: string; label: string }) {
  return <div><strong className="font-display text-3xl font-semibold tabular-nums">{value}</strong><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{label}</p></div>;
}

export default App;
