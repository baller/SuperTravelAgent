"""Track the durable ARQ job associated with an Agent Run.

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "active_job_id" not in columns:
        op.add_column("agent_runs", sa.Column("active_job_id", sa.String(length=200), nullable=True))
        op.create_index("ix_agent_runs_active_job_id", "agent_runs", ["active_job_id"])


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("agent_runs")}
    if "active_job_id" in columns:
        op.drop_index("ix_agent_runs_active_job_id", table_name="agent_runs")
        op.drop_column("agent_runs", "active_job_id")
