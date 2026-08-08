import type {
  AgentTurnResponse,
  AgentRunState,
  Decision,
  Readiness,
  ThreadData,
  ThreadSummary,
  TripDetail,
  TripSummary,
  UserProfile,
  Watch,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const unavailable = [502, 503, 504].includes(response.status);
    throw new ApiError(
      response.status,
      unavailable ? 'API 服务尚未启动，请先运行完整 Docker Compose 服务。' : body.detail ?? '请求失败',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function idempotencyKey(prefix: string): string {
  const cryptoApi = globalThis.crypto as Crypto & { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `${prefix}:${cryptoApi.randomUUID()}`;
  }

  // Some embedded browsers expose Web Crypto without the newer randomUUID API.
  // Keep idempotency keys unique there as well so creating a new Trip does not fail.
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const uuid = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}:${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
  }

  return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const api = {
  readiness: () => request<Readiness>('/system/readiness'),
  profile: () => request<UserProfile>('/profile'),
  updateProfile: (displayName: string) => request<UserProfile>('/profile', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  }),
  deletePreference: (preferenceId: string) => request<void>(`/profile/preferences/${preferenceId}`, {
    method: 'DELETE',
  }),
  trips: () => request<TripSummary[]>('/trips'),
  trip: (tripId: string) => request<TripDetail>(`/trips/${tripId}`),
  updateTrip: (tripId: string, payload: { category?: string; title?: string }) =>
    request<TripDetail>(`/trips/${tripId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteTrip: (tripId: string) => request<void>(`/trips/${tripId}`, { method: 'DELETE' }),
  thread: (tripId: string) => request<ThreadData>(`/trips/${tripId}/thread`),
  threads: (tripId: string) => request<ThreadSummary[]>(`/trips/${tripId}/threads`),
  threadById: (tripId: string, threadId: string) => request<ThreadData>(`/trips/${tripId}/threads/${threadId}`),
  createThread: (tripId: string, title?: string) =>
    request<ThreadSummary>(`/trips/${tripId}/threads`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  updateThread: (tripId: string, threadId: string, payload: { title?: string; status?: 'ACTIVE' | 'ARCHIVED' }) =>
    request<ThreadSummary>(`/trips/${tripId}/threads/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteThread: (tripId: string, threadId: string) =>
    request<{ deleted_thread_id: string; replacement_thread: ThreadSummary }>(`/trips/${tripId}/threads/${threadId}`, {
      method: 'DELETE',
    }),
  watches: (tripId: string) => request<Watch[]>(`/trips/${tripId}/watches`),
  decisions: (tripId: string) => request<Decision[]>(`/trips/${tripId}/decisions`),
  versions: (tripId: string) => request<Array<{ version: number; reason: string; created_at: string }>>(`/trips/${tripId}/versions`),
  startTurn: (message: string, tripId?: string, threadId?: string) =>
    request<AgentTurnResponse>('/agent/turns', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: tripId,
        thread_id: threadId,
        message,
        idempotency_key: idempotencyKey('turn'),
        page_context: { path: window.location.pathname },
      }),
    }),
  submitComponent: (componentId: string, payload: Record<string, unknown>) =>
    request<AgentTurnResponse>(`/agent/components/${componentId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ payload, idempotency_key: idempotencyKey('component') }),
    }),
  cancelRun: (runId: string) => request(`/agent/runs/${runId}/cancel`, { method: 'POST' }),
  run: (runId: string) => request<AgentRunState>(`/agent/runs/${runId}`),
  retryRun: (runId: string) => request<AgentTurnResponse>(`/agent/runs/${runId}/retry`, { method: 'POST' }),
  itemAction: (tripId: string, itemId: string, action: string, minutes?: number) =>
    request(`/trips/${tripId}/items/${itemId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, minutes, idempotency_key: idempotencyKey('item') }),
    }),
  restoreVersion: (tripId: string, version: number) =>
    request(`/trips/${tripId}/versions/restore`, {
      method: 'POST',
      body: JSON.stringify({ version, idempotency_key: idempotencyKey('restore') }),
    }),
  resolveDecision: (tripId: string, decisionId: string, optionId: string) =>
    request(`/trips/${tripId}/decisions/${decisionId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId, idempotency_key: idempotencyKey('decision') }),
    }),
  eventUrl: (runId: string) => `${API_BASE}/agent/runs/${runId}/events`,
};
