from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.domain.enums import (
    ComponentState,
    PatchState,
    RiskLevel,
    RunStatus,
    TripLifecycle,
)


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[dict[str, Any]]: JSON}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    display_name: Mapped[str] = mapped_column(String(120), default="本地旅行者")


class Trip(Base, TimestampMixin):
    __tablename__ = "trips"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="未命名旅程")
    category: Mapped[str] = mapped_column(String(64), default="未分类", server_default="未分类")
    lifecycle: Mapped[str] = mapped_column(String(32), default=TripLifecycle.DRAFT.value, index=True)
    pulse: Mapped[str] = mapped_column(String(32), default="准备中")
    trip_spec: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    current_version: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    versions: Mapped[list[PlanVersion]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    threads: Mapped[list[ConversationThread]] = relationship(back_populates="trip", cascade="all, delete-orphan")


class PlanVersion(Base):
    __tablename__ = "plan_versions"
    __table_args__ = (UniqueConstraint("trip_id", "version", name="uq_trip_version"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(Text)
    source_patch_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    trip: Mapped[Trip] = relationship(back_populates="versions")


class PlanPatch(Base, TimestampMixin):
    __tablename__ = "plan_patches"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True)
    base_version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(24), default=PatchState.PREVIEW.value, index=True)
    scope: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(Text)
    operations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    impact: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    validation_result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    proposed_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)


class ConversationThread(Base, TimestampMixin):
    __tablename__ = "conversation_threads"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="新对话")
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    trip: Mapped[Trip] = relationship(back_populates="threads")
    messages: Mapped[list[Message]] = relationship(back_populates="thread", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[str] = mapped_column(String(24))
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    thread: Mapped[ConversationThread] = relationship(back_populates="messages")


class AgentRun(Base, TimestampMixin):
    __tablename__ = "agent_runs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24), default=RunStatus.QUEUED.value, index=True)
    intent: Mapped[str | None] = mapped_column(String(48), nullable=True)
    input_text: Mapped[str] = mapped_column(Text)
    current_step: Mapped[str | None] = mapped_column(String(80), nullable=True)
    checkpoint_thread_id: Mapped[str] = mapped_column(String(120), unique=True)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    lease_token: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    active_job_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UIComponent(Base, TimestampMixin):
    __tablename__ = "ui_components"
    __table_args__ = (UniqueConstraint("run_id", "type", name="uq_ui_component_run_type"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(24), default=ComponentState.CREATED.value, index=True)
    props: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    base_version: Mapped[int] = mapped_column(Integer)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_run_sequence"),
        Index("ix_events_trip_created", "trip_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    sequence: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(64), index=True)
    trip_id: Mapped[UUID | None] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=True)
    thread_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("conversation_threads.id", ondelete="CASCADE"), nullable=True
    )
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class TravelConversationState(Base, TimestampMixin):
    """Durable product state for the conversation controller."""

    __tablename__ = "travel_conversation_states"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    thread_id: Mapped[UUID] = mapped_column(
        ForeignKey("conversation_threads.id", ondelete="CASCADE"), unique=True, index=True
    )
    stage: Mapped[str] = mapped_column(String(32), default="DISCOVERY", index=True)
    planning_consent: Mapped[str] = mapped_column(String(32), default="NONE")
    active_goal: Mapped[str | None] = mapped_column(String(240), nullable=True)
    consecutive_question_turns: Mapped[int] = mapped_column(Integer, default=0)
    asked_topics: Mapped[list[str]] = mapped_column(JSON, default=list)
    skipped_topics: Mapped[list[str]] = mapped_column(JSON, default=list)
    assumption_permission: Mapped[bool] = mapped_column(Boolean, default=False)
    interaction_mode: Mapped[str] = mapped_column(String(24), default="collaborative")
    last_value_delivery_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pending_decision_topic: Mapped[str | None] = mapped_column(String(120), nullable=True)
    classification_done: Mapped[bool] = mapped_column(Boolean, default=False)
    source_user_message_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    readiness: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    assumptions: Mapped[list[str]] = mapped_column(JSON, default=list)


class TripArtifact(Base, TimestampMixin):
    __tablename__ = "trip_artifacts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(48), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="PRESENTED", index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    assumptions: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_ids: Mapped[list[str]] = mapped_column(JSON, default=list)


class DestinationDossier(Base, TimestampMixin):
    __tablename__ = "destination_dossiers"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    destination_key: Mapped[str] = mapped_column(String(200), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    overview: Mapped[str] = mapped_column(Text, default="")
    directions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    key_areas: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    candidate_place_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentActivityEvent(Base):
    """Auditable public activity timeline, separate from transport events."""

    __tablename__ = "agent_activity_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_agent_activity_run_sequence"),
        Index("ix_agent_activity_run_created", "run_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), unique=True, index=True)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    activity_id: Mapped[str] = mapped_column(String(160), index=True)
    phase: Mapped[str] = mapped_column(String(24), default="response")
    kind: Mapped[str] = mapped_column(String(24), default="progress")
    status: Mapped[str] = mapped_column(String(24), default="running")
    title: Mapped[str] = mapped_column(String(500))
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    visibility: Mapped[str] = mapped_column(String(16), default="public")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ToolUsageLedger(Base):
    __tablename__ = "tool_usage_ledger"
    __table_args__ = (
        UniqueConstraint("run_id", "activity_id", name="uq_tool_usage_run_activity"),
        Index("ix_tool_usage_thread_created", "thread_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("conversation_threads.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[str] = mapped_column(String(160))
    provider: Mapped[str] = mapped_column(String(80))
    tool_name: Mapped[str] = mapped_column(String(120))
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    quota_cost: Mapped[int] = mapped_column(Integer, default=1)
    result_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="RUNNING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(24))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SourceRecord(Base):
    __tablename__ = "source_records"
    __table_args__ = (
        Index("ix_source_records_run_retrieved", "run_id", "retrieved_at"),
        UniqueConstraint("run_id", "canonical_url", "title", name="uq_run_source_identity"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    tool_call_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tool_calls.id", ondelete="CASCADE"), nullable=True, index=True
    )
    source_type: Mapped[str] = mapped_column(String(32), index=True)
    provider: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(500))
    canonical_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(240), nullable=True)
    author: Mapped[str | None] = mapped_column(String(240), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    query: Mapped[str | None] = mapped_column(Text, nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    credibility_level: Mapped[str] = mapped_column(String(24), default="unknown")


class FactSnapshot(Base):
    __tablename__ = "fact_snapshots"
    __table_args__ = (Index("ix_fact_subject", "trip_id", "subject_type", "subject_id", "fact_type"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    fact_type: Mapped[str] = mapped_column(String(64))
    subject_type: Mapped[str] = mapped_column(String(64))
    subject_id: Mapped[str] = mapped_column(String(200))
    value: Mapped[dict[str, Any]] = mapped_column(JSON)
    provider: Mapped[str] = mapped_column(String(80))
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confidence_millis: Mapped[int] = mapped_column(Integer, default=1000)
    state: Mapped[str] = mapped_column(String(16), default="live")


class Watch(Base, TimestampMixin):
    __tablename__ = "watches"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(48))
    state: Mapped[str] = mapped_column(String(24), default="WAITING")
    query: Mapped[dict[str, Any]] = mapped_column(JSON)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class DecisionRequest(Base, TimestampMixin):
    __tablename__ = "decision_requests"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trip_id: Mapped[UUID] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    alert_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    patch_id: Mapped[UUID | None] = mapped_column(ForeignKey("plan_patches.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    detail: Mapped[str] = mapped_column(Text)
    risk_level: Mapped[str] = mapped_column(String(16), default=RiskLevel.YELLOW.value, index=True)
    state: Mapped[str] = mapped_column(String(24), default="OPEN", index=True)
    options: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    recommended_option: Mapped[str | None] = mapped_column(String(120), nullable=True)
    resolved_option: Mapped[str | None] = mapped_column(String(120), nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class KnowledgeDocument(Base, TimestampMixin):
    __tablename__ = "knowledge_documents"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trip_id: Mapped[UUID | None] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    content: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(String(48))
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(80), default="user_text")
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(512), nullable=True)


class UserPreference(Base, TimestampMixin):
    __tablename__ = "user_preferences"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_preference_key"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    value: Mapped[dict[str, Any]] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(24), default="CONFIRMED")
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
