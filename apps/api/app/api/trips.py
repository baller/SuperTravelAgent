from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from arq.jobs import Job
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.policy import derive_plan_readiness, stage_for
from app.db.models import (
    AgentActivityEvent,
    AgentRun,
    ConversationThread,
    DecisionRequest,
    Event,
    Message,
    PlanPatch,
    PlanVersion,
    SourceRecord,
    TravelConversationState,
    Trip,
    TripArtifact,
    UIComponent,
    Watch,
)
from app.db.session import get_session
from app.domain.enums import PatchState, RunStatus, TripLifecycle
from app.domain.schemas import (
    ConversationThreadCreate,
    ConversationThreadUpdate,
    DecisionData,
    DecisionResolveRequest,
    ItemActionRequest,
    PlanSnapshot,
    TripCreate,
    TripDetail,
    TripSpecData,
    TripSummary,
    TripUpdate,
    VersionRestoreRequest,
    WatchData,
)
from app.services.events import event_broker
from app.services.patches import PatchError, restore_version
from app.services.planner import commit_plan
from app.services.sources import source_data
from app.services.trips import create_trip, get_current_plan, get_trip_model, list_trips, trip_detail

router = APIRouter(prefix="/trips", tags=["trips"])


_TOOL_NAMES = {
    "web_search": "搜索公开网页",
    "web_fetch": "阅读公开网页",
    "llm.extract_request": "理解旅行意图",
    "search_places": "检索真实地点",
    "get_place_detail": "核验地点详情",
    "search_nearby": "检索附近地点",
    "search_hotel_pois": "检索住宿地点",
    "geocode": "解析地理位置",
    "reverse_geocode": "核验行政区",
    "plan_walking_route": "计算步行路线",
    "plan_transit_route": "计算公共交通路线",
    "plan_driving_route": "计算驾车路线",
    "get_weather_forecast": "查询天气",
    "map_geocode": "解析地理位置",
    "map_search_places": "检索真实地点",
    "map_place_details": "核验地点详情",
    "map_directions": "计算真实路线",
    "map_weather": "查询天气",
    "xhs_check_cookie": "检查小红书只读会话",
    "xhs_search_notes": "搜索小红书真实笔记",
    "xhs_get_note_content": "读取小红书笔记正文",
    "query-tickets": "查询 12306 车次",
    "query-ticket-price": "查询 12306 票价",
    "search-stations": "解析 12306 车站",
    "query-transfer": "查询 12306 中转方案",
    "llm.research_plan": "生成地点检索策略",
    "llm.schedule": "编排行程时间结构",
    "llm.patch_proposal": "理解局部修改范围",
    "llm.answer_trip_question": "基于旅程状态组织回答",
    "llm.summarize_conversation": "压缩历史对话上下文",
}

def _process_step(event: Event) -> dict | None:
    """Return an auditable work summary without exposing hidden model reasoning."""

    payload = event.payload or {}
    event_type = event.type
    if event_type in {"progress.started", "progress.updated", "progress.completed"}:
        return {
            "id": str(payload.get("activity_id") or f"progress:{payload.get('step_id') or event.id}"),
            "kind": "progress",
            "label": str(payload.get("title") or "正在处理"),
            "detail": str(payload.get("summary") or ""),
            "status": "running" if event_type != "progress.completed" else "completed",
            "occurred_at": event.created_at.isoformat(),
            "result": None,
            "sources": [],
        }
    if event_type in {"tool.started", "tool.completed", "tool.failed"}:
        raw_name = str(payload.get("name") or "外部工具")
        label = _TOOL_NAMES.get(raw_name, raw_name.replace("_", " "))
        provider = payload.get("provider")
        arguments = payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
        query = arguments.get("query") or arguments.get("keywords") or arguments.get("address")
        origin = arguments.get("origin") or arguments.get("from_station")
        destination = arguments.get("destination") or arguments.get("to_station")
        if query:
            detail = f"{provider or '真实数据服务'} · 查询“{str(query)[:160]}”"
        elif origin and destination:
            detail = f"{provider or '真实数据服务'} · {origin} → {destination}"
        else:
            detail = str(provider or "真实数据服务")
        return {
            "id": str(payload.get("activity_id") or f"tool:{payload.get('tool_call_id') or event.id}"),
            "kind": "tool",
            "label": label,
            "detail": detail,
            "status": "running" if event_type == "tool.started" else "failed" if event_type == "tool.failed" else "completed",
            "occurred_at": event.created_at.isoformat(),
            "result": (
                {"error": str(payload.get("error") or "工具未返回可用结果")[:600]}
                if event_type == "tool.failed"
                else payload.get("result")
            ),
            "result_count": payload.get("result_count"),
            "arguments": payload.get("arguments") if event_type == "tool.started" else arguments,
            "sources": payload.get("sources") or [],
            "cache_state": payload.get("cache_state"),
        }
    labels = {
        "question.created": ("需要你确认", str(payload.get("prompt") or "请完成对话中的选择"), "waiting"),
        "question.answered": ("已收到你的选择", "我会从同一个运行继续处理", "completed"),
        "trip.spec.updated": ("更新旅程需求", "只写入当前 Trip 的结构化状态", "completed"),
        "trip.plan.preview": ("生成并校验行程预览", "尚未写入正式版本", "completed"),
        "trip.plan.committed": ("提交行程版本", "Trip State 已生成可撤销版本", "completed"),
        "trip.patch.preview": ("生成局部调整预览", "先校验作用域、锁定项与路线", "completed"),
        "trip.patch.applied": ("应用局部调整", "已创建新的可撤销版本", "completed"),
        "trip.patch.rejected": ("保留原计划", "预览未写入 Trip State", "completed"),
        "run.completed": ("本次处理完成", "结果和执行记录已保存", "completed"),
        "run.failed": ("本次处理失败", "已保留此前可信状态，可重试", "failed"),
        "run.cancelled": ("本次处理已停止", "没有提交未确认的写入", "cancelled"),
    }
    data = labels.get(event_type)
    if not data:
        return None
    label, detail, state = data
    return {
            "id": str(payload.get("activity_id") or event.id),
        "kind": "state",
        "label": label,
        "detail": detail,
        "status": state,
        "occurred_at": event.created_at.isoformat(),
        "result": None,
        "sources": [],
    }


async def _thread_summary(session: AsyncSession, thread: ConversationThread) -> dict:
    message_count = await session.scalar(select(func.count(Message.id)).where(Message.thread_id == thread.id))
    run_count = await session.scalar(select(func.count(AgentRun.id)).where(AgentRun.thread_id == thread.id))
    return {
        "id": str(thread.id),
        "trip_id": str(thread.trip_id),
        "title": thread.title,
        "status": thread.status,
        "summary": thread.summary,
        "message_count": message_count or 0,
        "run_count": run_count or 0,
        "last_message_at": thread.last_message_at.isoformat() if thread.last_message_at else None,
        "created_at": thread.created_at.isoformat(),
        "updated_at": thread.updated_at.isoformat(),
    }


async def _thread_detail(session: AsyncSession, thread: ConversationThread) -> dict:
    messages = (
        await session.scalars(select(Message).where(Message.thread_id == thread.id).order_by(Message.created_at))
    ).all()
    component_rows = (
        await session.scalars(
            select(UIComponent).where(UIComponent.thread_id == thread.id).order_by(UIComponent.created_at)
        )
    ).all()
    # Defensive projection for pre-migration data: one component occupies one
    # semantic slot in a run, preferring the applied/latest record.
    components_by_slot: dict[tuple[UUID, str], UIComponent] = {}
    for component in component_rows:
        slot = (component.run_id, component.type)
        current = components_by_slot.get(slot)
        if current is None or component.state == "APPLIED" or component.created_at > current.created_at:
            components_by_slot[slot] = component
    components = sorted(components_by_slot.values(), key=lambda item: item.created_at)
    runs = (
        await session.scalars(select(AgentRun).where(AgentRun.thread_id == thread.id).order_by(AgentRun.created_at))
    ).all()
    events = (
        await session.scalars(select(Event).where(Event.thread_id == thread.id).order_by(Event.created_at, Event.sequence))
    ).all()
    source_rows = (
        await session.scalars(
            select(SourceRecord)
            .join(AgentRun, AgentRun.id == SourceRecord.run_id)
            .where(AgentRun.thread_id == thread.id)
            .order_by(SourceRecord.retrieved_at)
        )
    ).all()
    conversation_state = await session.scalar(
        select(TravelConversationState).where(TravelConversationState.thread_id == thread.id)
    )
    if conversation_state is None:
        # Lazy backfill keeps old threads readable immediately after migration;
        # the next detail request then uses the same durable controller state as
        # newly created conversations.
        trip = await session.get(Trip, thread.trip_id)
        spec = TripSpecData.model_validate(trip.trip_spec if trip else {})
        readiness = derive_plan_readiness(spec)
        conversation_state = TravelConversationState(
            thread_id=thread.id,
            stage=stage_for(spec, has_plan=bool(trip and trip.current_version > 0)),
            readiness=readiness.model_dump(mode="json"),
            assumptions=list(spec.assumptions),
        )
        session.add(conversation_state)
        await session.commit()
    artifact_rows = (
        await session.scalars(
            select(TripArtifact).where(TripArtifact.thread_id == thread.id).order_by(TripArtifact.created_at.asc())
        )
    ).all()
    activity_rows = (
        await session.scalars(
            select(AgentActivityEvent)
            .where(AgentActivityEvent.thread_id == thread.id)
            .order_by(AgentActivityEvent.created_at.asc(), AgentActivityEvent.sequence.asc())
        )
    ).all()
    pending_component_count = await session.scalar(
        select(func.count(UIComponent.id)).where(
            UIComponent.thread_id == thread.id,
            UIComponent.state.in_(["CREATED", "PRESENTED"]),
        )
    )
    steps_by_run: dict[UUID, list[dict]] = {}
    sources_by_run: dict[UUID, list[dict]] = {}
    activities_by_run: dict[UUID, list[dict]] = {}
    for event in events:
        if not event.run_id:
            continue
        step = _process_step(event)
        if step:
            steps = steps_by_run.setdefault(event.run_id, [])
            previous = next((item for item in steps if item["id"] == step["id"]), None)
            if previous:
                detail = (
                    previous.get("detail")
                    if step["kind"] == "tool" and not step.get("arguments")
                    else step.get("detail") or previous.get("detail")
                )
                previous.update({**step, "detail": detail, "occurred_at": previous["occurred_at"]})
            else:
                steps.append(step)
    for source in source_rows:
        sources_by_run.setdefault(source.run_id, []).append(source_data(source).model_dump(mode="json"))
    for activity in activity_rows:
        activities_by_run.setdefault(activity.run_id, []).append(
            {
                "id": str(activity.id),
                "event_id": str(activity.event_id),
                "sequence": activity.sequence,
                "activity_id": activity.activity_id,
                "phase": activity.phase,
                "kind": activity.kind,
                "status": activity.status,
                "title": activity.title,
                "summary": activity.summary,
                "detail": activity.detail,
                "created_at": activity.created_at.isoformat(),
            }
        )
    summary = await _thread_summary(session, thread)
    return {
        **summary,
        "messages": [
            {
                "id": str(item.id),
                "role": item.role,
                "content": item.content,
                "run_id": str(item.run_id) if item.run_id else None,
                "meta": item.meta,
                "created_at": item.created_at.isoformat(),
            }
            for item in messages
        ],
        "components": [
            {
                "id": str(item.id),
                "type": item.type,
                "state": item.state,
                "props": item.props,
                "value": item.value,
                "run_id": str(item.run_id),
                "base_version": item.base_version,
                "created_at": item.created_at.isoformat(),
            }
            for item in components
        ],
        "runs": [
            {
                "id": str(run.id),
                "status": run.status,
                "intent": run.intent,
                "current_step": run.current_step,
                "error": run.error,
                "created_at": run.created_at.isoformat(),
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                "steps": steps_by_run.get(run.id, []),
                "activities": activities_by_run.get(run.id, []),
                "sources": sources_by_run.get(run.id, []),
            }
            for run in runs
        ],
        "conversation_state": {
            "stage": conversation_state.stage,
            "planning_consent": conversation_state.planning_consent,
            "active_goal": conversation_state.active_goal,
            "consecutive_question_turns": conversation_state.consecutive_question_turns,
            "asked_topics": conversation_state.asked_topics or [],
            "skipped_topics": conversation_state.skipped_topics or [],
            "assumption_permission": conversation_state.assumption_permission,
            "interaction_mode": conversation_state.interaction_mode,
            "last_value_delivery_turn": conversation_state.last_value_delivery_turn,
            "pending_decision_topic": conversation_state.pending_decision_topic,
            "classification_done": conversation_state.classification_done,
            "source_user_message_id": str(conversation_state.source_user_message_id) if conversation_state.source_user_message_id else None,
            "readiness": conversation_state.readiness,
            "assumptions": conversation_state.assumptions or [],
        } if conversation_state else None,
        "artifacts": [
            {
                "id": str(item.id),
                "type": item.type,
                "trip_id": str(item.trip_id),
                "thread_id": str(item.thread_id),
                "run_id": str(item.run_id) if item.run_id else None,
                "version": item.version,
                "status": item.status,
                "payload": item.payload,
                "assumptions": item.assumptions or [],
                "source_ids": item.source_ids or [],
                "created_at": item.created_at.isoformat(),
            }
            for item in artifact_rows
        ],
        "latest_run": (
            {
                "id": str(runs[-1].id),
                "status": runs[-1].status,
                "current_step": runs[-1].current_step,
                "created_at": runs[-1].created_at.isoformat(),
            }
            if runs else None
        ),
        "pending_component_count": int(pending_component_count or 0),
    }


@router.get("", response_model=list[TripSummary])
async def get_trips(session: AsyncSession = Depends(get_session)) -> list[TripSummary]:
    return await list_trips(session)


@router.post("", response_model=TripDetail, status_code=status.HTTP_201_CREATED)
async def post_trip(payload: TripCreate, session: AsyncSession = Depends(get_session)) -> TripDetail:
    trip, _ = await create_trip(session, payload.title)
    return await trip_detail(session, trip)


@router.get("/{trip_id}", response_model=TripDetail)
async def get_trip(trip_id: UUID, session: AsyncSession = Depends(get_session)) -> TripDetail:
    trip = await get_trip_model(session, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    return await trip_detail(session, trip)


@router.patch("/{trip_id}", response_model=TripDetail)
async def patch_trip(
    trip_id: UUID,
    payload: TripUpdate,
    session: AsyncSession = Depends(get_session),
) -> TripDetail:
    trip = await get_trip_model(session, trip_id, for_update=True)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    if payload.title is not None:
        trip.title = payload.title.strip() or trip.title
    if payload.category is not None:
        trip.category = " ".join(payload.category.split())[:64] or "未分类"
    if payload.lifecycle is not None:
        trip.lifecycle = payload.lifecycle.value
    await session.commit()
    return await trip_detail(session, trip)


@router.delete(
    "/{trip_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def archive_trip(
    trip_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> Response:
    trip = await get_trip_model(session, trip_id, for_update=True)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")

    active_runs = list(
        (
            await session.scalars(
                select(AgentRun)
                .where(
                    AgentRun.trip_id == trip.id,
                    AgentRun.status.in_(
                        [
                            RunStatus.QUEUED.value,
                            RunStatus.RUNNING.value,
                            RunStatus.WAITING_USER.value,
                            RunStatus.PARTIAL.value,
                        ]
                    ),
                )
                .with_for_update()
            )
        ).all()
    )
    queue = getattr(request.app.state, "agent_queue", None)
    if queue is not None:
        for run in active_runs:
            if not run.active_job_id:
                continue
            try:
                for queue_name in ("arq:queue", "arq:agent-recovery"):
                    await Job(run.active_job_id, queue, _queue_name=queue_name).abort(timeout=0)
            except Exception:
                # Durable CANCELLED is authoritative; a running worker observes
                # it before its next model or tool call.
                pass
    for run in active_runs:
        run.status = RunStatus.CANCELLED.value
        run.cancelled_at = datetime.now(UTC)
        await event_broker.publish(
            session,
            "run.cancelled",
            {"status": RunStatus.CANCELLED.value, "reason": "trip_archived"},
            trip_id=run.trip_id,
            thread_id=run.thread_id,
            run_id=run.id,
            commit=False,
        )
    trip.archived = True
    trip.lifecycle = TripLifecycle.ARCHIVED.value
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{trip_id}/threads")
async def get_threads(trip_id: UUID, session: AsyncSession = Depends(get_session)) -> list[dict]:
    trip = await get_trip_model(session, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    rows = (
        await session.scalars(
            select(ConversationThread)
            .where(ConversationThread.trip_id == trip_id)
            .order_by(
                ConversationThread.status.asc(),
                ConversationThread.last_message_at.desc().nullslast(),
                ConversationThread.created_at.desc(),
            )
        )
    ).all()
    return [await _thread_summary(session, row) for row in rows]


@router.post("/{trip_id}/threads", status_code=status.HTTP_201_CREATED)
async def post_thread(
    trip_id: UUID,
    payload: ConversationThreadCreate,
    session: AsyncSession = Depends(get_session),
) -> dict:
    trip = await get_trip_model(session, trip_id, for_update=True)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    title = " ".join((payload.title or "新对话").split())[:120] or "新对话"
    thread = ConversationThread(trip_id=trip.id, title=title, status="ACTIVE")
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    return await _thread_summary(session, thread)


@router.get("/{trip_id}/threads/{thread_id}")
async def get_thread_by_id(
    trip_id: UUID,
    thread_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    thread = await session.scalar(
        select(ConversationThread).where(
            ConversationThread.id == thread_id,
            ConversationThread.trip_id == trip_id,
        )
    )
    if not thread:
        raise HTTPException(status_code=404, detail="对话不存在或不属于当前 Trip")
    return await _thread_detail(session, thread)


@router.patch("/{trip_id}/threads/{thread_id}")
async def patch_thread(
    trip_id: UUID,
    thread_id: UUID,
    payload: ConversationThreadUpdate,
    session: AsyncSession = Depends(get_session),
) -> dict:
    thread = await session.scalar(
        select(ConversationThread)
        .where(ConversationThread.id == thread_id, ConversationThread.trip_id == trip_id)
        .with_for_update()
    )
    if not thread:
        raise HTTPException(status_code=404, detail="对话不存在或不属于当前 Trip")
    if payload.status == "ARCHIVED":
        active_runs = await session.scalar(
            select(func.count(AgentRun.id)).where(
                AgentRun.thread_id == thread.id,
                AgentRun.status.in_(["QUEUED", "RUNNING", "WAITING_USER", "PARTIAL"]),
            )
        )
        if active_runs:
            raise HTTPException(status_code=409, detail="当前对话仍有未完成运行，停止或完成后再归档")
    if payload.title is not None:
        thread.title = " ".join(payload.title.split())[:120] or thread.title
    if payload.status is not None:
        thread.status = payload.status
    await session.commit()
    await session.refresh(thread)
    return await _thread_summary(session, thread)


@router.delete("/{trip_id}/threads/{thread_id}")
async def delete_thread(
    trip_id: UUID,
    thread_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Delete one conversation and all of its durable run history.

    A Trip always keeps an active conversation after this transaction so the
    workspace never falls back to an arbitrary archived transcript.
    """

    thread = await session.scalar(
        select(ConversationThread)
        .where(ConversationThread.id == thread_id, ConversationThread.trip_id == trip_id)
        .with_for_update()
    )
    if not thread:
        raise HTTPException(status_code=404, detail="对话不存在或不属于当前 Trip")
    active_runs = await session.scalar(
        select(func.count(AgentRun.id)).where(
            AgentRun.thread_id == thread.id,
            AgentRun.status.in_(["QUEUED", "RUNNING", "WAITING_USER", "PARTIAL"]),
        )
    )
    if active_runs:
        raise HTTPException(status_code=409, detail="当前对话仍有未完成运行，停止后再删除")

    checkpoint_threads = list(
        (
            await session.scalars(
                select(AgentRun.checkpoint_thread_id).where(AgentRun.thread_id == thread.id)
            )
        ).all()
    )
    replacement = await session.scalar(
        select(ConversationThread)
        .where(
            ConversationThread.trip_id == trip_id,
            ConversationThread.id != thread_id,
            ConversationThread.status == "ACTIVE",
        )
        .order_by(
            ConversationThread.last_message_at.desc().nullslast(),
            ConversationThread.created_at.desc(),
        )
        .limit(1)
    )
    if not replacement:
        replacement = ConversationThread(trip_id=trip_id, title="新对话", status="ACTIVE")
        session.add(replacement)
        await session.flush()

    await session.delete(thread)
    await session.flush()
    # LangGraph checkpoint tables deliberately have no application-domain
    # foreign key. Remove their rows explicitly so a deleted conversation is
    # actually deleted, not merely hidden from the UI.
    for checkpoint_thread in checkpoint_threads:
        for table_name in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            await session.execute(
                text(f'DELETE FROM "{table_name}" WHERE thread_id = :thread_id'),
                {"thread_id": checkpoint_thread},
            )
    await session.commit()
    await session.refresh(replacement)
    return {
        "deleted_thread_id": str(thread_id),
        "replacement_thread": await _thread_summary(session, replacement),
    }


@router.get("/{trip_id}/thread")
async def get_thread(trip_id: UUID, session: AsyncSession = Depends(get_session)) -> dict:
    """Compatibility endpoint returning the most recently active thread."""

    thread = await session.scalar(
        select(ConversationThread)
        .where(ConversationThread.trip_id == trip_id, ConversationThread.status == "ACTIVE")
        .order_by(
            ConversationThread.last_message_at.desc().nullslast(),
            ConversationThread.created_at.desc(),
        )
    )
    if not thread:
        raise HTTPException(status_code=404, detail="对话不存在")
    return await _thread_detail(session, thread)


@router.get("/{trip_id}/versions")
async def get_versions(trip_id: UUID, session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = (
        await session.scalars(
            select(PlanVersion).where(PlanVersion.trip_id == trip_id).order_by(PlanVersion.version.desc())
        )
    ).all()
    return [
        {
            "id": str(row.id),
            "version": row.version,
            "reason": row.reason,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.post("/{trip_id}/versions/restore")
async def post_restore_version(
    trip_id: UUID,
    payload: VersionRestoreRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    trip = await get_trip_model(session, trip_id, for_update=True)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    try:
        row = await restore_version(session, trip, payload.version, payload.idempotency_key)
    except PatchError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"version": row.version, "reason": row.reason}


@router.post("/{trip_id}/items/{item_id}/actions")
async def post_item_action(
    trip_id: UUID,
    item_id: str,
    payload: ItemActionRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    existing = await session.scalar(select(PlanPatch).where(PlanPatch.idempotency_key == payload.idempotency_key))
    if existing:
        return {"patch_id": str(existing.id), "state": existing.state}
    trip = await get_trip_model(session, trip_id, for_update=True)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip 不存在")
    current = await get_current_plan(session, trip)
    if not current:
        raise HTTPException(status_code=409, detail="Trip 还没有计划")
    proposed = PlanSnapshot.model_validate(current.model_dump(mode="json"))
    target = None
    target_day = None
    for day in proposed.days:
        target = next((item for item in day.items if item.id == item_id), None)
        if target:
            target_day = day
            break
    if not target or target_day is None:
        raise HTTPException(status_code=404, detail="行程项不存在")
    operation = {"op": payload.action, "item_id": item_id, "day_index": target.day_index, "payload": {}}
    if payload.action == "COMPLETE":
        target.status = "COMPLETED"
    elif payload.action == "SKIP":
        if target.locked or target.reservation_state == "booked":
            raise HTTPException(
                status_code=409,
                detail="锁定或已预约项目不能直接跳过，请通过 Agent 生成变更预览",
            )
        target.status = "SKIPPED"
    elif payload.action == "LOCK":
        target.locked = True
    elif payload.action == "UNLOCK":
        target.locked = False
    elif payload.action == "DELAY":
        if not payload.minutes:
            raise HTTPException(status_code=422, detail="延迟操作需要 minutes")
        delta = payload.minutes
        affected = [item for item in target_day.items if item.start_at >= target.start_at]
        if any(item.locked or item.reservation_state == "booked" for item in affected):
            raise HTTPException(status_code=409, detail="延迟会影响后续锁定项目，请通过 Agent 生成变更预览")
        for item in affected:
            item.start_at += timedelta(minutes=delta)
            item.end_at += timedelta(minutes=delta)
        operation["payload"] = {"minutes": delta}
    patch = PlanPatch(
        trip_id=trip.id,
        base_version=trip.current_version,
        state=PatchState.APPLIED.value,
        scope={"day_index": target.day_index, "item_id": item_id},
        reason=f"用户执行 {payload.action}",
        operations=[operation],
        impact={"changed_days": [target.day_index]},
        validation_result={"direct_structured_command": True},
        proposed_snapshot=proposed.model_dump(mode="json"),
        idempotency_key=payload.idempotency_key,
    )
    session.add(patch)
    await session.flush()
    version = await commit_plan(
        session,
        trip,
        proposed,
        reason=patch.reason,
        source_patch_id=patch.id,
    )
    return {"patch_id": str(patch.id), "state": patch.state, "version": version.version}


@router.get("/{trip_id}/watches", response_model=list[WatchData])
async def get_watches(trip_id: UUID, session: AsyncSession = Depends(get_session)) -> list[WatchData]:
    rows = (await session.scalars(select(Watch).where(Watch.trip_id == trip_id))).all()
    return [WatchData.model_validate(row) for row in rows]


@router.get("/{trip_id}/decisions", response_model=list[DecisionData])
async def get_decisions(trip_id: UUID, session: AsyncSession = Depends(get_session)) -> list[DecisionData]:
    rows = (
        await session.scalars(
            select(DecisionRequest)
            .where(DecisionRequest.trip_id == trip_id)
            .order_by(DecisionRequest.state.asc(), DecisionRequest.created_at.desc())
        )
    ).all()
    return [DecisionData.model_validate(row) for row in rows]


@router.post("/{trip_id}/decisions/{decision_id}/resolve", response_model=DecisionData)
async def resolve_decision(
    trip_id: UUID,
    decision_id: UUID,
    payload: DecisionResolveRequest,
    session: AsyncSession = Depends(get_session),
) -> DecisionData:
    row = await session.scalar(
        select(DecisionRequest)
        .where(DecisionRequest.id == decision_id, DecisionRequest.trip_id == trip_id)
        .with_for_update()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Decision 不存在")
    if row.state == "OPEN":
        valid = {str(option.get("id")) for option in row.options}
        if payload.option_id not in valid:
            raise HTTPException(status_code=422, detail="无效选项")
        row.resolved_option = payload.option_id
        row.state = "RESOLVED"
        row.updated_at = datetime.now(UTC)
        await session.commit()
    return DecisionData.model_validate(row)
