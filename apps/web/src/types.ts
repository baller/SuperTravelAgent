export type TripLifecycle =
  | 'DRAFT'
  | 'CLARIFYING'
  | 'RESEARCHING'
  | 'PLANNING'
  | 'REVIEWING'
  | 'READY'
  | 'IN_TRIP'
  | 'COMPLETED'
  | 'ARCHIVED';

export type FieldState = 'CONFIRMED' | 'INFERRED' | 'ASSUMED' | 'MISSING' | 'CONFLICTED';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'WAITING_USER' | 'PARTIAL' | 'SUCCEEDED' | 'CANCELLED' | 'FAILED';
export type ComponentState = 'CREATED' | 'PRESENTED' | 'SUBMITTED' | 'VALIDATED' | 'APPLIED' | 'SUPERSEDED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

export interface FieldValue<T = unknown> {
  value: T | null;
  state: FieldState;
  source?: string | null;
}

export interface TripSpec {
  destination: FieldValue<string | Destination>;
  origin: FieldValue<string>;
  start_date: FieldValue<string>;
  end_date: FieldValue<string>;
  duration_days: FieldValue<number>;
  planning_scope: FieldValue<'local_only' | 'door_to_door'>;
  transport_modes: FieldValue<string[]>;
  travelers: FieldValue<Traveler[]>;
  traveler_requirements: FieldValue<string[]>;
  budget: FieldValue<number>;
  budget_mode: 'hard' | 'target' | 'unlimited' | 'estimate';
  pace: FieldValue<string>;
  interests: FieldValue<string[]>;
  must_visit: FieldValue<string[]>;
  avoid: FieldValue<string[]>;
  constraints: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  assumptions: string[];
}

export interface Destination {
  provider_place_id: string;
  name: string;
  city?: string;
  district?: string;
  adcode?: string;
  coordinates?: Coordinates;
  provider: string;
  source: string;
  observed_at: string;
}

export interface Traveler {
  name: string;
  relation?: string;
  mobility?: 'limited' | 'normal' | 'strong';
}

export interface Coordinates {
  longitude: number;
  latitude: number;
}

export interface Place {
  provider_place_id: string;
  name: string;
  city?: string;
  district?: string;
  address?: string;
  category?: string;
  telephone?: string;
  opening_hours?: string;
  detail_url?: string;
  overall_rating?: number;
  comment_count?: number;
  image_count?: number;
  content_tags: string[];
  community_notes: Array<{
    title?: string;
    author?: string;
    url?: string;
    cover_url?: string;
    liked_count?: number;
    excerpt?: string;
    source?: string;
  }>;
  coordinates: Coordinates;
  source: string;
  observed_at: string;
}

export interface ItineraryItem {
  id: string;
  day_index: number;
  start_at: string;
  end_at: string;
  title: string;
  category: string;
  place?: Place | null;
  reason: string;
  cost_cny?: string | number | null;
  cost_source?: string | null;
  reservation_state: 'unknown' | 'not_required' | 'required' | 'booked';
  locked: boolean;
  status: 'PLANNED' | 'COMPLETED' | 'SKIPPED';
  source: string;
  observed_at: string;
  opening_state: 'verified' | 'unverified' | 'unavailable';
}

export interface RouteLeg {
  id: string;
  origin_item_id: string;
  destination_item_id: string;
  mode: 'walking' | 'transit' | 'driving';
  duration_minutes: number;
  distance_meters: number;
  summary: string;
  polyline: Coordinates[];
  provider: string;
  observed_at: string;
  fact_state: 'live' | 'cached' | 'stale';
}

export interface TripDay {
  day_index: number;
  date: string;
  title: string;
  weather?: Record<string, string> | null;
  items: ItineraryItem[];
  route_legs: RouteLeg[];
}

export interface Conflict {
  code: string;
  level: 'blocking' | 'warning' | 'suggestion';
  title: string;
  detail: string;
  day_index?: number;
  item_ids: string[];
}

export interface HotelSuggestion {
  place: Place;
  average_commute_minutes: number;
  route_samples: number;
  route_modes: Array<'transit' | 'driving'>;
  reason: string;
}

export interface PlanSnapshot {
  days: TripDay[];
  hotel_suggestions: HotelSuggestion[];
  conflicts: Conflict[];
  known_cost_cny: string | number;
  unknown_cost_items: number;
  generated_at: string;
  source_summary: string[];
}

export interface TripSummary {
  id: string;
  title: string;
  category: string;
  lifecycle: TripLifecycle;
  pulse: string;
  current_version: number;
  trip_spec: TripSpec;
  updated_at: string;
  pending_decisions: number;
}

export interface TripDetail extends TripSummary {
  current_plan?: PlanSnapshot | null;
  created_at: string;
}

export interface ReadinessService {
  name: string;
  ready: boolean;
  required: boolean;
  detail: string;
}

export interface Readiness {
  ready: boolean;
  services: ReadinessService[];
}

export interface UserPreferenceData {
  id: string;
  key: string;
  value: Record<string, unknown>;
  state: string;
  evidence_count: number;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  display_name: string;
  account_mode: 'local';
  preferences: UserPreferenceData[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  run_id?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
}

export interface UIComponentData {
  id: string;
  type: string;
  state: ComponentState;
  props: Record<string, unknown>;
  value?: Record<string, unknown> | null;
  run_id: string;
  base_version: number;
  created_at: string;
}

export interface ThreadSummary {
  id: string;
  trip_id: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  summary?: string | null;
  message_count: number;
  run_count: number;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunProcessStep {
  id: string;
  kind: 'progress' | 'tool' | 'state';
  label: string;
  detail: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  occurred_at: string;
  result?: unknown;
  result_count?: number | null;
  arguments?: Record<string, unknown> | null;
  tool_name?: string | null;
  provider?: string | null;
  cache_state?: 'live' | 'cached' | 'stale' | null;
  sources: SourceRecordData[];
}

export interface AgentActivityEventData {
  id: string;
  event_id: string;
  sequence: number;
  activity_id: string;
  phase: 'understanding' | 'research' | 'planning' | 'validation' | 'response';
  kind: 'progress' | 'decision' | 'tool_call' | 'tool_result' | 'artifact' | 'validation' | 'warning';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting';
  title: string;
  summary?: string | null;
  detail?: Record<string, unknown> | null;
  created_at: string;
}

export interface SourceRecordData {
  id: string;
  source_type: string;
  provider: string;
  title: string;
  canonical_url?: string | null;
  publisher?: string | null;
  author?: string | null;
  published_at?: string | null;
  retrieved_at: string;
  query?: string | null;
  snippet?: string | null;
  credibility_level: string;
}

export interface AgentRunData {
  id: string;
  status: RunStatus;
  intent?: string | null;
  current_step?: string | null;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
  created_at: string;
  completed_at?: string | null;
  steps: RunProcessStep[];
  activities: AgentActivityEventData[];
  sources: SourceRecordData[];
}

export interface PlanReadinessData {
  level: 'not_ready' | 'orientable' | 'draftable' | 'executable';
  draft_blockers: Array<{ code: string; label: string; reason: string }>;
  executable_gaps: Array<{ code: string; label: string; reason: string }>;
  optional_gaps: Array<{ code: string; label: string; reason: string }>;
  assumptions_available: Record<string, unknown>;
  reason_codes: string[];
}

export interface TravelConversationStateData {
  stage: string;
  planning_consent: 'NONE' | 'DIRECTION_CONFIRMED' | 'DRAFT_CONFIRMED';
  active_goal?: string | null;
  consecutive_question_turns: number;
  asked_topics: string[];
  skipped_topics: string[];
  assumption_permission: boolean;
  interaction_mode: 'agent_led' | 'collaborative' | 'user_led';
  last_value_delivery_turn?: number | null;
  pending_decision_topic?: string | null;
  classification_done: boolean;
  source_user_message_id?: string | null;
  readiness?: PlanReadinessData | null;
  assumptions: string[];
}

export interface TripArtifactData {
  id: string;
  type: string;
  trip_id: string;
  thread_id: string;
  run_id?: string | null;
  version: number;
  status: string;
  payload: Record<string, unknown>;
  assumptions: string[];
  source_ids: string[];
  created_at: string;
}

export interface ThreadData extends ThreadSummary {
  messages: Message[];
  components: UIComponentData[];
  runs: AgentRunData[];
  conversation_state?: TravelConversationStateData | null;
  artifacts: TripArtifactData[];
  latest_run?: { id: string; status: RunStatus; current_step?: string | null; created_at: string } | null;
  pending_component_count: number;
}

export interface AgentTurnResponse {
  trip_id: string;
  thread_id: string;
  run_id: string;
  status: RunStatus;
}

export interface AgentRunState {
  id: string;
  trip_id: string;
  thread_id: string;
  status: RunStatus;
  intent?: string | null;
  current_step?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentEvent {
  event_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  trip_id?: string;
  thread_id?: string;
  run_id?: string;
  payload: Record<string, unknown>;
}

export interface Watch {
  id: string;
  type: string;
  state: string;
  query: Record<string, unknown>;
  last_checked_at?: string | null;
  next_check_at?: string | null;
  last_result?: Record<string, unknown> | null;
  enabled: boolean;
}

export interface Decision {
  id: string;
  title: string;
  detail: string;
  risk_level: 'GREEN' | 'YELLOW' | 'RED';
  state: string;
  options: Array<{ id: string; label: string }>;
  recommended_option?: string | null;
  deadline_at?: string | null;
  created_at: string;
}
