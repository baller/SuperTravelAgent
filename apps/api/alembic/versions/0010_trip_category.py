"""Add user-managed categories to trips.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("trips")}
    if "category" not in columns:
        op.add_column(
            "trips",
            sa.Column("category", sa.String(length=64), nullable=False, server_default="未分类"),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("trips")}
    if "category" in columns:
        op.drop_column("trips", "category")
