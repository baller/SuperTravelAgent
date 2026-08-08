from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.enums import (
    ComponentState,
    ConversationStage,
    FactState,
    FieldState,
    Intent,
    PatchState,
    PlanningConsent,
    PlanReadinessLevel,
    RiskLevel,
    RunStatus,
    TripLifecycle,
    TripPulse,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class FieldValue(ApiModel):
    value: Any = None
    state: FieldState = FieldState.MISSING
    source: str | None = None


class Traveler(ApiModel):
    name: str
    relation: str | None = None
    age_group: str | None = None
    mobility: Literal["limited", "normal", "strong"] | None = None
    dietary_restrictions: list[str] = Field(default_factory=list)
    accessibility_needs: list[str] = Field(default_factory=list)


class TicketCommitment(ApiModel):
    kind: Literal["rail", "flight", "attraction", "hotel", "other"]
    title: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    location_name: str | None = None
    train_code: str | None = None
    from_station: str | None = None
    to_station: str | None = None
    train_date: date | None = None
    locked: bool = True
    source: str = "user"


class TripSpecData(ApiModel):
    destination: FieldValue = Field(default_factory=FieldValue)
    origin: FieldValue = Field(default_factory=FieldValue)
    start_date: FieldValue = Field(default_factory=FieldValue)
    end_date: FieldValue = Field(default_factory=FieldValue)
    duration_days: FieldValue = Field(default_factory=FieldValue)
    planning_scope: FieldValue = Field(default_factory=FieldValue)
    transport_modes: FieldValue = Field(default_factory=FieldValue)
    travelers: FieldValue = Field(default_factory=FieldValue)
    traveler_requirements: FieldValue = Field(default_factory=FieldValue)
    budget: FieldValue = Field(default_factory=FieldValue)
    budget_mode: Literal["hard", "target", "unlimited", "estimate"] = "estimate"
    pace: FieldValue = Field(default_factory=lambda: FieldValue(value="适中", state=FieldState.ASSUMED))
    interests: FieldValue = Field(default_factory=FieldValue)
    must_visit: FieldValue = Field(default_factory=FieldValue)
    avoid: FieldValue = Field(default_factory=FieldValue)
    constraints: list[dict[str, Any]] = Field(default_factory=list)
    tickets: list[TicketCommitment] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)

    def is_minimally_plannable(self) -> bool:
        destination_ok = self.destination.state == FieldState.CONFIRMED and bool(self.destination.value)
        dates_ok = (
            self.start_date.state in {FieldState.CONFIRMED, FieldState.INFERRED}
            and self.end_date.state in {FieldState.CONFIRMED, FieldState.INFERRED}
        ) or self.duration_days.state in {FieldState.CONFIRMED, FieldState.INFERRED}
        travelers_ok = self.travelers.state != FieldState.CONFLICTED
        return destination_ok and dates_ok and travelers_ok

    def is_research_ready(self) -> bool:
        """Return whether the first plan has enough confirmed product context.

        Minimal dates and a destination are enough to start clarification, but
        not enough to spend map/community quotas or present a plan as personal.
        Empty lists are valid confirmations for optional preference fields.
        """

        required_states = (
            self.planning_scope.state,
            self.transport_modes.state,
            self.travelers.state,
            self.traveler_requirements.state,
            self.budget.state,
            self.pace.state,
            self.interests.state,
            self.must_visit.state,
            self.avoid.state,
        )
        return self.is_minimally_plannable() and all(
            state == FieldState.CONFIRMED for state in required_states
        )


class Coordinates(ApiModel):
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-90, le=90)


class Place(ApiModel):
    provider_place_id: str
    name: str
    city: str | None = None
    district: str | None = None
    address: str | None = None
    category: str | None = None
    telephone: str | None = None
    opening_hours: str | None = None
    detail_url: str | None = None
    overall_rating: float | None = None
    comment_count: int | None = None
    image_count: int | None = None
    content_tags: list[str] = Field(default_factory=list)
    community_notes: list[dict[str, Any]] = Field(default_factory=list)
    coordinates: Coordinates
    source: str
    observed_at: datetime


class RouteLeg(ApiModel):
    id: str
    origin_item_id: str
    destination_item_id: str
    mode: Literal["walking", "transit", "driving"]
    duration_minutes: int = Field(ge=0)
    distance_meters: int = Field(ge=0)
    summary: str
    polyline: list[Coordinates] = Field(default_factory=list)
    provider: str = "baidu-map"
    observed_at: datetime
    fact_state: FactState = FactState.LIVE


class ItineraryItem(ApiModel):
    id: str
    day_index: int = Field(ge=1)
    start_at: datetime
    end_at: datetime
    title: str
    category: str
    place: Place | None = None
    reason: str
    cost_cny: Decimal | None = Field(default=None, ge=0)
    cost_source: str | None = None
    reservation_state: Literal["unknown", "not_required", "required", "booked"] = "unknown"
    locked: bool = False
    status: Literal["PLANNED", "COMPLETED", "SKIPPED"] = "PLANNED"
    source: str
    observed_at: datetime
    opening_state: Literal["verified", "unverified", "unavailable"] = "unverified"

    @model_validator(mode="after")
    def validate_times(self) -> ItineraryItem:
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class TripDay(ApiModel):
    day_index: int = Field(ge=1)
    date: date
    title: str
    weather: dict[str, Any] | None = None
    items: list[ItineraryItem] = Field(default_factory=list)
    route_legs: list[RouteLeg] = Field(default_factory=list)


class Conflict(ApiModel):
    code: str
    level: Literal["blocking", "warning", "suggestion"]
    title: str
    detail: str
    day_index: int | None = None
    item_ids: list[str] = Field(default_factory=list)


class HotelSuggestion(ApiModel):
    place: Place
    average_commute_minutes: int = Field(ge=0)
    # The first planning pass only recommends a lodging area. Exact commute
    # samples are reserved for an explicit comparison request.
    route_samples: int = Field(ge=0)
    route_modes: list[Literal["transit", "driving"]] = Field(default_factory=list)
    reason: str


class PlanSnapshot(ApiModel):
    days: list[TripDay]
    hotel_suggestions: list[HotelSuggestion] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    known_cost_cny: Decimal = Decimal("0")
    unknown_cost_items: int = 0
    generated_at: datetime
    source_summary: list[str] = Field(default_factory=list)


class TripCreate(ApiModel):
    title: str | None = Field(default=None, max_length=200)
    initial_message: str | None = None


class TripUpdate(ApiModel):
    title: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=64)
    lifecycle: TripLifecycle | None = None


class ConversationThreadCreate(ApiModel):
    title: str | None = Field(default=None, max_length=120)


class ConversationThreadUpdate(ApiModel):
    title: str | None = Field(default=None, max_length=120)
    status: Literal["ACTIVE", "ARCHIVED"] | None = None


class TripSummary(ApiModel):
    id: UUID
    title: str
    category: str
    lifecycle: TripLifecycle
    pulse: TripPulse
    current_version: int
    trip_spec: TripSpecData
    updated_at: datetime
    pending_decisions: int = 0


class TripDetail(TripSummary):
    current_plan: PlanSnapshot | None = None
    created_at: datetime


class PlanningGap(ApiModel):
    code: str
    label: str
    blocking: bool = False
    reason: str


class PlanReadiness(ApiModel):
    level: PlanReadinessLevel
    draft_blockers: list[PlanningGap] = Field(default_factory=list)
    executable_gaps: list[PlanningGap] = Field(default_factory=list)
    optional_gaps: list[PlanningGap] = Field(default_factory=list)
    assumptions_available: dict[str, Any] = Field(default_factory=dict)
    reason_codes: list[str] = Field(default_factory=list)


class TravelConversationStateData(ApiModel):
    stage: ConversationStage = ConversationStage.DISCOVERY
    planning_consent: PlanningConsent = PlanningConsent.NONE
    active_goal: str | None = None
    consecutive_question_turns: int = 0
    asked_topics: list[str] = Field(default_factory=list)
    skipped_topics: list[str] = Field(default_factory=list)
    assumption_permission: bool = False
    interaction_mode: Literal["agent_led", "collaborative", "user_led"] = "collaborative"
    last_value_delivery_turn: int | None = None
    pending_decision_topic: str | None = None
    classification_done: bool = False
    source_user_message_id: UUID | None = None
    readiness: PlanReadiness | None = None
    assumptions: list[str] = Field(default_factory=list)


class TripArtifactData(ApiModel):
    id: UUID
    type: Literal[
        "destination_brief",
        "travel_directions",
        "plan_draft",
        "transport_options",
        "hotel_area_analysis",
    ]
    trip_id: UUID
    thread_id: UUID
    run_id: UUID | None = None
    version: int
    status: Literal["PRESENTED", "SUBMITTED", "APPLIED", "SUPERSEDED", "REJECTED", "EXPIRED"]
    payload: dict[str, Any]
    assumptions: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    created_at: datetime


class AgentActivityEventData(ApiModel):
    id: UUID
    event_id: UUID
    run_id: UUID
    thread_id: UUID
    sequence: int
    activity_id: str
    phase: Literal["understanding", "research", "planning", "validation", "response"]
    kind: Literal["progress", "decision", "tool_call", "tool_result", "artifact", "validation", "warning"]
    status: Literal["queued", "running", "completed", "failed", "cancelled", "waiting"]
    title: str
    summary: str | None = None
    detail: dict[str, Any] | None = None
    visibility: Literal["public", "internal"] = "public"
    created_at: datetime


class AgentTurnRequest(ApiModel):
    trip_id: UUID | None = None
    thread_id: UUID | None = None
    message: str = Field(min_length=1, max_length=12000)
    idempotency_key: str = Field(min_length=8, max_length=120)
    page_context: dict[str, Any] = Field(default_factory=dict)

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message cannot be blank")
        return value


class AgentTurnResponse(ApiModel):
    trip_id: UUID
    thread_id: UUID
    run_id: UUID
    status: RunStatus


class ComponentSubmitRequest(ApiModel):
    payload: dict[str, Any]
    idempotency_key: str = Field(min_length=8, max_length=120)


class UIComponent(ApiModel):
    id: UUID
    type: str
    state: ComponentState
    props: dict[str, Any]
    value: dict[str, Any] | None = None
    run_id: UUID
    trip_id: UUID
    base_version: int
    created_at: datetime


class PatchOperation(ApiModel):
    op: Literal["ADD", "REMOVE", "MOVE", "REPLACE", "UPDATE", "LOCK", "UNLOCK", "COMPLETE", "SKIP"]
    item_id: str | None = None
    day_index: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class PatchImpact(ApiModel):
    changed_days: list[int] = Field(default_factory=list)
    added: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    moved: list[str] = Field(default_factory=list)
    protected: list[str] = Field(default_factory=list)
    known_cost_delta_cny: Decimal | None = None
    walking_delta_meters: int | None = None


class PlanPatchData(ApiModel):
    id: UUID
    trip_id: UUID
    base_version: int
    state: PatchState
    scope: dict[str, Any]
    reason: str
    operations: list[PatchOperation]
    impact: PatchImpact
    validation_result: dict[str, Any]
    created_at: datetime


class PatchDecisionRequest(ApiModel):
    idempotency_key: str = Field(min_length=8, max_length=120)


class VersionRestoreRequest(ApiModel):
    version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=120)


class ItemActionRequest(ApiModel):
    action: Literal["COMPLETE", "SKIP", "DELAY", "LOCK", "UNLOCK"]
    minutes: int | None = Field(default=None, ge=1, le=720)
    idempotency_key: str = Field(min_length=8, max_length=120)


class FactSnapshotData(ApiModel):
    fact_type: str
    subject_type: str
    subject_id: str
    value: dict[str, Any]
    provider: str
    source_url: str | None = None
    observed_at: datetime
    valid_until: datetime | None = None
    confidence: float = Field(ge=0, le=1)
    state: FactState


class WatchData(ApiModel):
    id: UUID
    type: str
    state: str
    query: dict[str, Any]
    last_checked_at: datetime | None = None
    next_check_at: datetime | None = None
    last_result: dict[str, Any] | None = None
    enabled: bool


class DecisionData(ApiModel):
    id: UUID
    title: str
    detail: str
    risk_level: RiskLevel
    state: str
    options: list[dict[str, Any]]
    recommended_option: str | None = None
    deadline_at: datetime | None = None
    created_at: datetime


class DecisionResolveRequest(ApiModel):
    option_id: str
    idempotency_key: str = Field(min_length=8, max_length=120)


class EventEnvelope(ApiModel):
    event_id: UUID
    sequence: int
    type: str
    occurred_at: datetime
    trip_id: UUID | None = None
    thread_id: UUID | None = None
    run_id: UUID | None = None
    payload: dict[str, Any]


class IntentResult(ApiModel):
    intent: Intent
    confidence: float = Field(ge=0, le=1)
    trip_id: UUID | None = None
    scope: dict[str, Any] = Field(default_factory=dict)
    entities: dict[str, Any] = Field(default_factory=dict)
    risk_level: RiskLevel = RiskLevel.GREEN
    requires_tools: bool = False
    requires_confirmation: bool = False


class ToolResult(ApiModel):
    status: Literal["success", "error"]
    data: Any = None
    provider: str
    source: str
    retrieved_at: datetime
    expires_at: datetime | None = None
    confidence: float = Field(default=1, ge=0, le=1)
    cache_state: Literal["live", "cached", "stale"] = "live"
    error_code: str | None = None
    retryable: bool = False
    tool_call_id: UUID | None = None


class AgentToolCallRequest(ApiModel):
    tool: Literal[
        "web_search",
        "web_fetch",
        "xhs_search",
        "xhs_get_note",
        "place_search",
        "place_detail",
        "geocode",
        "route_search",
        "weather_search",
        "rail_search",
        "trip_read",
        "trip_validate",
    ]
    arguments: dict[str, Any] = Field(default_factory=dict)
    reason: str = Field(min_length=1, max_length=240)


class AgentComponentRequest(ApiModel):
    type: Literal[
        "destination_disambiguation",
        "date_range_picker",
        "origin_transport_selector",
        "traveler_selector",
        "traveler_needs_selector",
        "budget_selector",
        "pace_interest_selector",
        "trip_priorities_selector",
        "place_candidates",
        "rail_options",
        "decision_options",
        "quick_choice",
        "assumption_confirmation",
        "plan_preview",
        "plan_patch_preview",
    ]
    title: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=1, max_length=1200)
    props: dict[str, Any] = Field(default_factory=dict)


class AgentAction(ApiModel):
    type: Literal[
        "ask_user",
        "call_tools",
        "update_working_plan",
        "propose_trip_patch",
        "respond",
        "finish",
    ]
    public_progress: str = Field(min_length=1, max_length=800)
    intent: Intent | None = None
    trip_spec_updates: dict[str, Any] = Field(default_factory=dict)
    component: AgentComponentRequest | None = None
    calls: list[AgentToolCallRequest] = Field(default_factory=list, max_length=3)
    working_plan: dict[str, Any] = Field(default_factory=dict)
    patch: dict[str, Any] = Field(default_factory=dict)
    response_outline: str | None = Field(default=None, max_length=3000)
    citation_ids: list[UUID] = Field(default_factory=list)
    skill: Literal[
        "ASK_DECISION",
        "BUILD_DESTINATION_BRIEF",
        "RESEARCH_DESTINATION",
        "DRAFT_ITINERARY",
        "MODIFY_ITINERARY",
        "ANSWER_TRIP_QUESTION",
        "VALIDATE_PLAN",
        "RESPOND",
    ] | None = None
    question_topic: str | None = Field(default=None, max_length=120)

    @field_validator("trip_spec_updates", "working_plan", "patch", mode="before")
    @classmethod
    def normalize_nullable_objects(cls, value: Any) -> Any:
        # OpenAI-compatible providers often include every schema key and use
        # JSON null for inactive object fields. Treat that exactly like an
        # omitted field instead of spending another model call on formatting.
        return {} if value is None else value

    @field_validator("calls", "citation_ids", mode="before")
    @classmethod
    def normalize_nullable_arrays(cls, value: Any) -> Any:
        return [] if value is None else value

    @model_validator(mode="after")
    def validate_action_payload(self) -> AgentAction:
        if self.type == "ask_user" and self.component is None:
            raise ValueError("ask_user requires component")
        if self.type == "call_tools" and not self.calls:
            raise ValueError("call_tools requires at least one call")
        if self.type == "propose_trip_patch" and not self.patch:
            raise ValueError("propose_trip_patch requires patch")
        if self.type == "respond" and not self.response_outline:
            raise ValueError("respond requires response_outline")
        return self


class SourceRecordData(ApiModel):
    id: UUID
    run_id: UUID
    tool_call_id: UUID | None = None
    source_type: Literal[
        "official_web",
        "web",
        "map_provider",
        "transport_provider",
        "weather_provider",
        "community",
        "user_input",
    ]
    provider: str
    title: str
    canonical_url: str | None = None
    publisher: str | None = None
    author: str | None = None
    published_at: datetime | None = None
    retrieved_at: datetime
    query: str | None = None
    snippet: str | None = None
    credibility_level: Literal["official", "provider", "community", "unknown"] = "unknown"


class ReadinessService(ApiModel):
    name: str
    ready: bool
    required: bool
    detail: str


class ReadinessResponse(ApiModel):
    ready: bool
    services: list[ReadinessService]


class ReferenceTextRequest(ApiModel):
    title: str
    content: str = Field(min_length=20, max_length=100000)
    city: str | None = None
    content_type: str = "travel_note"
