"""Add durable Agent Run heartbeat and lease fields.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "heartbeat_at" not in columns:
        op.add_column("agent_runs", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index("ix_agent_runs_heartbeat_at", "agent_runs", ["heartbeat_at"])
    if "lease_token" not in columns:
        op.add_column("agent_runs", sa.Column("lease_token", sa.String(length=120), nullable=True))
        op.create_index("ix_agent_runs_lease_token", "agent_runs", ["lease_token"])
    if "retry_count" not in columns:
        op.add_column("agent_runs", sa.Column("retry_count", sa.Integer(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "retry_count" in columns:
        op.drop_column("agent_runs", "retry_count")
    if "lease_token" in columns:
        op.drop_index("ix_agent_runs_lease_token", table_name="agent_runs")
        op.drop_column("agent_runs", "lease_token")
    if "heartbeat_at" in columns:
        op.drop_index("ix_agent_runs_heartbeat_at", table_name="agent_runs")
        op.drop_column("agent_runs", "heartbeat_at")
