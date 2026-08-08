import {
  Bed,
  BellRinging,
  ClockCounterClockwise,
  MapTrifold,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { AgentThread } from './components/AgentThread';
import { AppFrame, type AppPage } from './components/AppFrame';
import { DecisionCenter } from './components/DecisionCenter';
import { HomePage } from './components/HomePage';
import { SettingsPage } from './components/SettingsPage';
import { TripMapCanvas } from './components/TripMapCanvas';
import { Timeline } from './components/Timeline';
import { TodayMode } from './components/TodayMode';
import { TripBrief } from './components/TripBrief';
import { WatchPanel } from './components/WatchPanel';
import { useAgentRun } from './hooks/useAgentRun';
import type {
  AgentEvent,
  AgentActivityEventData,
  AgentRunState,
  AgentRunData,
  Decision,
  ItineraryItem,
  Readiness,
  RunProcessStep,
  RunStatus,
  SourceRecordData,
  ThreadData,
  ThreadSummary,
  TripDetail,
  TripSummary,
  UIComponentData,
  UserProfile,
  Watch,
} from './types';

type CanvasPanel = 'map' | 'stay' | 'watch' | 'versions';

type AppLocation = {
  page: AppPage;
  tripId?: string;
  threadId?: string;
};

const ACTIVE_RUN_STATUSES = new Set<RunStatus>(['QUEUED', 'RUNNING', 'WAITING_USER', 'PARTIAL']);
const LAST_WORKSPACE_LOCATION = 'supertravel:last-workspace-location';

function readAppLocation(): AppLocation {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments[0] === 'trips' && segments[1]) {
    if (segments[2] === 'today') return { page: 'today', tripId: segments[1] };
    return {
      page: 'workspace',
      tripId: segments[1],
      threadId: segments[2] === 'threads' ? segments[3] : undefined,
    };
  }
  if (segments[0] === 'decisions') return { page: 'decisions' };
  if (segments[0] === 'settings') return { page: 'settings' };
  return { page: 'home' };
}

function workspacePath(tripId: string, threadId?: string | null): string {
  return threadId ? `/trips/${tripId}/threads/${threadId}` : `/trips/${tripId}`;
}

function pushLocation(path: string, replace = false) {
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', path);
}

function rememberWorkspaceLocation(tripId: string, threadId: string | null | undefined) {
  window.localStorage.setItem(LAST_WORKSPACE_LOCATION, JSON.stringify({ tripId, threadId: threadId ?? null }));
}

function activeRunForThread(value: ThreadData | null) {
  return [...(value?.runs ?? [])].reverse().find((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

function statusFromAgentEvent(event: AgentEvent, current: RunStatus): RunStatus {
  if (event.type === 'run.waiting_user') return 'WAITING_USER';
  if (event.type === 'run.partial') return 'PARTIAL';
  if (event.type === 'run.failed') return 'FAILED';
  if (event.type === 'run.cancelled') return 'CANCELLED';
  if (event.type === 'run.completed') return 'SUCCEEDED';
  if (event.type === 'run.started') {
    return event.payload.status === 'QUEUED' ? 'QUEUED' : 'RUNNING';
  }
  if (event.type === 'run.recovered') return 'RUNNING';
  return current === 'WAITING_USER' ? current : 'RUNNING';
}

function publicToolLabel(name: string): string {
  return {
    map_geocode: '解析地理位置',
    map_directions: '计算真实路线',
    place_search: '搜索候选地点',
    place_detail: '读取地点详情',
    geocode: '定位目的地',
    route_search: '核对相邻路线',
    weather_search: '查询天气',
    web_search: '搜索公开网页',
    web_fetch: '读取公开网页',
    xhs_search: '搜索社区经验',
    xhs_get_note: '读取社区笔记',
    rail_search: '查询铁路班次',
  }[name] ?? '查询真实数据';
}

function publicIntentLabel(value: unknown): string {
  return {
    CREATE_TRIP: '开始一段旅行',
    PLAN_ITINERARY: '规划旅行',
    SEARCH_PLACE: '查询地点',
    ASK_TRIP_QUESTION: '回答当前问题',
    ANSWER_CLARIFICATION: '回答当前问题',
    UPDATE_TRIP_SPEC: '补充旅行条件',
    MODIFY_PLAN: '调整已有计划',
    EXPLAIN_PLAN: '解释已有计划',
  }[String(value)] ?? '理解当前需求';
}

function publicStageLabel(value: unknown): string {
  return {
    DISCOVERY: '探索旅行想法',
    BRIEFING: '目的地介绍',
    PREFERENCE: '了解旅行偏好',
    DIRECTION_REVIEW: '比较玩法方向',
    DRAFT_REVIEW: '查看按天草案',
    FINALIZING: '核对正式计划',
    PLAN_REVIEW: '确认计划变更',
    PLAN_ACTIVE: '照看进行中的计划',
  }[String(value)] ?? String(value || '当前阶段');
}

function processStepFromEvent(event: AgentEvent): RunProcessStep | null {
  const payload = event.payload;
  if (['progress.started', 'progress.updated', 'progress.completed'].includes(event.type)) {
    return {
      id: String(payload.activity_id ?? `progress:${String(payload.step_id ?? event.event_id)}`),
      kind: 'progress',
      label: String(payload.title ?? '正在处理'),
      detail: String(payload.summary ?? ''),
      status: event.type === 'progress.completed' ? 'completed' : 'running',
      occurred_at: event.occurred_at,
      result: null,
      sources: [],
    };
  }
  if (event.type === 'intent.classified') {
    return {
      id: `intent:${event.event_id}`,
      kind: 'state',
      label: '已经识别本轮意图',
      detail: `当前重点是“${publicIntentLabel(payload.intent)}”。${payload.requires_tools ? '需要查询真实数据。' : '先用已有信息回答或继续澄清。'}`,
      status: 'completed',
      occurred_at: event.occurred_at,
      result: null,
      sources: [],
    };
  }
  if (event.type === 'conversation.stage.changed') {
    return {
      id: `stage:${event.event_id}`,
      kind: 'state',
      label: `进入${publicStageLabel(payload.stage)}`,
      detail: payload.previous_stage ? `从“${publicStageLabel(payload.previous_stage)}”进入当前阶段。` : '已根据当前对话更新阶段。',
      status: 'completed',
      occurred_at: event.occurred_at,
      result: null,
      sources: [],
    };
  }
  if (['tool.started', 'tool.completed', 'tool.failed'].includes(event.type)) {
    const toolCallId = String(payload.tool_call_id ?? event.event_id);
    const name = String(payload.name ?? '外部工具');
    const argumentsValue = payload.arguments as Record<string, unknown> | undefined;
    return {
      id: String(payload.activity_id ?? `tool:${toolCallId}`),
      kind: 'tool',
      label: publicToolLabel(name),
      detail: event.type === 'tool.started'
        ? `正在向${String(payload.provider ?? '真实数据服务')}查询。`
        : event.type === 'tool.failed'
          ? `查询未完成 · ${String(payload.provider ?? '真实数据服务')}`
          : `已返回${payload.cache_state === 'cached' ? '缓存' : '真实'}结果 · ${String(payload.provider ?? '真实数据服务')}`,
      status: event.type === 'tool.started' ? 'running' : event.type === 'tool.failed' ? 'failed' : 'completed',
      occurred_at: event.occurred_at,
      result: event.type === 'tool.failed' ? { error: String(payload.error ?? '工具未返回可用结果') } : payload.result,
      result_count: typeof payload.result_count === 'number' ? payload.result_count : null,
      arguments: argumentsValue ?? null,
      tool_name: name,
      provider: typeof payload.provider === 'string' ? payload.provider : null,
      cache_state: payload.cache_state === 'cached' || payload.cache_state === 'stale' || payload.cache_state === 'live'
        ? payload.cache_state
        : null,
      sources: Array.isArray(payload.sources) ? payload.sources as SourceRecordData[] : [],
    };
  }
  if (event.type === 'run.completed') {
    return {
      id: `state:${event.event_id}`,
      kind: 'state',
      label: '本次处理完成',
      detail: '结果和执行记录已保存',
      status: 'completed',
      occurred_at: event.occurred_at,
      result: null,
      sources: [],
    };
  }
  return null;
}

function activityFromEvent(event: AgentEvent): AgentActivityEventData | null {
  const payload = event.payload;
  const activityId = typeof payload.activity_id === 'string' ? payload.activity_id : null;
  if (!activityId) return null;
  const isTool = event.type.startsWith('tool.');
  const isDecision = event.type.startsWith('question.') || event.type.startsWith('component.');
  const isValidation = event.type.startsWith('validation.');
  const status: AgentActivityEventData['status'] = event.type.endsWith('.failed') || event.type === 'run.failed'
    ? 'failed'
    : event.type === 'run.cancelled'
      ? 'cancelled'
      : event.type === 'run.waiting_user' || event.type === 'question.created' || event.type === 'component.created'
        ? 'waiting'
        : event.type.endsWith('.completed') || event.type === 'question.answered' || event.type === 'component.updated' || event.type === 'run.completed'
          ? 'completed'
          : 'running';
  return {
    id: `activity:${activityId}`,
    event_id: event.event_id,
    sequence: event.sequence,
    activity_id: activityId,
    phase: isValidation ? 'validation' : isTool ? 'research' : isDecision ? 'understanding' : String(payload.step_id ?? '').includes('decision') ? 'planning' : 'response',
    kind: isValidation ? 'validation' : isTool ? (event.type === 'tool.started' ? 'tool_call' : 'tool_result') : isDecision ? 'decision' : 'progress',
    status,
    title: String(payload.title ?? payload.name ?? (isTool ? '真实信息查询' : '正在处理')),
    summary: payload.summary != null ? String(payload.summary) : payload.error != null ? String(payload.error) : null,
    detail: payload,
    created_at: event.occurred_at,
  };
}

function dateRange(trip: TripSummary) {
  const start = trip.trip_spec.start_date.value;
  const end = trip.trip_spec.end_date.value;
  return start && end ? `${start} — ${end}` : '日期待确认';
}

const technicalErrorPattern = /(sqlalchemy|asyncpg|IntegrityError|UniqueViolationError|INSERT INTO|SELECT .* FROM|sqlalche\.me)/i;

function displayError(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : fallback;
  if (technicalErrorPattern.test(raw)) {
    return '对话状态保存时发生冲突，现有 Trip State 和历史消息均已保留。请重新发送当前需求。';
  }
  return raw.length > 360 ? `${raw.slice(0, 357)}…` : raw || fallback;
}

function App() {
  const [page, setPage] = useState<AppPage>(() => readAppLocation().page);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const activeThreadIdRef = useRef<string | null>(null);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [versions, setVersions] = useState<Array<{ version: number; reason: string; created_at: string }>>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [retryableRunId, setRetryableRunId] = useState<string | null>(null);
  const [runStreamKey, setRunStreamKey] = useState(0);
  const [runStatusByThread, setRunStatusByThread] = useState<Record<string, RunStatus>>({});
  const [activeDay, setActiveDay] = useState(1);
  const [activeItemId, setActiveItemId] = useState<string>();
  const [canvasPanel, setCanvasPanel] = useState<CanvasPanel>('map');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('supertravel:sidebar-collapsed') === 'true');
  const [showWorkProcess, setShowWorkProcess] = useState(() => window.localStorage.getItem('supertravel:show-work-process') !== 'false');
  const locationHydratedRef = useRef(false);
  const refreshGenerationRef = useRef(0);

  const runStatus = thread ? runStatusByThread[thread.id] ?? 'SUCCEEDED' : 'SUCCEEDED';
  const updateRunStatus = useCallback((threadId: string | null | undefined, status: RunStatus) => {
    if (!threadId) return;
    setRunStatusByThread((current) => ({ ...current, [threadId]: status }));
  }, []);

  const refreshHome = useCallback(async () => {
    const [nextReadiness, nextTrips, nextProfile] = await Promise.all([api.readiness(), api.trips(), api.profile()]);
    setReadiness(nextReadiness);
    setTrips(nextTrips);
    setProfile(nextProfile);
  }, []);

  const updateTripCategories = async (tripIds: string[], category: string) => {
    setError(null);
    try {
      const results = await Promise.allSettled(tripIds.map((tripId) => api.updateTrip(tripId, { category })));
      await refreshHome();
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    } catch (reason) {
      setError(displayError(reason, '归类旅程失败'));
      throw reason;
    }
  };

  const deleteTrips = async (tripIds: string[]) => {
    setError(null);
    try {
      const results = await Promise.allSettled(tripIds.map((tripId) => api.deleteTrip(tripId)));
      await refreshHome();
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed) throw failed.reason;
    } catch (reason) {
      setError(displayError(reason, '删除旅程失败'));
      throw reason;
    }
  };

  const updateSidebarCollapsed = (value: boolean) => {
    setSidebarCollapsed(value);
    window.localStorage.setItem('supertravel:sidebar-collapsed', String(value));
  };

  const updateShowWorkProcess = (value: boolean) => {
    setShowWorkProcess(value);
    window.localStorage.setItem('supertravel:show-work-process', String(value));
  };

  const refreshTrip = useCallback(async (tripId: string, preferredThreadId?: string | null) => {
    const generation = ++refreshGenerationRef.current;
    const [nextTrip, nextThreads] = await Promise.all([
      api.trip(tripId),
      api.threads(tripId),
    ]);
    const [watchesResult, decisionsResult, versionsResult] = await Promise.allSettled([
      api.watches(tripId),
      api.decisions(tripId),
      api.versions(tripId),
    ]);
    const nextWatches = watchesResult.status === 'fulfilled' ? watchesResult.value : [];
    const nextDecisions = decisionsResult.status === 'fulfilled' ? decisionsResult.value : [];
    const nextVersions = versionsResult.status === 'fulfilled' ? versionsResult.value : [];
    const requestedId = preferredThreadId ?? activeThreadIdRef.current;
    const selected = nextThreads.find((item) => item.id === requestedId)
      ?? nextThreads.find((item) => item.status === 'ACTIVE')
      ?? nextThreads[0];
    const nextThread = selected ? await api.threadById(tripId, selected.id) : null;
    if (generation !== refreshGenerationRef.current) return;
    setTrip(nextTrip);
    setThread(nextThread);
    setThreads(nextThreads);
    activeThreadIdRef.current = selected?.id ?? null;
    if (nextThread) {
      const latestRun = nextThread.runs[nextThread.runs.length - 1];
      const activeRun = activeRunForThread(nextThread);
      if (latestRun) setRunStatusByThread((current) => ({ ...current, [nextThread.id]: latestRun.status }));
      setRunId(activeRun?.id ?? null);
      if (latestRun?.status === 'FAILED') {
        setRetryableRunId(latestRun.id);
        setError(latestRun.error?.message ?? '这次处理没有完成，请重试当前操作。');
      } else {
        setRetryableRunId(null);
        setError(null);
      }
      rememberWorkspaceLocation(tripId, nextThread.id);
    } else {
      setRunId(null);
    }
    setWatches(nextWatches);
    setDecisions(nextDecisions);
    setVersions(nextVersions);
    if (nextTrip.current_plan?.days.length) {
      setActiveDay((current) => (
        nextTrip.current_plan?.days.some((day) => day.day_index === current)
          ? current
          : nextTrip.current_plan?.days[0].day_index ?? 1
      ));
    }
  }, []);

  useEffect(() => {
    refreshHome().catch((reason: Error) => setError(displayError(reason, '无法读取旅程'))).finally(() => setLoading(false));
  }, [refreshHome]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    const eventThreadId = event.thread_id;
    if (!eventThreadId) return;
    if (eventThreadId !== activeThreadIdRef.current) {
      // A background Run from another conversation may still finish after the
      // user switches threads. It must not replace the active transcript or
      // overwrite its Run status.
      if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) {
        void refreshHome().catch(() => undefined);
      }
      return;
    }
    if (event.run_id) {
      const processStep = processStepFromEvent(event);
      const discoveredSource = event.type === 'source.discovered' ? event.payload.source as SourceRecordData | undefined : undefined;
      setThread((current) => {
        if (!current || current.id !== eventThreadId) return current;
        const existing = current.runs.find((item) => item.id === event.run_id);
        const existingStatus = existing?.status ?? 'RUNNING';
        const nextStatus = statusFromAgentEvent(event, existingStatus);
        const baseRun: AgentRunData = existing ?? {
          id: event.run_id!,
          status: nextStatus,
          intent: null,
          current_step: event.type,
          created_at: event.occurred_at,
          completed_at: null,
          steps: [],
          activities: [],
          sources: [],
        };
        let nextRun = { ...baseRun, status: nextStatus, current_step: event.type };
        const activity = activityFromEvent(event);
        if (activity) {
          const activityIndex = nextRun.activities.findIndex((item) => item.activity_id === activity.activity_id);
          const previousActivity = activityIndex >= 0 ? nextRun.activities[activityIndex] : undefined;
          const mergedActivity = previousActivity
            ? { ...previousActivity, ...activity, created_at: previousActivity.created_at }
            : activity;
          nextRun = {
            ...nextRun,
            activities: activityIndex >= 0
              ? nextRun.activities.map((item, index) => index === activityIndex ? mergedActivity : item)
              : [...nextRun.activities, mergedActivity],
          };
        }
        if (processStep) {
          const stepIndex = nextRun.steps.findIndex((item) => item.id === processStep.id);
          const previousStep = stepIndex >= 0 ? nextRun.steps[stepIndex] : undefined;
          const mergedProcessStep = previousStep && processStep.kind === 'tool'
            ? {
              ...processStep,
              arguments: processStep.arguments ?? previousStep.arguments,
              tool_name: processStep.tool_name ?? previousStep.tool_name,
              provider: processStep.provider ?? previousStep.provider,
              sources: processStep.sources.length > 0 ? processStep.sources : previousStep.sources,
            }
            : processStep;
          nextRun = {
            ...nextRun,
            steps: stepIndex >= 0
              ? nextRun.steps.map((item, index) => index === stepIndex ? { ...item, ...mergedProcessStep } : item)
              : [...nextRun.steps, mergedProcessStep],
          };
        }
        if (discoveredSource && !nextRun.sources.some((source) => source.id === discoveredSource.id)) {
          nextRun = { ...nextRun, sources: [...nextRun.sources, discoveredSource] };
        }
        const runs = existing
          ? current.runs.map((item) => item.id === event.run_id ? nextRun : item)
          : [...current.runs, nextRun];
        return { ...current, runs };
      });
    }
    if (event.type === 'message.delta' && event.run_id) {
      const delta = typeof event.payload.delta === 'string' ? event.payload.delta : '';
      if (!delta) return;
      setThread((current) => {
        if (!current || (event.thread_id && current.id !== event.thread_id)) return current;
        const streamId = `stream:${event.run_id}`;
        const existing = current.messages.find((item) => item.id === streamId);
        const messages = existing
          ? current.messages.map((item) => item.id === streamId ? { ...item, content: item.content + delta } : item)
          : [...current.messages, {
            id: streamId,
            role: 'assistant' as const,
            content: delta,
            run_id: event.run_id,
            meta: { kind: 'streaming_response' },
            created_at: event.occurred_at,
          }];
        return { ...current, messages };
      });
      return;
    }
    if (event.type === 'run.started') updateRunStatus(eventThreadId, event.payload.status === 'QUEUED' ? 'QUEUED' : 'RUNNING');
    else if (event.type === 'run.waiting_user') updateRunStatus(eventThreadId, 'WAITING_USER');
    else if (event.type === 'run.recovered') {
      updateRunStatus(eventThreadId, 'RUNNING');
      setRetryableRunId(null);
      setError(null);
    }
    else if (event.type === 'run.failed') {
      updateRunStatus(eventThreadId, 'FAILED');
      setRetryableRunId(event.run_id ?? null);
      setError(displayError(event.payload.message, 'Agent 运行失败'));
    } else if (event.type === 'run.cancelled') updateRunStatus(eventThreadId, 'CANCELLED');
    else if (event.type === 'run.completed') {
      updateRunStatus(eventThreadId, 'SUCCEEDED');
      setRetryableRunId((current) => current === event.run_id ? null : current);
      setError(null);
    }
    else if (event.type === 'run.partial') updateRunStatus(eventThreadId, 'PARTIAL');
    else if (event.type !== 'message.delta') updateRunStatus(eventThreadId, 'RUNNING');

    if (event.type === 'component.created' && event.payload.component) {
      const raw = event.payload.component as Record<string, unknown>;
      const incoming = {
        ...raw,
        run_id: raw.run_id ?? event.run_id,
        created_at: raw.created_at ?? event.occurred_at,
        value: raw.value ?? null,
      } as UIComponentData;
      setThread((current) => {
        if (!current || current.id !== eventThreadId || current.components.some((item) => item.id === incoming.id)) return current;
        return { ...current, components: [...current.components, incoming] };
      });
    } else if (event.type === 'component.updated' && typeof event.payload.component_id === 'string') {
      const componentId = event.payload.component_id;
      const nextState = event.payload.state as UIComponentData['state'] | undefined;
      setThread((current) => {
        if (!current || current.id !== eventThreadId) return current;
        return {
          ...current,
          components: current.components.map((item) => item.id === componentId && nextState ? { ...item, state: nextState } : item),
        };
      });
    } else if (event.type === 'trip.spec.updated' && event.payload.trip_spec) {
      setTrip((current) => current ? { ...current, trip_spec: event.payload.trip_spec as TripDetail['trip_spec'] } : current);
    }

    if (event.trip_id) {
      const refreshTripResource = event.type.startsWith('trip.') || event.type.startsWith('decision.')
        || ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type);
      if (refreshTripResource) {
        void refreshTrip(event.trip_id, eventThreadId).catch((reason: Error) => setError(displayError(reason, '无法刷新对话')));
      }
      if (event.type.startsWith('trip.') || event.type.startsWith('decision.') || ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) {
        void refreshHome().catch(() => undefined);
      }
    }
  }, [refreshHome, refreshTrip, updateRunStatus]);

  const { connection: runConnection } = useAgentRun(runId, handleAgentEvent, runStreamKey);

  // SSE is the low-latency path, but a browser can lose the stream while the
  // worker still finishes and persists the Run. Poll the durable Run record as
  // a recovery path so the UI cannot remain in RUNNING forever or require a
  // manual leave-and-reenter to display the saved answer.
  useEffect(() => {
    if (!runId) return undefined;
    let cancelled = false;
    let refreshInFlight = false;
    let lastRefreshedTerminalState = '';
    const terminalStatuses = new Set<RunStatus>(['SUCCEEDED', 'WAITING_USER', 'PARTIAL', 'FAILED', 'CANCELLED']);
    const syncRunState = async () => {
      try {
        const state: AgentRunState = await api.run(runId);
        if (cancelled) return;
        updateRunStatus(state.thread_id, state.status);
        const terminalStateKey = `${state.status}:${state.current_step ?? ''}`;
        if (terminalStatuses.has(state.status) && terminalStateKey !== lastRefreshedTerminalState && !refreshInFlight) {
          lastRefreshedTerminalState = terminalStateKey;
          refreshInFlight = true;
          try {
            await refreshTrip(state.trip_id, state.thread_id);
          } finally {
            refreshInFlight = false;
          }
        }
      } catch {
        // The SSE connection and the next poll remain available; a transient
        // status request must not replace the conversation with an error.
      }
    };
    void syncRunState();
    const timer = window.setInterval(() => void syncRunState(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshTrip, runId, updateRunStatus]);

  const openTrip = useCallback(async (tripId: string, preferredThreadId?: string | null, syncUrl = true) => {
    setLoading(true);
    setError(null);
    setRunId(null);
    setRunStatusByThread({});
    activeThreadIdRef.current = preferredThreadId ?? null;
    try {
      await refreshTrip(tripId, preferredThreadId);
      setPage('workspace');
      window.scrollTo({ top: 0, behavior: 'auto' });
      const selectedThreadId = activeThreadIdRef.current;
      rememberWorkspaceLocation(tripId, selectedThreadId);
      if (syncUrl) pushLocation(workspacePath(tripId, selectedThreadId));
    } catch (reason) {
      setError(displayError(reason, '无法打开 Trip'));
    } finally {
      setLoading(false);
    }
  }, [refreshTrip]);

  const resumeLastWorkspace = async () => {
    const raw = window.localStorage.getItem(LAST_WORKSPACE_LOCATION);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { tripId?: string; threadId?: string | null };
      if (saved.tripId) await openTrip(saved.tripId, saved.threadId);
    } catch {
      window.localStorage.removeItem(LAST_WORKSPACE_LOCATION);
    }
  };

  useEffect(() => {
    const applyLocation = (location: AppLocation) => {
      if (location.tripId) {
        void openTrip(location.tripId, location.threadId, false).then(() => {
          if (location.page === 'today') setPage('today');
        });
        return;
      }
      setPage(location.page);
      if (location.page === 'home') void refreshHome().catch(() => undefined);
    };

    if (!locationHydratedRef.current) {
      locationHydratedRef.current = true;
      applyLocation(readAppLocation());
    }
    const handlePopState = () => applyLocation(readAppLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [openTrip, refreshHome]);

  const sendMessage = async (message: string) => {
    setError(null);
    setRetryableRunId(null);
    if (!readiness?.ready) {
      setError('核心服务尚未就绪。请先填写 LLM 与百度地图 AK，再开始真实规划。');
      return;
    }
    try {
      let selectedThread = thread;
      if (trip && (!selectedThread || selectedThread.status === 'ARCHIVED')) {
        const created = await api.createThread(trip.id);
        activeThreadIdRef.current = created.id;
        selectedThread = await api.threadById(trip.id, created.id);
        setThread(selectedThread);
      }
      const response = await api.startTurn(message, trip?.id, selectedThread?.id);
      activeThreadIdRef.current = response.thread_id;
      setRunId(response.run_id);
      updateRunStatus(response.thread_id, response.status === 'QUEUED' ? 'RUNNING' : response.status);
      setPage('workspace');
      pushLocation(workspacePath(response.trip_id, response.thread_id));
      await refreshTrip(response.trip_id, response.thread_id);
    } catch (reason) {
      setError(displayError(reason, '无法启动 Agent'));
    }
  };

  const startNewTrip = async (message: string) => {
    setError(null);
    if (!readiness?.ready) {
      setError('核心服务尚未就绪。请先填写 LLM 与百度地图 AK，再开始真实规划。');
      return;
    }
    // Home is a new-Trip boundary. Never reuse whichever Trip/thread happened
    // to be open before the user returned to the homepage.
    setTrip(null);
    setThread(null);
    setThreads([]);
    setWatches([]);
    setDecisions([]);
    setVersions([]);
    setRunId(null);
    setRunStatusByThread({});
    activeThreadIdRef.current = null;
    try {
      const response = await api.startTurn(message);
      activeThreadIdRef.current = response.thread_id;
      setRunId(response.run_id);
      updateRunStatus(response.thread_id, response.status === 'QUEUED' ? 'RUNNING' : response.status);
      // Persist the conversation address before the slower resource refresh.
      // A user can now leave and return to this exact Thread while the Run is
      // still working, and the durable Run poll will finish the handoff.
      setPage('workspace');
      pushLocation(workspacePath(response.trip_id, response.thread_id));
      await refreshTrip(response.trip_id, response.thread_id);
      await refreshHome();
    } catch (reason) {
      updateRunStatus(activeThreadIdRef.current, 'FAILED');
      setError(displayError(reason, '无法创建新旅程'));
    }
  };

  const submitComponent = async (component: UIComponentData, value: Record<string, unknown>) => {
    setError(null);
    setRetryableRunId(null);
    try {
      const response = await api.submitComponent(component.id, value);
      activeThreadIdRef.current = response.thread_id;
      setRunId(response.run_id);
      updateRunStatus(response.thread_id, 'RUNNING');
      await refreshTrip(response.trip_id, response.thread_id);
    } catch (reason) {
      setError(displayError(reason, '组件提交失败'));
    }
  };

  const cancelRun = () => {
    if (!runId) return;
    void api.cancelRun(runId).then(() => updateRunStatus(activeThreadIdRef.current, 'CANCELLED')).catch((reason: Error) => setError(displayError(reason, '无法停止运行')));
  };

  const retryRun = useCallback(async (failedRunId: string) => {
    setError(null);
    setRetryableRunId(null);
    try {
      const response = await api.retryRun(failedRunId);
      activeThreadIdRef.current = response.thread_id;
      setRunId(response.run_id);
      setRunStreamKey((value) => value + 1);
      updateRunStatus(response.thread_id, 'RUNNING');
      await refreshTrip(response.trip_id, response.thread_id);
    } catch (reason) {
      setRetryableRunId(failedRunId);
      setError(displayError(reason, '无法重试 Agent'));
    }
  }, [refreshTrip, updateRunStatus]);

  const selectThread = async (threadId: string) => {
    if (!trip || threadId === activeThreadIdRef.current) return;
    const previousThreadId = activeThreadIdRef.current;
    const previousRunId = activeRunForThread(thread)?.id ?? null;
    setError(null);
    setRunId(null);
    activeThreadIdRef.current = threadId;
    try {
      const nextThread = await api.threadById(trip.id, threadId);
      if (activeThreadIdRef.current === threadId) {
        setThread(nextThread);
        const latestRun = nextThread.runs[nextThread.runs.length - 1];
        const activeRun = activeRunForThread(nextThread);
        if (latestRun) updateRunStatus(threadId, latestRun.status);
        setRunId(activeRun?.id ?? null);
        rememberWorkspaceLocation(trip.id, threadId);
        pushLocation(workspacePath(trip.id, threadId));
      }
    } catch (reason) {
      if (activeThreadIdRef.current === threadId) {
        activeThreadIdRef.current = previousThreadId;
        setRunId(previousRunId);
      }
      setError(displayError(reason, '无法切换对话'));
    }
  };

  const newThread = async () => {
    if (!trip) return;
    setError(null);
    try {
      const created = await api.createThread(trip.id);
      activeThreadIdRef.current = created.id;
      setRunId(null);
      await refreshTrip(trip.id, created.id);
      pushLocation(workspacePath(trip.id, created.id));
    } catch (reason) {
      setError(displayError(reason, '无法新建对话'));
    }
  };

  const renameThread = async (threadId: string, title: string) => {
    if (!trip) return;
    try {
      await api.updateThread(trip.id, threadId, { title });
      await refreshTrip(trip.id, activeThreadIdRef.current);
    } catch (reason) {
      setError(displayError(reason, '无法重命名对话'));
    }
  };

  const archiveThread = async (target: ThreadSummary) => {
    if (!trip) return;
    try {
      await api.updateThread(trip.id, target.id, { status: target.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED' });
      if (target.id === activeThreadIdRef.current && target.status === 'ACTIVE') {
        activeThreadIdRef.current = null;
        setRunId(null);
      }
      await refreshTrip(trip.id, activeThreadIdRef.current);
    } catch (reason) {
      setError(displayError(reason, '无法更新对话状态'));
    }
  };

  const deleteThread = async (target: ThreadSummary) => {
    if (!trip) return;
    setError(null);
    try {
      const result = await api.deleteThread(trip.id, target.id);
      if (target.id === activeThreadIdRef.current) {
        setRunId(null);
        activeThreadIdRef.current = result.replacement_thread.id;
      }
      await refreshTrip(trip.id, activeThreadIdRef.current ?? result.replacement_thread.id);
    } catch (reason) {
      setError(displayError(reason, '无法删除对话'));
    }
  };

  const itemAction = async (item: ItineraryItem, action: string, minutes?: number) => {
    if (!trip) return;
    setError(null);
    try {
      await api.itemAction(trip.id, item.id, action, minutes);
      await refreshTrip(trip.id);
    } catch (reason) {
      const message = displayError(reason, '操作失败');
      setError(message);
      if (action === 'DELAY' && reason instanceof ApiError && reason.status === 409) {
        await sendMessage(`把 ${item.title} 延迟 ${minutes ?? 30} 分钟，只调整尚未完成的余程并保护锁定项目。`);
      }
    }
  };

  const resolveDecision = async (decisionId: string, optionId: string) => {
    if (!trip) return;
    await api.resolveDecision(trip.id, decisionId, optionId);
    if (optionId === 'review') await sendMessage('请检查最新天气变化影响了哪些行程，并准备局部 Plan B。');
    else await refreshTrip(trip.id);
  };

  const restoreVersion = async (version: number) => {
    if (!trip) return;
    try {
      await api.restoreVersion(trip.id, version);
      await refreshTrip(trip.id);
    } catch (reason) {
      setError(displayError(reason, '恢复版本失败'));
    }
  };

  const updateProfile = async (displayName: string) => {
    const nextProfile = await api.updateProfile(displayName);
    setProfile(nextProfile);
  };

  const deletePreference = async (preferenceId: string) => {
    await api.deletePreference(preferenceId);
    setProfile(await api.profile());
  };

  const navigate = (target: AppPage) => {
    if (target === 'home') {
      setPage('home');
      pushLocation('/');
      window.scrollTo({ top: 0, behavior: 'auto' });
      void refreshHome();
      return;
    }
    if (target === 'workspace' && !trip) return;
    if (target === 'today' && !trip?.current_plan) return;
    setPage(target);
    if (target === 'workspace' && trip) {
      pushLocation(workspacePath(trip.id, activeThreadIdRef.current));
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (target === 'today' && trip) {
      pushLocation(`/trips/${trip.id}/today`);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (target === 'decisions') pushLocation('/decisions');
    if (target === 'settings') pushLocation('/settings');
  };

  const openDecisionTrip = async (tripId: string) => {
    setCanvasPanel('watch');
    await openTrip(tripId);
  };

  const activeDayData = trip?.current_plan?.days.find((day) => day.day_index === activeDay) ?? trip?.current_plan?.days[0];
  const clarifying = trip && !trip.current_plan;

  if (loading && !readiness) {
    return <div className="app-loading" role="status"><span /><strong>正在读取 Trip State…</strong></div>;
  }

  const pendingDecisionCount = trips.reduce((sum, item) => sum + item.pending_decisions, 0);

  return (
    <AppFrame page={page} trip={trip} profile={profile} readiness={readiness} pendingCount={pendingDecisionCount} collapsed={sidebarCollapsed} onCollapsedChange={updateSidebarCollapsed} onNavigate={navigate}>
      {page === 'home' && (
        <HomePage readiness={readiness} trips={trips} profile={profile} onStart={startNewTrip} onOpenTrip={openTrip} onUpdateCategories={updateTripCategories} onDeleteTrips={deleteTrips} onResume={resumeLastWorkspace} onDecisions={() => navigate('decisions')} onSettings={() => navigate('settings')} error={error} />
      )}
      {page === 'decisions' && <DecisionCenter trips={trips} onOpenTrip={openDecisionTrip} />}
      {page === 'settings' && <SettingsPage readiness={readiness} profile={profile} showWorkProcess={showWorkProcess} onShowWorkProcessChange={updateShowWorkProcess} onUpdateProfile={updateProfile} onDeletePreference={deletePreference} />}
      {page === 'workspace' && trip && (
        <main id="main-content" className={clarifying ? 'clarifying-layout' : 'workspace-layout'}>
          {clarifying ? (
            <>
              <AgentThread thread={thread} threads={threads} runStatus={runStatus} runConnection={runConnection} error={error} retryableRunId={retryableRunId} onRetry={retryRun} onSend={sendMessage} onSubmitComponent={submitComponent} onCancel={cancelRun} onSelectThread={selectThread} onNewThread={newThread} onRenameThread={renameThread} onArchiveThread={archiveThread} onDeleteThread={deleteThread} showWorkProcess={showWorkProcess} onShowWorkProcessChange={updateShowWorkProcess} />
              <TripBrief trip={trip} thread={thread} />
            </>
          ) : (
            <>
              <aside className="workspace-agent-column">
                <AgentThread thread={thread} threads={threads} runStatus={runStatus} runConnection={runConnection} error={error} retryableRunId={retryableRunId} onRetry={retryRun} onSend={sendMessage} onSubmitComponent={submitComponent} onCancel={cancelRun} onSelectThread={selectThread} onNewThread={newThread} onRenameThread={renameThread} onArchiveThread={archiveThread} onDeleteThread={deleteThread} showWorkProcess={showWorkProcess} onShowWorkProcessChange={updateShowWorkProcess} />
              </aside>
              <section className="workspace-timeline-column">
                <TripBar trip={trip} activeDay={activeDay} onDay={setActiveDay} onToday={() => navigate('today')} />
                {activeDayData && <Timeline day={activeDayData} activeId={activeItemId} onSelect={setActiveItemId} onAction={itemAction} />}
              </section>
              <aside className="workspace-canvas-column">
                <div className="canvas-tabs" role="tablist" aria-label="Trip Canvas">
                  <button type="button" className={canvasPanel === 'map' ? 'is-active' : ''} onClick={() => setCanvasPanel('map')}><MapTrifold size={18} />地图</button>
                  <button type="button" className={canvasPanel === 'stay' ? 'is-active' : ''} onClick={() => setCanvasPanel('stay')}><Bed size={18} />住宿</button>
                  <button type="button" className={canvasPanel === 'watch' ? 'is-active' : ''} onClick={() => setCanvasPanel('watch')}><BellRinging size={18} />照看</button>
                  <button type="button" className={canvasPanel === 'versions' ? 'is-active' : ''} onClick={() => setCanvasPanel('versions')}><ClockCounterClockwise size={18} />版本</button>
                </div>
                {canvasPanel === 'map' && (
                  <TripMapCanvas
                    items={activeDayData?.items ?? []}
                    routeLegs={activeDayData?.route_legs ?? []}
                    activeId={activeItemId}
                    onSelect={setActiveItemId}
                  />
                )}
                {canvasPanel === 'stay' && <HotelPanel suggestions={trip.current_plan?.hotel_suggestions ?? []} />}
                {canvasPanel === 'watch' && <WatchPanel watches={watches} decisions={decisions} onResolve={resolveDecision} />}
                {canvasPanel === 'versions' && <VersionPanel versions={versions} current={trip.current_version} onRestore={restoreVersion} />}
              </aside>
            </>
          )}
        </main>
      )}
      {page === 'today' && trip && <TodayMode trip={trip} onBack={() => navigate('workspace')} onAction={itemAction} onAskAgent={sendMessage} />}
    </AppFrame>
  );
}

function HotelPanel({ suggestions }: { suggestions: NonNullable<TripDetail['current_plan']>['hotel_suggestions'] }) {
  return (
    <section className="hotel-panel">
      <header><p className="section-kicker">WHERE TO STAY</p><h2>住在哪个区域更顺手</h2><p>先根据行程分布推荐住宿区域；只有你明确比较时，才核验代表性通勤路线。</p></header>
      <div className="hotel-list">
        {suggestions.map((item) => (
          <article key={item.place.provider_place_id}>
            <Bed size={21} />
            <div><strong>{item.place.name}</strong><span>{item.place.district ?? item.place.city} · 住宿区域候选</span><p>{item.reason}</p></div>
          </article>
        ))}
        {suggestions.length === 0 && <div className="quiet-state"><Bed size={23} />暂时没有取得可用的住宿区域候选。</div>}
      </div>
    </section>
  );
}

function TripBar({ trip, activeDay, onDay, onToday }: { trip: TripDetail; activeDay: number; onDay: (day: number) => void; onToday: () => void }) {
  return (
    <header className="trip-bar">
      <div><span className="pulse-badge">{trip.pulse}</span><h1>{trip.title}</h1><p>{dateRange(trip)} · V{trip.current_version}</p></div>
      <div className="day-tabs" role="tablist" aria-label="选择旅行日期">
        {trip.current_plan?.days.map((day) => <button type="button" key={day.day_index} className={day.day_index === activeDay ? 'is-active' : ''} onClick={() => onDay(day.day_index)}>D{day.day_index}<span>{day.date.slice(5)}</span></button>)}
      </div>
      <button type="button" className="button-secondary" onClick={onToday}>进入今日模式</button>
    </header>
  );
}

function VersionPanel({ versions, current, onRestore }: { versions: Array<{ version: number; reason: string; created_at: string }>; current: number; onRestore: (version: number) => Promise<void> }) {
  return (
    <section className="version-panel">
      <header><p className="section-kicker">PLAN HISTORY</p><h2>可撤销的计划版本</h2></header>
      {versions.map((version) => (
        <article key={version.version} className={version.version === current ? 'is-current' : ''}>
          <span>V{version.version}</span><div><strong>{version.reason}</strong><small>{new Date(version.created_at).toLocaleString('zh-CN')}</small></div>
          {version.version === current ? <em>当前</em> : <button type="button" onClick={() => onRestore(version.version)}>恢复</button>}
        </article>
      ))}
      {versions.length === 0 && <div className="quiet-state"><ClockCounterClockwise size={23} />确认首版计划后，这里会保留每次变更。</div>}
    </section>
  );
}

export default App;
