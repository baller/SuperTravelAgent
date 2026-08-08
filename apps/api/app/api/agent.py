from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

from arq import Retry
from arq.jobs import Job
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from langgraph.types import Command
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.config import get_settings
from app.db.models import AgentRun, ConversationThread, Event, Message, Trip, UIComponent
from app.db.session import SessionFactory, get_session
from app.domain.enums import ComponentState, RunStatus
from app.domain.schemas import AgentTurnRequest, AgentTurnResponse, ComponentSubmitRequest, EventEnvelope
from app.services.events import event_broker, replay_events
from app.services.trips import create_trip, get_trip_model

router = APIRouter(prefix="/agent", tags=["agent"])

PUBLIC_EVENT_TYPES = {
    "run.started",
    "progress.started",
    "progress.updated",
    "progress.completed",
    "intent.classified",
    "conversation.stage.changed",
    "tool.started",
    "tool.completed",
    "tool.failed",
    "tool.budget.updated",
    "source.discovered",
    "question.created",
    "question.answered",
    "component.created",
    "component.updated",
    "run.waiting_user",
    "trip.spec.updated",
    "trip.draft.updated",
    "artifact.created",
    "artifact.updated",
    "plan.draft.confirmed",
    "plan.draft.rejected",
    "trip.plan.preview",
    "trip.plan.committed",
    "trip.patch.preview",
    "trip.patch.applied",
    "trip.patch.rejected",
    "message.delta",
    "message.completed",
    "run.partial",
    "run.recovered",
    "watch.checked",
    "decision.created",
    "decision.resolved",
    "validation.completed",
    "run.failed",
    "run.cancelled",
    "run.completed",
}
logger = logging.getLogger(__name__)


def _public_run_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, IntegrityError):
        return (
            "COMPONENT_STATE_CONFLICT",
            "对话状态保存时发生冲突，现有 Trip State 和历史消息均已保留。请重新发送当前需求。",
        )
    if isinstance(exc, TimeoutError):
        return "RUN_TIMEOUT", "这次处理超时了，已保留此前可信状态。请稍后重试。"
    message = str(exc)
    if message.startswith(("百度地图", "该交互", "Trip 已产生新版本")):
        return "ACTION_NOT_COMPLETED", message
    return "INTERNAL_ERROR", "这次处理没有完成，已保留此前可信状态。请重试当前操作。"


def _validate_component_payload(component: UIComponent, value: dict[str, Any]) -> None:
    """Reject cross-component or malformed answers before resuming the graph."""

    def invalid(message: str) -> None:
        raise HTTPException(status_code=422, detail=message)

    if component.type == "date_range_picker":
        try:
            start = date.fromisoformat(str(value["start_date"]))
            end = date.fromisoformat(str(value["end_date"]))
        except (KeyError, TypeError, ValueError):
            invalid("请选择有效的开始和结束日期")
            return
        if end < start:
            invalid("结束日期不能早于开始日期")
    elif component.type == "quick_choice":
        selected = value.get("option") or value
        if not isinstance(selected, dict) or not selected.get("id"):
            invalid("请选择一个选项")
            return
        allowed = {
            str(option.get("id"))
            for option in component.props.get("options", [])
            if isinstance(option, dict)
        }
        if str(selected.get("id")) not in allowed:
            invalid("选项已变化，请刷新后重试")
    elif component.type == "destination_disambiguation":
        selected = value.get("option") or value
        if not isinstance(selected, dict) or not selected.get("provider_place_id"):
            invalid("请选择一个已解析的真实目的地")
            return
        allowed_ids = {
            option.get("provider_place_id")
            for option in component.props.get("options", [])
            if isinstance(option, dict)
        }
        if selected.get("provider_place_id") not in allowed_ids:
            invalid("目的地不属于当前候选列表，请刷新后重试")
    elif component.type == "traveler_selector":
        travelers = value.get("travelers")
        if not isinstance(travelers, list) or not travelers:
            invalid("请选择同行人类型")
    elif component.type == "origin_transport_selector":
        scope = value.get("planning_scope")
        if scope not in {"local_only", "door_to_door"}:
            invalid("请选择有效的规划范围")
            return
        modes = value.get("transport_modes")
        if not isinstance(modes, list):
            invalid("交通方式格式无效")
            return
        if scope == "door_to_door" and (not str(value.get("origin") or "").strip() or not modes):
            invalid("从出发地规划时，请填写出发地并选择至少一种跨城交通方式")
    elif component.type == "traveler_needs_selector":
        if not isinstance(value.get("requirements"), list):
            invalid("同行人需要的格式无效")
    elif component.type == "trip_priorities_selector":
        if not isinstance(value.get("must_visit"), list) or not isinstance(value.get("avoid"), list):
            invalid("必去和避开内容格式无效")
    elif component.type == "budget_selector":
        mode = value.get("budget_mode")
        if mode not in {"hard", "target", "unlimited", "estimate"}:
            invalid("请选择有效的预算方式")
            return
        if mode in {"hard", "target"}:
            amount = value.get("budget")
            if not isinstance(amount, int | float) or amount <= 0:
                invalid("请填写大于 0 的预算金额")
    elif component.type == "pace_interest_selector":
        if value.get("pace") not in {"轻松", "适中", "紧凑"}:
            invalid("请选择有效的旅行节奏")
        if not isinstance(value.get("interests"), list):
            invalid("兴趣选项格式无效")
    elif component.type == "assumption_confirmation":
        if value.get("action") not in {"confirm", "revise"}:
            invalid("请选择继续使用当前假设或补充信息")
    elif component.type in {"plan_preview", "plan_patch_preview"}:
        if value.get("action") not in {"apply", "reject"}:
            invalid("请选择应用或放弃本次方案")
    elif component.type == "place_candidates":
        selected = value.get("selected_ids")
        if not isinstance(selected, list) or not selected:
            invalid("请至少选择一个真实地点")
            return
        allowed = {
            str(option.get("provider_place_id") or option.get("id"))
            for option in component.props.get("options", [])
            if isinstance(option, dict)
        }
        selected_ids = {str(item) for item in selected}
        required_ids = {str(item) for item in component.props.get("required_ids", [])}
        if not selected_ids.issubset(allowed):
            invalid("地点候选已变化，请刷新后重试")
        if not required_ids.issubset(selected_ids):
            invalid("必去地点不能在候选确认中取消")
    elif component.type in {"rail_options", "decision_options"}:
        selected = value.get("option") or value
        if not isinstance(selected, dict):
            invalid("请选择一个有效选项")
            return
        allowed = {
            str(option.get("id"))
            for option in component.props.get("options", [])
            if isinstance(option, dict)
        }
        if str(selected.get("id")) not in allowed:
            invalid("选项已变化，请刷新后重试")


async def _claim_run(run_id: UUID) -> tuple[dict[str, str], UUID, UUID, str] | None:
    """Atomically claim a Run so a stale job cannot race its recovery job."""

    now = datetime.now(UTC)
    stale_before = now.timestamp() - get_settings().run_stale_after_seconds
    async with SessionFactory() as session:
        run = await session.scalar(select(AgentRun).where(AgentRun.id == run_id).with_for_update())
        if not run or run.status in {
            RunStatus.WAITING_USER.value,
            RunStatus.SUCCEEDED.value,
            RunStatus.FAILED.value,
            RunStatus.CANCELLED.value,
        }:
            return None
        if (
            run.status == RunStatus.RUNNING.value
            and run.heartbeat_at is not None
            and run.heartbeat_at.timestamp() > stale_before
        ):
            return None
        lease_token = str(uuid4())
        run.status = RunStatus.RUNNING.value
        run.current_step = "running"
        run.lease_token = lease_token
        run.heartbeat_at = now
        await session.commit()
        return (
            {"configurable": {"thread_id": run.checkpoint_thread_id}},
            run.trip_id,
            run.thread_id,
            lease_token,
        )


async def _heartbeat_run(run_id: UUID, lease_token: str) -> None:
    async with SessionFactory() as session:
        run = await session.scalar(
            select(AgentRun).where(
                AgentRun.id == run_id,
                AgentRun.lease_token == lease_token,
                AgentRun.status == RunStatus.RUNNING.value,
            )
        )
        if run:
            run.heartbeat_at = datetime.now(UTC)
            await session.commit()


async def _heartbeat_loop(run_id: UUID, lease_token: str) -> None:
    try:
        while True:
            await asyncio.sleep(get_settings().run_heartbeat_interval_seconds)
            await _heartbeat_run(run_id, lease_token)
    except asyncio.CancelledError:
        return


async def _set_active_job_id(run_id: UUID, job_id: str | None) -> None:
    async with SessionFactory() as session:
        run = await session.get(AgentRun, run_id)
        if run and run.status not in {RunStatus.SUCCEEDED.value, RunStatus.FAILED.value, RunStatus.CANCELLED.value}:
            run.active_job_id = job_id
            await session.commit()


async def execute_graph(
    request: Request | None,
    run_id: UUID,
    state: dict[str, Any] | None,
    resume: dict | None = None,
    *,
    graph: Any | None = None,
) -> None:
    claimed = await _claim_run(run_id)
    if not claimed:
        return
    config, trip_id, thread_id, lease_token = claimed
    heartbeat_task = asyncio.create_task(_heartbeat_loop(run_id, lease_token))
    try:
        graph_input: Any = Command(resume=resume) if resume is not None else state
        if graph is None:
            if request is None:
                raise RuntimeError("Agent graph 未初始化")
            graph = request.app.state.agent_graph
        async with asyncio.timeout(get_settings().max_agent_run_seconds):
            await graph.ainvoke(graph_input, config=config)
    except asyncio.CancelledError:
        async with SessionFactory() as session:
            run = await session.get(AgentRun, run_id)
            if run and run.status not in {RunStatus.SUCCEEDED.value, RunStatus.CANCELLED.value}:
                run.status = RunStatus.CANCELLED.value
                run.cancelled_at = datetime.now(UTC)
                await event_broker.publish(
                    session,
                    "run.cancelled",
                    {"status": RunStatus.CANCELLED.value},
                    trip_id=trip_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    commit=False,
                )
                await session.commit()
        raise
    except Exception as exc:
        logger.exception("Agent run %s failed", run_id)
        error_code, public_message = _public_run_error(exc)
        async with SessionFactory() as session:
            run = await session.get(AgentRun, run_id)
            if run and run.status == RunStatus.CANCELLED.value:
                return
            if run:
                run.retry_count += 1
                if run.retry_count < 2:
                    run.status = RunStatus.QUEUED.value
                    run.current_step = "recovery_queued"
                    run.heartbeat_at = datetime.now(UTC)
                    await event_broker.publish(
                        session,
                        "run.recovered",
                        {"status": RunStatus.QUEUED.value, "retry_count": run.retry_count},
                        trip_id=trip_id,
                        thread_id=thread_id,
                        run_id=run_id,
                        commit=False,
                    )
                    await session.commit()
                    # A plain exception is recorded by ARQ as a terminal job
                    # failure; it does not consume the worker's retry path.
                    # Explicitly ask ARQ to run this same durable job again,
                    # otherwise the database remains recovery_queued forever.
                    raise Retry(defer=1) from exc
                run.status = RunStatus.FAILED.value
                run.current_step = "failed"
                run.error = {
                    "code": error_code,
                    "message": public_message,
                    "retryable": True,
                    "diagnostic_id": str(run_id),
                }
                run.completed_at = datetime.now(UTC)
                run.active_job_id = None
                now = datetime.now(UTC)
                existing_error_message = await session.scalar(
                    select(Message.id).where(
                        Message.run_id == run_id,
                        Message.role == "assistant",
                        Message.meta["kind"].as_string() == "run_error",
                    )
                )
                if not existing_error_message:
                    session.add(
                        Message(
                            thread_id=thread_id,
                            run_id=run_id,
                            role="assistant",
                            content=public_message,
                            meta={"kind": "run_error", "error_code": error_code},
                            created_at=now,
                        )
                    )
                failed_components = (
                    await session.scalars(
                        select(UIComponent).where(
                            UIComponent.run_id == run_id,
                            UIComponent.state.in_(
                                [ComponentState.SUBMITTED.value, ComponentState.VALIDATED.value]
                            ),
                        )
                    )
                ).all()
                for component in failed_components:
                    component.state = ComponentState.FAILED.value
                thread = await session.get(ConversationThread, thread_id)
                if thread:
                    thread.last_message_at = now
                await event_broker.publish(
                    session,
                    "run.failed",
                    {"message": public_message, "error_code": error_code, "retryable": True},
                    trip_id=trip_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    commit=False,
                )
                await session.commit()
    finally:
        heartbeat_task.cancel()
        await asyncio.gather(heartbeat_task, return_exceptions=True)


async def _enqueue_agent_run(
    request: Request,
    run_id: UUID,
    state: dict[str, Any] | None,
    resume: dict[str, Any] | None = None,
    *,
    job_id: str,
) -> None:
    queue = getattr(request.app.state, "agent_queue", None)
    if queue is None:
        raise RuntimeError("Agent worker 队列未初始化，请确认 Redis 和 agent-worker 已启动")
    await _set_active_job_id(run_id, job_id)
    await queue.enqueue_job("run_agent", str(run_id), state, resume, _job_id=job_id)


async def _mark_enqueue_failed(run_id: UUID, reason: Exception) -> None:
    async with SessionFactory() as session:
        run = await session.get(AgentRun, run_id)
        if not run or run.status in {RunStatus.SUCCEEDED.value, RunStatus.CANCELLED.value}:
            return
        run.status = RunStatus.FAILED.value
        run.current_step = "queue_failed"
        run.error = {
            "code": "AGENT_QUEUE_UNAVAILABLE",
            "message": "后台 Agent worker 暂时不可用，请确认 Redis 与 agent-worker 服务后重试。",
            "retryable": True,
            "diagnostic_id": str(run_id),
            "detail": str(reason)[:400],
        }
        run.active_job_id = None
        run.completed_at = datetime.now(UTC)
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


@router.post("/turns", response_model=AgentTurnResponse, status_code=status.HTTP_202_ACCEPTED)
async def post_turn(
    payload: AgentTurnRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AgentTurnResponse:
    existing = await session.scalar(select(AgentRun).where(AgentRun.idempotency_key == payload.idempotency_key))
    if existing:
        return AgentTurnResponse(
            trip_id=existing.trip_id,
            thread_id=existing.thread_id,
            run_id=existing.id,
            status=RunStatus(existing.status),
        )
    trip: Trip | None = None
    thread: ConversationThread | None = None
    if payload.trip_id:
        trip = await get_trip_model(session, payload.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip 不存在")
        if payload.thread_id:
            thread = await session.scalar(
                select(ConversationThread).where(
                    ConversationThread.id == payload.thread_id, ConversationThread.trip_id == trip.id
                )
            )
            if not thread:
                raise HTTPException(status_code=409, detail="对话不属于当前 Trip，请重新选择对话")
            if thread.status == "ARCHIVED":
                raise HTTPException(status_code=409, detail="该对话已归档，请先恢复或新建对话")
        else:
            # A missing thread id is never allowed to leak into an arbitrary
            # historical conversation. Old clients receive a clean thread.
            thread = ConversationThread(trip_id=trip.id, title="新对话", status="ACTIVE")
            session.add(thread)
            await session.flush()
    if not trip:
        trip, thread = await create_trip(session)
    if not thread:
        thread = ConversationThread(trip_id=trip.id, title="新对话", status="ACTIVE")
        session.add(thread)
        await session.flush()

    # Serialize writes for one Thread. The active-run query below by itself
    # cannot prevent two API workers from accepting concurrent turns.
    lock_key = int.from_bytes(thread.id.bytes[:8], byteorder="big", signed=True)
    await session.execute(select(func.pg_advisory_xact_lock(lock_key)))

    active_run = await session.scalar(
        select(AgentRun)
        .where(
            AgentRun.thread_id == thread.id,
            AgentRun.status.in_([RunStatus.QUEUED.value, RunStatus.RUNNING.value]),
        )
        .order_by(AgentRun.created_at.desc())
    )
    if active_run:
        raise HTTPException(status_code=409, detail="当前对话仍有一个 Agent Run 正在处理，请等待其结束或先停止它")

    # A natural-language answer supersedes any still-open component for the
    # same thread. The previous LangGraph checkpoint remains auditable, but it
    # can no longer overwrite the newer Trip State.
    open_components = (
        await session.scalars(
            select(UIComponent).where(
                UIComponent.thread_id == thread.id,
                UIComponent.state.in_([ComponentState.CREATED.value, ComponentState.PRESENTED.value]),
            )
        )
    ).all()
    superseded_run_ids: set[UUID] = set()
    for component in open_components:
        component.state = ComponentState.SUPERSEDED.value
        superseded_run_ids.add(component.run_id)
        await event_broker.publish(
            session,
            "component.updated",
            {"component_id": str(component.id), "state": ComponentState.SUPERSEDED.value},
            trip_id=trip.id,
            thread_id=thread.id,
            run_id=component.run_id,
            commit=False,
        )
    for previous_run_id in superseded_run_ids:
        previous_run = await session.get(AgentRun, previous_run_id)
        if previous_run and previous_run.status == RunStatus.WAITING_USER.value:
            previous_run.status = RunStatus.CANCELLED.value
            previous_run.current_step = "superseded_by_user_message"
            previous_run.cancelled_at = datetime.now(UTC)
            await event_broker.publish(
                session,
                "run.cancelled",
                {"status": RunStatus.CANCELLED.value, "reason": "superseded_by_user_message"},
                trip_id=trip.id,
                thread_id=thread.id,
                run_id=previous_run.id,
                commit=False,
            )
    run = AgentRun(
        trip_id=trip.id,
        thread_id=thread.id,
        status=RunStatus.QUEUED.value,
        input_text=payload.message,
        current_step="queued",
        checkpoint_thread_id=f"run:{uuid4()}",
        idempotency_key=payload.idempotency_key,
    )
    session.add(run)
    await session.flush()
    now = datetime.now(UTC)
    session.add(
        Message(
            thread_id=thread.id,
            run_id=run.id,
            role="user",
            content=payload.message,
            meta=payload.page_context,
            created_at=now,
        )
    )
    thread.last_message_at = now
    if thread.title == "新对话":
        thread.title = " ".join(payload.message.split())[:32] or "新对话"
    await event_broker.publish(
        session,
        "run.started",
        {"status": RunStatus.QUEUED.value, "message": payload.message},
        trip_id=trip.id,
        thread_id=thread.id,
        run_id=run.id,
        commit=False,
    )
    await session.commit()
    state = {
        "trip_id": str(trip.id),
        "thread_id": str(thread.id),
        "run_id": str(run.id),
        "message": payload.message,
    }
    response_status = RunStatus.QUEUED
    try:
        await _enqueue_agent_run(request, run.id, state, job_id=f"agent:{run.id}")
    except Exception as exc:
        logger.exception("Unable to enqueue Agent run %s", run.id)
        await _mark_enqueue_failed(run.id, exc)
        response_status = RunStatus.FAILED
    return AgentTurnResponse(
        trip_id=trip.id,
        thread_id=thread.id,
        run_id=run.id,
        status=response_status,
    )


@router.post("/components/{component_id}/submit", response_model=AgentTurnResponse, status_code=202)
async def submit_component(
    component_id: UUID,
    payload: ComponentSubmitRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AgentTurnResponse:
    component = await session.scalar(select(UIComponent).where(UIComponent.id == component_id).with_for_update())
    if not component:
        raise HTTPException(status_code=404, detail="组件不存在")
    run = await session.scalar(
        select(AgentRun).where(AgentRun.id == component.run_id).with_for_update()
    )
    trip = await session.get(Trip, component.trip_id)
    if not run or not trip:
        raise HTTPException(status_code=404, detail="组件所属运行不存在")
    if component.idempotency_key == payload.idempotency_key and component.state == ComponentState.APPLIED.value:
        return AgentTurnResponse(
            trip_id=run.trip_id,
            thread_id=run.thread_id,
            run_id=run.id,
            status=RunStatus(run.status),
        )
    if run.status in {RunStatus.SUCCEEDED.value, RunStatus.FAILED.value, RunStatus.CANCELLED.value}:
        raise HTTPException(status_code=409, detail="该组件所属运行已经结束，请重新发送当前需求")
    if component.state in {
        ComponentState.SUBMITTED.value,
        ComponentState.VALIDATED.value,
    }:
        if (
            component.idempotency_key != payload.idempotency_key
            and component.value is not None
            and component.value != payload.payload
        ):
            raise HTTPException(status_code=409, detail="该组件已经提交了不同的答案，请刷新后重试")
        run.status = RunStatus.RUNNING.value
        run.current_step = "resume_queued"
        # WAITING_USER leaves the previous execution heartbeat in place. Clear
        # the old lease before enqueueing the resume, otherwise _claim_run()
        # correctly assumes another worker still owns this Run and returns
        # without invoking LangGraph.
        run.lease_token = None
        run.heartbeat_at = None
        run.completed_at = None
        await session.commit()
        response_status = RunStatus.RUNNING
        try:
            await _enqueue_agent_run(
                request,
                run.id,
                None,
                component.value or payload.payload,
                # A previous enqueue may have been acknowledged by ARQ but
                # skipped by a stale lease. Use a fresh execution id for a
                # retry so ARQ does not return the old completed job record.
                job_id=f"agent:{run.id}:resume:{component.id}:{uuid4()}",
            )
        except Exception as exc:
            logger.exception("Unable to enqueue Agent resume %s", run.id)
            await _mark_enqueue_failed(run.id, exc)
            response_status = RunStatus.FAILED
        return AgentTurnResponse(
            trip_id=run.trip_id,
            thread_id=run.thread_id,
            run_id=run.id,
            status=response_status,
        )
    if component.state not in {ComponentState.PRESENTED.value, ComponentState.CREATED.value}:
        raise HTTPException(status_code=409, detail=f"组件当前状态为 {component.state}，不能再次提交")
    if component.type in {"plan_preview", "plan_patch_preview"} and component.base_version != trip.current_version:
        component.state = ComponentState.EXPIRED.value
        await session.commit()
        raise HTTPException(status_code=409, detail="Trip 已更新，该预览已经过期")
    _validate_component_payload(component, payload.payload)
    component.state = ComponentState.SUBMITTED.value
    component.value = payload.payload
    component.idempotency_key = payload.idempotency_key
    await event_broker.publish(
        session,
        "component.updated",
        {"component_id": str(component.id), "state": ComponentState.SUBMITTED.value},
        trip_id=component.trip_id,
        thread_id=component.thread_id,
        run_id=component.run_id,
        commit=False,
    )
    component.state = ComponentState.VALIDATED.value
    await event_broker.publish(
        session,
        "component.updated",
        {"component_id": str(component.id), "state": ComponentState.VALIDATED.value},
        trip_id=component.trip_id,
        thread_id=component.thread_id,
        run_id=component.run_id,
        commit=False,
    )
    run.status = RunStatus.RUNNING.value
    run.current_step = "resume_queued"
    # A component resume is a new execution attempt for the same checkpoint,
    # not a continuation of the suspended worker lease.
    run.lease_token = None
    run.heartbeat_at = None
    run.completed_at = None
    await session.commit()
    response_status = RunStatus.RUNNING
    try:
        await _enqueue_agent_run(
            request,
            run.id,
            None,
            payload.payload,
            job_id=f"agent:{run.id}:resume:{payload.idempotency_key}",
        )
    except Exception as exc:
        logger.exception("Unable to enqueue Agent resume %s", run.id)
        await _mark_enqueue_failed(run.id, exc)
        response_status = RunStatus.FAILED
    return AgentTurnResponse(
        trip_id=run.trip_id,
        thread_id=run.thread_id,
        run_id=run.id,
        status=response_status,
    )


@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    run = await session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status in {RunStatus.SUCCEEDED.value, RunStatus.FAILED.value, RunStatus.CANCELLED.value}:
        return {"run_id": str(run.id), "status": run.status}
    queue = getattr(request.app.state, "agent_queue", None)
    if queue is not None:
        try:
            if run.active_job_id:
                for queue_name in ("arq:queue", "arq:agent-recovery"):
                    await Job(run.active_job_id, queue, _queue_name=queue_name).abort(timeout=0)
        except Exception:
            logger.warning("Unable to abort queued Agent run %s", run_id, exc_info=True)
    run.status = RunStatus.CANCELLED.value
    run.cancelled_at = datetime.now(UTC)
    await event_broker.publish(
        session,
        "run.cancelled",
        {"status": RunStatus.CANCELLED.value},
        trip_id=run.trip_id,
        thread_id=run.thread_id,
        run_id=run.id,
        commit=False,
    )
    await session.commit()
    return {"run_id": str(run.id), "status": run.status}


@router.post("/runs/{run_id}/retry", response_model=AgentTurnResponse, status_code=202)
async def retry_run(
    run_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AgentTurnResponse:
    run = await session.scalar(select(AgentRun).where(AgentRun.id == run_id).with_for_update())
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status not in {RunStatus.FAILED.value, RunStatus.PARTIAL.value}:
        raise HTTPException(status_code=409, detail="当前 Run 不处于可恢复状态")
    run.status = RunStatus.QUEUED.value
    run.current_step = "recovery_queued"
    run.error = None
    run.completed_at = None
    run.retry_count = 0
    run.active_job_id = None
    await event_broker.publish(
        session,
        "run.recovered",
        {"status": RunStatus.QUEUED.value, "from_checkpoint": True},
        trip_id=run.trip_id,
        thread_id=run.thread_id,
        run_id=run.id,
        commit=False,
    )
    await session.commit()
    state = {
        "trip_id": str(run.trip_id),
        "thread_id": str(run.thread_id),
        "run_id": str(run.id),
        "message": run.input_text,
    }
    try:
        await _enqueue_agent_run(request, run.id, state, job_id=f"agent:{run.id}:retry:{uuid4()}")
    except Exception as exc:
        logger.exception("Unable to enqueue recovered Agent run %s", run.id)
        await _mark_enqueue_failed(run.id, exc)
        return AgentTurnResponse(
            trip_id=run.trip_id,
            thread_id=run.thread_id,
            run_id=run.id,
            status=RunStatus.FAILED,
        )
    return AgentTurnResponse(
        trip_id=run.trip_id,
        thread_id=run.thread_id,
        run_id=run.id,
        status=RunStatus.QUEUED,
    )


@router.get("/runs/{run_id}")
async def get_run(run_id: UUID, session: AsyncSession = Depends(get_session)) -> dict:
    run = await session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")
    return {
        "id": str(run.id),
        "trip_id": str(run.trip_id),
        "thread_id": str(run.thread_id),
        "status": run.status,
        "intent": run.intent,
        "current_step": run.current_step,
        "error": run.error,
        "active_job_id": run.active_job_id,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
    }


@router.get("/runs/{run_id}/events")
async def stream_events(
    run_id: UUID,
    request: Request,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    session: AsyncSession = Depends(get_session),
) -> EventSourceResponse:
    run = await session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")
    after_sequence = 0
    if last_event_id:
        try:
            previous = await session.get(Event, UUID(last_event_id))
            if previous and previous.run_id == run_id:
                after_sequence = previous.sequence
        except ValueError:
            pass
    queue = event_broker.subscribe(run_id)

    async def iterator():
        cursor = after_sequence

        async def persisted_events() -> list[EventEnvelope]:
            async with SessionFactory() as poll_session:
                return await replay_events(poll_session, run_id, cursor)

        async def current_status() -> str | None:
            async with SessionFactory() as status_session:
                current_run = await status_session.get(AgentRun, run_id)
                return current_run.status if current_run else None

        async def emit(envelope: EventEnvelope):
            nonlocal cursor
            # The in-process queue and the database polling path can observe
            # the same event. Sequence is the cross-process deduplication key.
            if envelope.sequence <= cursor:
                return None
            cursor = envelope.sequence
            if envelope.type not in PUBLIC_EVENT_TYPES:
                return None
            return {
                "event": envelope.type,
                "id": str(envelope.event_id),
                "data": envelope.model_dump_json(),
            }

        async def should_stop_after(event_type: str) -> bool:
            if event_type not in {"run.completed", "run.failed", "run.cancelled"}:
                return False
            current = await current_status()
            # A failed attempt may already have been moved back to QUEUED by
            # recovery. Keep the stream alive for run.recovered and the next
            # checkpoint attempt; stop only for the persisted final status.
            return current in {
                RunStatus.SUCCEEDED.value,
                RunStatus.FAILED.value,
                RunStatus.CANCELLED.value,
            }

        try:
            # The FastAPI dependency session is closed as soon as the
            # response object is returned.  SSE outlives that request scope,
            # so replay and terminal-state checks must use short-lived
            # sessions owned by the iterator instead of the detached `run`
            # instance captured above.
            async with SessionFactory() as replay_session:
                replayed = await replay_events(replay_session, run_id, after_sequence)
            for envelope in replayed:
                item = await emit(envelope)
                if item:
                    yield item
            # A Run can be recovered after a terminal event. Only stop the
            # stream when the persisted current status is terminal; an old
            # failed/completed event in the replay must not hide run.recovered.
            status = await current_status()
            if not status or status in {
                RunStatus.SUCCEEDED.value,
                RunStatus.FAILED.value,
                RunStatus.CANCELLED.value,
            }:
                return
            while True:
                if await request.is_disconnected():
                    break

                # ARQ workers run in a separate process from the API. The
                # in-memory broker is still useful for same-process delivery,
                # but persisted-event polling is required for live SSE across
                # processes. A short interval keeps token batches and tool
                # results visible without forcing a full Thread refresh.
                for envelope in await persisted_events():
                    item = await emit(envelope)
                    if item:
                        yield item
                    if await should_stop_after(envelope.type):
                        return

                try:
                    envelope = await asyncio.wait_for(queue.get(), timeout=0.25)
                    item = await emit(envelope)
                    if item:
                        yield item
                    if await should_stop_after(envelope.type):
                        return
                except TimeoutError:
                    # The next loop polls the durable event log. Send a
                    # heartbeat less frequently through the normal SSE ping
                    # channel rather than adding noisy application events.
                    continue
        finally:
            event_broker.unsubscribe(run_id, queue)

    return EventSourceResponse(iterator(), ping=None)
