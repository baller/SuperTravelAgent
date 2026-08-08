"""Add isolated conversation management and remove duplicated components.

Revision ID: 0002
Revises: 0001
"""

from alembic import op


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0001 historically imports live SQLAlchemy metadata, so these statements
    # must also be safe for a brand-new database created with the current model.
    op.execute("ALTER TABLE conversation_threads ADD COLUMN IF NOT EXISTS title varchar(120) NOT NULL DEFAULT '新对话'")
    op.execute("ALTER TABLE conversation_threads ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'ACTIVE'")
    op.execute("ALTER TABLE conversation_threads ADD COLUMN IF NOT EXISTS last_message_at timestamptz NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_conversation_threads_status ON conversation_threads (status)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_conversation_threads_last_message_at "
        "ON conversation_threads (last_message_at)"
    )

    # Existing LangGraph resumes recreated components after SUBMITTED became
    # VALIDATED. Keep the APPLIED row (or newest row) and delete the stale twin.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY run_id, type
                       ORDER BY CASE state WHEN 'APPLIED' THEN 0 ELSE 1 END, created_at DESC
                   ) AS row_rank
            FROM ui_components
        )
        DELETE FROM ui_components
        WHERE id IN (SELECT id FROM ranked WHERE row_rank > 1)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_ui_component_run_type'
            ) THEN
                ALTER TABLE ui_components
                ADD CONSTRAINT uq_ui_component_run_type UNIQUE (run_id, type);
            END IF;
        END $$
        """
    )
    op.execute(
        """
        UPDATE conversation_threads AS thread
        SET last_message_at = (
                SELECT max(created_at) FROM messages WHERE thread_id = thread.id
            ),
            title = coalesce(
                nullif(left(regexp_replace((
                    SELECT content
                    FROM messages
                    WHERE thread_id = thread.id AND role = 'user'
                    ORDER BY created_at ASC
                    LIMIT 1
                ), E'[\\n\\r\\t]+', ' ', 'g'), 32), ''),
                thread.title
            )
        WHERE EXISTS (SELECT 1 FROM messages WHERE thread_id = thread.id)
        """
    )
    op.execute("ALTER TABLE conversation_threads ALTER COLUMN title DROP DEFAULT")
    op.execute("ALTER TABLE conversation_threads ALTER COLUMN status DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE ui_components DROP CONSTRAINT IF EXISTS uq_ui_component_run_type")
    op.execute("DROP INDEX IF EXISTS ix_conversation_threads_last_message_at")
    op.execute("DROP INDEX IF EXISTS ix_conversation_threads_status")
    op.execute("ALTER TABLE conversation_threads DROP COLUMN IF EXISTS last_message_at")
    op.execute("ALTER TABLE conversation_threads DROP COLUMN IF EXISTS status")
    op.execute("ALTER TABLE conversation_threads DROP COLUMN IF EXISTS title")
