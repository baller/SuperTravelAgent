from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentActivityEvent, Event, ToolUsageLedger
from app.domain.schemas import EventEnvelope


class EventBroker:
    """Persist every event before broadcasting it to local SSE subscribers."""

    def __init__(self) -> None:
        self._subscribers: dict[UUID, set[asyncio.Queue[EventEnvelope]]] = defaultdict(set)

    async def publish(
        self,
        session: AsyncSession,
        event_type: str,
        payload: dict[str, Any],
        *,
        trip_id: UUID | None = None,
        thread_id: UUID | None = None,
        run_id: UUID | None = None,
        commit: bool = True,
    ) -> EventEnvelope:
        # Real tool calls are executed concurrently and each call owns a
        # separate database session. Serialise sequence allocation per Run (or
        # Trip stream) so MAX(sequence) + 1 cannot race and abort a provider
        # call with uq_run_sequence.
        bind = session.get_bind()
        if bind.dialect.name == "postgresql":
            scope_id = run_id or trip_id
            if scope_id is not None:
                lock_key = int.from_bytes(scope_id.bytes[:8], byteorder="big", signed=True)
                await session.execute(select(func.pg_advisory_xact_lock(lock_key)))
        sequence_scope = Event.run_id == run_id if run_id else Event.trip_id == trip_id
        payload = dict(payload)
        activity = _activity_descriptor(event_type, payload, run_id=run_id, thread_id=thread_id)
        if activity:
            payload.setdefault("activity_id", activity["activity_id"])
        current = await session.scalar(select(func.max(Event.sequence)).where(sequence_scope))
        event = Event(
            sequence=(current or 0) + 1,
            type=event_type,
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            payload=payload,
        )
        session.add(event)
        await session.flush()
        if activity and run_id and thread_id:
            session.add(
                AgentActivityEvent(
                    event_id=event.id,
                    run_id=run_id,
                    thread_id=thread_id,
                    sequence=event.sequence,
                    activity_id=activity["activity_id"],
                    phase=activity["phase"],
                    kind=activity["kind"],
                    status=activity["status"],
                    title=activity["title"],
                    summary=activity["summary"],
                    detail=activity["detail"],
                    visibility="public",
                )
            )
            if event_type in {"tool.started", "tool.completed", "tool.failed"}:
                await _record_tool_usage(session, activity, payload, run_id=run_id, thread_id=thread_id)
            await session.flush()
        if commit:
            await session.commit()
        envelope = EventEnvelope(
            event_id=event.id,
            sequence=event.sequence,
            type=event.type,
            occurred_at=event.created_at or datetime.now(UTC),
            trip_id=event.trip_id,
            thread_id=event.thread_id,
            run_id=event.run_id,
            payload=event.payload,
        )
        if run_id:
            for queue in tuple(self._subscribers[run_id]):
                await queue.put(envelope)
        return envelope

    def subscribe(self, run_id: UUID) -> asyncio.Queue[EventEnvelope]:
        queue: asyncio.Queue[EventEnvelope] = asyncio.Queue(maxsize=200)
        self._subscribers[run_id].add(queue)
        return queue

    def unsubscribe(self, run_id: UUID, queue: asyncio.Queue[EventEnvelope]) -> None:
        self._subscribers[run_id].discard(queue)
        if not self._subscribers[run_id]:
            self._subscribers.pop(run_id, None)


event_broker = EventBroker()


def _activity_descriptor(
    event_type: str,
    payload: dict[str, Any],
    *,
    run_id: UUID | None,
    thread_id: UUID | None,
) -> dict[str, Any] | None:
    if not run_id or not thread_id:
        return None
    public_types = {
        "progress.started",
        "progress.updated",
        "progress.completed",
        "tool.started",
        "tool.completed",
        "tool.failed",
        "question.created",
        "question.answered",
        "component.created",
        "component.updated",
        "artifact.created",
        "artifact.updated",
        "validation.completed",
        "run.waiting_user",
        "run.partial",
        "run.recovered",
        "run.failed",
        "run.cancelled",
        "run.completed",
    }
    if event_type not in public_types:
        return None

    if event_type.startswith("tool."):
        activity_id = str(payload.get("activity_id") or f"tool:{payload.get('tool_call_id') or event_type}")
        kind = "tool_call" if event_type == "tool.started" else "tool_result"
        status = "running" if event_type == "tool.started" else "failed" if event_type == "tool.failed" else "completed"
        title = str(payload.get("title") or payload.get("name") or "真实信息查询")
        summary = str(payload.get("summary") or payload.get("error") or "") or None
        detail = {
            key: payload.get(key)
            for key in ("provider", "arguments", "result_count", "cache_state", "sources", "duration_ms")
            if payload.get(key) is not None
        }
        return {"activity_id": activity_id, "phase": "research", "kind": kind, "status": status, "title": title, "summary": summary, "detail": detail}

    if event_type.startswith("question.") or event_type.startswith("component."):
        component_id = payload.get("component_id") or (payload.get("component") or {}).get("id")
        activity_id = str(payload.get("activity_id") or f"question:{component_id or event_type}")
        return {
            "activity_id": activity_id,
            "phase": "understanding",
            "kind": "decision",
            "status": "waiting" if event_type in {"question.created", "component.created"} else "completed",
            "title": str(payload.get("title") or payload.get("prompt") or "需要确认一个旅行方向"),
            "summary": str(payload.get("summary") or "") or None,
            "detail": {"component_id": component_id, "component_type": payload.get("type") or payload.get("component_type")},
        }

    if event_type.startswith("progress."):
        step_id = str(payload.get("step_id") or event_type)
        phase = "understanding" if "understand" in step_id else "planning" if "decision" in step_id else "response"
        return {
            "activity_id": str(payload.get("activity_id") or f"progress:{step_id}"),
            "phase": phase,
            "kind": "progress",
            "status": "completed" if event_type == "progress.completed" else "running",
            "title": str(payload.get("title") or "正在处理"),
            "summary": str(payload.get("summary") or "") or None,
            "detail": {"iteration": payload.get("iteration")} if payload.get("iteration") is not None else None,
        }

    if event_type.startswith("artifact."):
        return {
            "activity_id": str(payload.get("activity_id") or f"artifact:{payload.get('artifact_id') or event_type}"),
            "phase": "planning",
            "kind": "artifact",
            "status": "completed",
            "title": str(payload.get("title") or "保存旅行中间产物"),
            "summary": str(payload.get("summary") or "") or None,
            "detail": {"artifact_id": payload.get("artifact_id"), "artifact_type": payload.get("artifact_type")},
        }

    if event_type.startswith("validation."):
        return {
            "activity_id": str(payload.get("activity_id") or f"validation:{run_id}"),
            "phase": "validation",
            "kind": "validation",
            "status": "completed",
            "title": str(payload.get("title") or "检查方案可执行性"),
            "summary": str(payload.get("summary") or payload.get("message") or "") or None,
            "detail": {"blocking": payload.get("blocking"), "warnings": payload.get("warnings")},
        }

    status = "waiting" if event_type == "run.waiting_user" else "failed" if event_type == "run.failed" else "cancelled" if event_type == "run.cancelled" else "completed"
    return {
        "activity_id": str(payload.get("activity_id") or f"run:{run_id}"),
        "phase": "response",
        "kind": "warning" if status in {"failed", "cancelled"} else "progress",
        "status": status,
        "title": str(payload.get("title") or {"run.waiting_user": "等待你的选择", "run.completed": "本轮回答已完成"}.get(event_type, "本轮处理状态")),
        "summary": str(payload.get("summary") or payload.get("message") or "") or None,
        "detail": None,
    }


async def _record_tool_usage(
    session: AsyncSession,
    activity: dict[str, Any],
    payload: dict[str, Any],
    *,
    run_id: UUID,
    thread_id: UUID,
) -> None:
    activity_id = activity["activity_id"]
    row = await session.scalar(
        select(ToolUsageLedger).where(ToolUsageLedger.run_id == run_id, ToolUsageLedger.activity_id == activity_id)
    )
    if row is None:
        row = ToolUsageLedger(
            run_id=run_id,
            thread_id=thread_id,
            activity_id=activity_id,
            provider=str(payload.get("provider") or "unknown"),
            tool_name=str(payload.get("name") or "unknown"),
            status="RUNNING",
        )
        session.add(row)
    if payload.get("cache_state") is not None:
        row.cache_hit = payload.get("cache_state") == "cached"
    if payload.get("result_count") is not None:
        row.result_count = int(payload["result_count"])
    if payload.get("duration_ms") is not None:
        row.duration_ms = int(payload["duration_ms"])
    row.status = "FAILED" if activity["status"] == "failed" else "SUCCEEDED" if activity["status"] == "completed" else "RUNNING"


async def replay_events(session: AsyncSession, run_id: UUID, after_sequence: int = 0) -> list[EventEnvelope]:
    events = (
        await session.scalars(
            select(Event)
            .where(Event.run_id == run_id, Event.sequence > after_sequence)
            .order_by(Event.sequence.asc())
        )
    ).all()
    return [
        EventEnvelope(
            event_id=event.id,
            sequence=event.sequence,
            type=event.type,
            occurred_at=event.created_at,
            trip_id=event.trip_id,
            thread_id=event.thread_id,
            run_id=event.run_id,
            payload=event.payload,
        )
        for event in events
    ]
