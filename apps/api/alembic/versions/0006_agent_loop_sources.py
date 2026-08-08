"""Add first-class sources for the dynamic agent loop.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Revision 0001 historically calls Base.metadata.create_all(), so a brand-new
    # database already contains models added by later revisions. Existing
    # installations upgrading from 0005 do not. Keep this migration compatible
    # with both paths until 0001 is replaced by a frozen schema migration.
    if "source_records" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "source_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("tool_call_id", sa.Uuid(), nullable=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("canonical_url", sa.Text(), nullable=True),
        sa.Column("publisher", sa.String(length=240), nullable=True),
        sa.Column("author", sa.String(length=240), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("query", sa.Text(), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("credibility_level", sa.String(length=24), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_call_id"], ["tool_calls.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "canonical_url", "title", name="uq_run_source_identity"),
    )
    op.create_index("ix_source_records_run_id", "source_records", ["run_id"])
    op.create_index("ix_source_records_tool_call_id", "source_records", ["tool_call_id"])
    op.create_index("ix_source_records_source_type", "source_records", ["source_type"])
    op.create_index(
        "ix_source_records_run_retrieved",
        "source_records",
        ["run_id", "retrieved_at"],
    )


def downgrade() -> None:
    if "source_records" not in sa.inspect(op.get_bind()).get_table_names():
        return
    op.drop_index("ix_source_records_run_retrieved", table_name="source_records")
    op.drop_index("ix_source_records_source_type", table_name="source_records")
    op.drop_index("ix_source_records_tool_call_id", table_name="source_records")
    op.drop_index("ix_source_records_run_id", table_name="source_records")
    op.drop_table("source_records")
