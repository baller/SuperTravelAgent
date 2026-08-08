import type { AgentEvent, RunStatus } from './types';

export interface AgentEventState {
  lastSequence: number;
  status: RunStatus;
  connection: 'connected' | 'reconnecting';
}

export const initialAgentEventState: AgentEventState = {
  lastSequence: 0,
  status: 'QUEUED',
  connection: 'connected',
};

function statusForEvent(event: AgentEvent, current: RunStatus): RunStatus {
  if (event.type === 'run.waiting_user') return 'WAITING_USER';
  if (event.type === 'run.partial') return 'PARTIAL';
  if (event.type === 'run.failed') return 'FAILED';
  if (event.type === 'run.cancelled') return 'CANCELLED';
  if (event.type === 'run.completed') return 'SUCCEEDED';
  if (event.type === 'run.started') {
    return event.payload.status === 'QUEUED' ? 'QUEUED' : 'RUNNING';
  }
  return current === 'WAITING_USER' ? current : 'RUNNING';
}

/** Merge persisted SSE events monotonically; duplicate replayed events are ignored. */
export function agentEventReducer(state: AgentEventState, event: AgentEvent): AgentEventState {
  if (event.sequence <= state.lastSequence) return state;
  return {
    ...state,
    lastSequence: event.sequence,
    status: statusForEvent(event, state.status),
  };
}

export function setAgentConnection(
  state: AgentEventState,
  connection: AgentEventState['connection'],
): AgentEventState {
  return state.connection === connection ? state : { ...state, connection };
}
