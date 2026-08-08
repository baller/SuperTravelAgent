"""Durable ARQ worker for interactive Agent Runs.

The API only records a Run and enqueues this job. The worker owns the graph
execution, so an API process restart cannot silently discard an in-flight Run.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from arq.connections import RedisSettings
from arq.cron import cron
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sqlalchemy import or_, select

from app.agent.loop import build_graph
from app.api.agent import execute_graph
from app.core.config import get_settings
from app.db.models import AgentRun, Message, UIComponent
from app.db.session import SessionFactory
from app.domain.enums import ComponentState, RunStatus
from app.services.events import event_broker

RECOVERY_QUEUE_NAME = "arq:agent-recovery"


async def run_agent(ctx, run_id: str, state: dict | None, resume: dict | None = None) -> None:
    del ctx
    settings = get_settings()
    async with AsyncPostgresSaver.from_conn_string(settings.checkpoint_database_url) as checkpointer:
        graph = build_graph(checkpointer)
        await execute_graph(None, UUID(run_id), state, resume=resume, graph=graph)


async def recover_stale_runs(ctx) -> int:
    """Requeue abandoned interactive runs after an API/worker restart."""

    settings = get_settings()
    now = datetime.now(UTC)
    cutoff = now - timedelta(seconds=settings.run_stale_after_seconds)
    jobs: list[tuple[UUID, str, dict[str, str], str, dict | None]] = []
    async with SessionFactory() as session:
        stale_runs = (
            await session.scalars(
                select(AgentRun)
                .where(
                    AgentRun.status.in_([RunStatus.QUEUED.value, RunStatus.RUNNING.value]),
                    or_(
                        AgentRun.heartbeat_at < cutoff,
                        AgentRun.heartbeat_at.is_(None) & (AgentRun.created_at < cutoff),
                    ),
                )
                .with_for_update(skip_locked=True)
                .limit(20)
            )
        ).all()
        for run in stale_runs:
            if run.retry_count < 2:
                run.retry_count += 1
                run.status = RunStatus.QUEUED.value
                run.current_step = "stale_recovery_queued"
                run.heartbeat_at = now
                job_id = f"agent:{run.id}:stale:{run.retry_count}"
                run.active_job_id = job_id
                await event_broker.publish(
                    session,
                    "run.recovered",
                    {"status": RunStatus.QUEUED.value, "retry_count": run.retry_count, "reason": "stale_run"},
                    trip_id=run.trip_id,
                    thread_id=run.thread_id,
                    run_id=run.id,
                    commit=False,
                )
                submitted_component = await session.scalar(
                    select(UIComponent)
                    .where(
                        UIComponent.run_id == run.id,
                        UIComponent.state.in_(
                            [ComponentState.SUBMITTED.value, ComponentState.VALIDATED.value]
                        ),
                        UIComponent.value.is_not(None),
                    )
                    .order_by(UIComponent.updated_at.desc())
                )
                jobs.append(
                    (
                        run.id,
                        job_id,
                        {
                            "trip_id": str(run.trip_id),
                            "thread_id": str(run.thread_id),
                            "run_id": str(run.id),
                            "message": run.input_text,
                        },
                        run.input_text,
                        dict(submitted_component.value) if submitted_component and submitted_component.value else None,
                    )
                )
                continue

            run.status = RunStatus.FAILED.value
            run.current_step = "stale_failed"
            run.error = {
                "code": "STALE_RUN_RECOVERY_EXHAUSTED",
                "message": "这次处理因后台任务中断，已保留此前可信状态。请重试当前操作。",
                "retryable": True,
                "diagnostic_id": str(run.id),
            }
            run.active_job_id = None
            run.completed_at = now
            existing = await session.scalar(
                select(Message.id).where(
                    Message.run_id == run.id,
                    Message.role == "assistant",
                    Message.meta["kind"].as_string() == "run_error",
                )
            )
            if not existing:
                session.add(
                    Message(
                        thread_id=run.thread_id,
                        run_id=run.id,
                        role="assistant",
                        content=run.error["message"],
                        meta={"kind": "run_error", "error_code": run.error["code"]},
                        created_at=now,
                    )
                )
            await event_broker.publish(
                session,
                "run.failed",
                {"message": run.error["message"], "error_code": run.error["code"], "retryable": True},
                trip_id=run.trip_id,
                thread_id=run.thread_id,
                run_id=run.id,
                commit=False,
            )
        await session.commit()

    redis = ctx["redis"]
    recovered = 0
    for run_id, job_id, state, _message, resume in jobs:
        try:
            await redis.enqueue_job(
                "run_agent",
                str(run_id),
                state,
                resume,
                _job_id=job_id,
                _queue_name=RECOVERY_QUEUE_NAME,
            )
            recovered += 1
        except Exception:
            async with SessionFactory() as session:
                run = await session.get(AgentRun, run_id)
                if run and run.status == RunStatus.QUEUED.value:
                    run.status = RunStatus.FAILED.value
                    run.current_step = "stale_queue_failed"
                    run.active_job_id = None
                    run.completed_at = datetime.now(UTC)
                    run.error = {
                        "code": "AGENT_QUEUE_UNAVAILABLE",
                        "message": "后台 Agent worker 暂时不可用，请稍后重试。",
                        "retryable": True,
                        "diagnostic_id": str(run.id),
                    }
                    await event_broker.publish(
                        session,
                        "run.failed",
                        {"message": run.error["message"], "error_code": run.error["code"], "retryable": True},
                        trip_id=run.trip_id,
                        thread_id=run.thread_id,
                        run_id=run.id,
                        commit=False,
                    )
                    await session.commit()
    return recovered


class AgentWorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions = [run_agent, recover_stale_runs]
    cron_jobs = [cron(recover_stale_runs, minute=set(range(60)))]
    max_jobs = get_settings().agent_worker_max_jobs
    max_tries = 2
    job_timeout = get_settings().max_agent_run_seconds + 30


class AgentRecoveryWorkerSettings:
    """Keep abandoned-run recovery off the interactive queue."""

    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    queue_name = RECOVERY_QUEUE_NAME
    functions = [run_agent]
    max_jobs = 1
    max_tries = 2
    job_timeout = get_settings().max_agent_run_seconds + 30
