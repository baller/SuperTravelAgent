"""Close components that belong to failed runs.

Revision ID: 0004
Revises: 0003
"""

from alembic import op


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Component answers from a failed legacy multi-interrupt Run are retained
    # in events for audit, but must never appear as current interactive state.
    op.execute(
        """
        UPDATE ui_components AS component
        SET state = 'FAILED'
        FROM agent_runs AS run
        WHERE component.run_id = run.id
          AND run.status = 'FAILED'
          AND component.state <> 'FAILED'
        """
    )


def downgrade() -> None:
    pass
