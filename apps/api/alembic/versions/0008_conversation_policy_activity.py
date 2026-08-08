"""Add conversation policy state, artifacts and durable activity timeline.

Revision ID: 0008
Revises: 0007
"""

from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def _table_exists(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _table_exists("travel_conversation_states"):
        op.create_table(
            "travel_conversation_states",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("thread_id", sa.Uuid(), nullable=False),
            sa.Column("stage", sa.String(length=32), nullable=False, server_default="DISCOVERY"),
            sa.Column("planning_consent", sa.String(length=32), nullable=False, server_default="NONE"),
            sa.Column("active_goal", sa.String(length=240), nullable=True),
            sa.Column("consecutive_question_turns", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("asked_topics", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("skipped_topics", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("assumption_permission", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("interaction_mode", sa.String(length=24), nullable=False, server_default="collaborative"),
            sa.Column("last_value_delivery_turn", sa.Integer(), nullable=True),
            sa.Column("pending_decision_topic", sa.String(length=120), nullable=True),
            sa.Column("classification_done", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("source_user_message_id", sa.Uuid(), nullable=True),
            sa.Column("readiness", sa.JSON(), nullable=True),
            sa.Column("assumptions", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["thread_id"], ["conversation_threads.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("thread_id"),
        )
        op.create_index("ix_travel_conversation_states_thread_id", "travel_conversation_states", ["thread_id"], unique=True)
        op.create_index("ix_travel_conversation_states_stage", "travel_conversation_states", ["stage"])

    if not _table_exists("trip_artifacts"):
        op.create_table(
            "trip_artifacts",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("trip_id", sa.Uuid(), nullable=False),
            sa.Column("thread_id", sa.Uuid(), nullable=False),
            sa.Column("run_id", sa.Uuid(), nullable=True),
            sa.Column("type", sa.String(length=48), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="PRESENTED"),
            sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("assumptions", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("source_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["thread_id"], ["conversation_threads.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_trip_artifacts_trip_id", "trip_artifacts", ["trip_id"])
        op.create_index("ix_trip_artifacts_thread_id", "trip_artifacts", ["thread_id"])
        op.create_index("ix_trip_artifacts_run_id", "trip_artifacts", ["run_id"])
        op.create_index("ix_trip_artifacts_type", "trip_artifacts", ["type"])
        op.create_index("ix_trip_artifacts_status", "trip_artifacts", ["status"])

    if not _table_exists("destination_dossiers"):
        op.create_table(
            "destination_dossiers",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("trip_id", sa.Uuid(), nullable=False),
            sa.Column("thread_id", sa.Uuid(), nullable=False),
            sa.Column("run_id", sa.Uuid(), nullable=True),
            sa.Column("destination_key", sa.String(length=200), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("overview", sa.Text(), nullable=False, server_default=""),
            sa.Column("directions", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("key_areas", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("candidate_place_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("source_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["thread_id"], ["conversation_threads.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_destination_dossiers_trip_id", "destination_dossiers", ["trip_id"])
        op.create_index("ix_destination_dossiers_thread_id", "destination_dossiers", ["thread_id"])
        op.create_index("ix_destination_dossiers_run_id", "destination_dossiers", ["run_id"])
        op.create_index("ix_destination_dossiers_destination_key", "destination_dossiers", ["destination_key"])

    if not _table_exists("agent_activity_events"):
        op.create_table(
            "agent_activity_events",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("event_id", sa.Uuid(), nullable=False),
            sa.Column("run_id", sa.Uuid(), nullable=False),
            sa.Column("thread_id", sa.Uuid(), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("activity_id", sa.String(length=160), nullable=False),
            sa.Column("phase", sa.String(length=24), nullable=False, server_default="response"),
            sa.Column("kind", sa.String(length=24), nullable=False, server_default="progress"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="running"),
            sa.Column("title", sa.String(length=500), nullable=False),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("detail", sa.JSON(), nullable=True),
            sa.Column("visibility", sa.String(length=16), nullable=False, server_default="public"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["thread_id"], ["conversation_threads.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("event_id"),
            sa.UniqueConstraint("run_id", "sequence", name="uq_agent_activity_run_sequence"),
        )
        op.create_index("ix_agent_activity_events_event_id", "agent_activity_events", ["event_id"], unique=True)
        op.create_index("ix_agent_activity_events_run_id", "agent_activity_events", ["run_id"])
        op.create_index("ix_agent_activity_events_thread_id", "agent_activity_events", ["thread_id"])
        op.create_index("ix_agent_activity_events_activity_id", "agent_activity_events", ["activity_id"])
        op.create_index("ix_agent_activity_run_created", "agent_activity_events", ["run_id", "created_at"])

    if not _table_exists("tool_usage_ledger"):
        op.create_table(
            "tool_usage_ledger",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("run_id", sa.Uuid(), nullable=False),
            sa.Column("thread_id", sa.Uuid(), nullable=False),
            sa.Column("activity_id", sa.String(length=160), nullable=False),
            sa.Column("provider", sa.String(length=80), nullable=False),
            sa.Column("tool_name", sa.String(length=120), nullable=False),
            sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("quota_cost", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("result_count", sa.Integer(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="RUNNING"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["thread_id"], ["conversation_threads.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("run_id", "activity_id", name="uq_tool_usage_run_activity"),
        )
        op.create_index("ix_tool_usage_ledger_run_id", "tool_usage_ledger", ["run_id"])
        op.create_index("ix_tool_usage_ledger_thread_id", "tool_usage_ledger", ["thread_id"])
        op.create_index("ix_tool_usage_thread_created", "tool_usage_ledger", ["thread_id", "created_at"])


def downgrade() -> None:
    for table in ("tool_usage_ledger", "agent_activity_events", "destination_dossiers", "trip_artifacts", "travel_conversation_states"):
        if _table_exists(table):
            op.drop_table(table)
