"""Repair interrupted component state and redact historical database errors.

Revision ID: 0003
Revises: 0002
"""

from alembic import op


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Checkpoints created by the former multi-interrupt clarification node are
    # not safe to resume with the corrected one-component-per-node graph.
    op.execute(
        """
        UPDATE agent_runs
        SET status = 'CANCELLED',
            current_step = 'cancelled_by_clarification_upgrade',
            cancelled_at = now(),
            completed_at = now(),
            error = '{"code":"CHECKPOINT_UPGRADED","message":"对话流程已升级，请重新发送当前需求。","retryable": true}'::json
        WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_USER', 'PARTIAL')
        """
    )
    op.execute(
        """
        UPDATE ui_components AS component
        SET state = 'CANCELLED'
        FROM agent_runs AS run
        WHERE component.run_id = run.id
          AND run.current_step = 'cancelled_by_clarification_upgrade'
          AND component.state IN ('CREATED', 'PRESENTED', 'SUBMITTED', 'VALIDATED')
        """
    )

    # Earlier clarification nodes contained multiple interrupts. A resumed
    # answer could therefore be assigned to the next component. Reset only
    # impossible "confirmed but empty" values; valid user data is untouched.
    op.execute(
        """
        UPDATE trips
        SET trip_spec = jsonb_set(
                trip_spec::jsonb,
                '{start_date}',
                '{"value": null, "state": "MISSING", "source": null}'::jsonb
            )::json,
            lifecycle = CASE WHEN current_version = 0 THEN 'CLARIFYING' ELSE lifecycle END,
            pulse = CASE WHEN current_version = 0 THEN '需要补充' ELSE pulse END
        WHERE trip_spec::jsonb #>> '{start_date,state}' = 'CONFIRMED'
          AND trip_spec::jsonb #> '{start_date,value}' = 'null'::jsonb
        """
    )
    op.execute(
        """
        UPDATE trips
        SET trip_spec = jsonb_set(
                trip_spec::jsonb,
                '{end_date}',
                '{"value": null, "state": "MISSING", "source": null}'::jsonb
            )::json,
            lifecycle = CASE WHEN current_version = 0 THEN 'CLARIFYING' ELSE lifecycle END,
            pulse = CASE WHEN current_version = 0 THEN '需要补充' ELSE pulse END
        WHERE trip_spec::jsonb #>> '{end_date,state}' = 'CONFIRMED'
          AND trip_spec::jsonb #> '{end_date,value}' = 'null'::jsonb
        """
    )
    op.execute(
        """
        UPDATE trips
        SET trip_spec = jsonb_set(
                trip_spec::jsonb,
                '{travelers}',
                '{"value": null, "state": "MISSING", "source": null}'::jsonb
            )::json,
            lifecycle = CASE WHEN current_version = 0 THEN 'CLARIFYING' ELSE lifecycle END,
            pulse = CASE WHEN current_version = 0 THEN '需要补充' ELSE pulse END
        WHERE trip_spec::jsonb #>> '{travelers,state}' = 'CONFIRMED'
          AND trip_spec::jsonb #> '{travelers,value}' = '[]'::jsonb
        """
    )

    # Technical SQL and driver details belong in server logs, never in the
    # user-facing conversation, Run payload, or replayable SSE history.
    safe_message = "对话状态保存时发生冲突，现有 Trip State 和历史消息均已保留。请重新发送当前需求。"
    op.execute(
        f"""
        UPDATE messages
        SET content = '{safe_message}',
            meta = '{{"kind":"run_error","error_code":"COMPONENT_STATE_CONFLICT"}}'::json
        WHERE role = 'assistant'
          AND content ~* '(sqlalchemy|asyncpg|IntegrityError|UniqueViolationError)'
        """
    )
    op.execute(
        f"""
        UPDATE agent_runs
        SET error = '{{"code":"COMPONENT_STATE_CONFLICT","message":"{safe_message}","retryable": true}}'::json
        WHERE error::text ~* '(sqlalchemy|asyncpg|IntegrityError|UniqueViolationError)'
        """
    )
    op.execute(
        f"""
        UPDATE events
        SET payload = '{{"message":"{safe_message}","error_code":"COMPONENT_STATE_CONFLICT","retryable": true}}'::json
        WHERE type = 'run.failed'
          AND payload::text ~* '(sqlalchemy|asyncpg|IntegrityError|UniqueViolationError)'
        """
    )
    op.execute(
        """
        UPDATE ui_components AS component
        SET state = 'FAILED'
        FROM agent_runs AS run
        WHERE component.run_id = run.id
          AND run.status = 'FAILED'
          AND component.state IN ('SUBMITTED', 'VALIDATED')
        """
    )


def downgrade() -> None:
    # This revision only repairs invalid or sensitive historical data.
    pass
