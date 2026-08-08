import { useEffect, useReducer, useRef } from 'react';
import { api } from '../api';
import {
  agentEventReducer,
  initialAgentEventState,
  setAgentConnection,
} from '../agentEventReducer';
import type { AgentEvent } from '../types';

const terminalEvents = new Set(['run.completed', 'run.cancelled']);

export function useAgentRun(runId: string | null, onEvent: (event: AgentEvent) => void, streamKey = 0) {
  const lastSequenceRef = useRef(0);
  const [{ status, lastSequence, connection }, dispatch] = useReducer(
    (state: typeof initialAgentEventState, action: { type: 'event'; event: AgentEvent } | { type: 'connection'; value: typeof initialAgentEventState.connection } | { type: 'reset' }) => {
      if (action.type === 'reset') return initialAgentEventState;
      if (action.type === 'event') return agentEventReducer(state, action.event);
      return setAgentConnection(state, action.value);
    },
    initialAgentEventState,
  );

  useEffect(() => {
    if (!runId) {
      lastSequenceRef.current = 0;
      dispatch({ type: 'reset' });
      return;
    }
    lastSequenceRef.current = 0;
    dispatch({ type: 'reset' });
    dispatch({ type: 'connection', value: 'connected' });
    const source = new EventSource(api.eventUrl(runId));
    const types = [
      'run.started', 'progress.started', 'progress.updated', 'progress.completed',
      'message.delta', 'message.completed', 'tool.started', 'tool.completed', 'tool.failed',
      'source.discovered', 'question.created', 'question.answered',
      'component.created', 'component.updated', 'run.waiting_user', 'trip.spec.updated',
      'trip.plan.preview', 'trip.plan.committed', 'trip.patch.preview', 'trip.patch.applied',
      'trip.patch.rejected', 'watch.checked', 'decision.created', 'run.partial', 'run.failed',
      'run.cancelled', 'run.completed', 'intent.classified', 'conversation.stage.changed',
      'artifact.created', 'artifact.updated', 'plan.draft.confirmed', 'plan.draft.rejected',
      'tool.budget.updated', 'run.recovered',
    ];
    const handler = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AgentEvent;
      const before = lastSequenceRef.current;
      if (event.sequence <= before) return;
      lastSequenceRef.current = event.sequence;
      dispatch({ type: 'event', event });
      onEvent(event);
      if (terminalEvents.has(event.type)) source.close();
      if (event.type === 'run.failed' && event.run_id) {
        // A failed attempt may be immediately requeued from a checkpoint.
        // Check durable state before closing, otherwise run.recovered and the
        // next attempt are invisible until the user leaves and re-enters.
        void api.run(event.run_id).then((state) => {
          if (state.status === 'FAILED' || state.status === 'CANCELLED' || state.status === 'SUCCEEDED') {
            source.close();
          }
        }).catch(() => undefined);
      }
    };
    types.forEach((type) => source.addEventListener(type, handler as EventListener));
    source.onopen = () => dispatch({ type: 'connection', value: 'connected' });
    source.onerror = () => {
      // EventSource reconnects automatically and sends Last-Event-ID. The reducer
      // drops any replayed event that was already applied.
      dispatch({ type: 'connection', value: 'reconnecting' });
    };
    return () => source.close();
  }, [runId, onEvent, streamKey]);

  return { status, lastSequence, connection };
}
