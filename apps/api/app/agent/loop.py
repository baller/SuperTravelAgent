from __future__ import annotations

import asyncio
import json
import math
import re
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from sqlalchemy import select

from app.agent.llm import PatchProposal, ScheduleProposal, llm_client
from app.agent.policy import (
    assumption_permission_from_message,
    assumption_permission_revoked_by_message,
    blocking_gap_labels,
    derive_plan_readiness,
    normalize_topic,
    stage_for,
)
from app.core.config import get_settings
from app.db.models import (
    AgentRun,
    ConversationThread,
    DestinationDossier,
    Message,
    PlanPatch,
    SourceRecord,
    TravelConversationState,
    Trip,
    TripArtifact,
    UIComponent,
)
from app.db.session import SessionFactory
from app.domain.enums import (
    ComponentState,
    ConversationStage,
    FieldState,
    Intent,
    PatchState,
    PlanningConsent,
    PlanReadinessLevel,
    RunStatus,
    TripLifecycle,
)
from app.domain.schemas import (
    AgentAction,
    AgentComponentRequest,
    AgentToolCallRequest,
    PatchImpact,
    PatchOperation,
    PlanReadiness,
    PlanSnapshot,
    TicketCommitment,
    TripSpecData,
)
from app.services.actions import apply_natural_item_action
from app.services.events import event_broker
from app.services.patches import apply_patch, patch_data, propose_natural_language_patch, reject_patch
from app.services.planner import build_initial_plan
from app.services.sources import source_data
from app.services.tool_limits import distributed_tool_slot
from app.services.trips import get_current_plan, save_trip_spec, set_spec_value
from app.services.validator import validate_plan
from app.tools.mcp_client import ToolGatewayError, tool_gateway
from app.tools.web import web_tool_gateway


class AgentLoopState(TypedDict, total=False):
    trip_id: str
    thread_id: str
    run_id: str
    message: str
    iteration: int
    context: dict[str, Any]
    action: dict[str, Any]
    observations: list[dict[str, Any]]
    working_plan: dict[str, Any]
    candidate_places: list[dict[str, Any]]
    selected_candidates: list[dict[str, Any]]
    response_outline: str
    citation_ids: list[str]
    assistant_message: str
    patch_deferred: bool
    classified: bool
    briefing_required: bool
    plan_readiness: dict[str, Any]
    source_user_message_id: str


class RunCancelledError(RuntimeError):
    """Raised at graph boundaries when the API has persisted cancellation."""


# NOTE: These are process-local. When the API process and Agent Worker
# run as separate processes (the normal deployment), each has its own
# set of locks.  True cross-process rate limiting requires Redis or an
# external semaphore.  These still protect against intra-process
# parallel fan-out within a single Run.
_EXTERNAL_TOOL_SEMAPHORE = asyncio.Semaphore(2)
_PROVIDER_TOOL_LOCKS = {
    "baidu": asyncio.Lock(),
    "xhs": asyncio.Lock(),
    "rail": asyncio.Lock(),
}


def _tool_provider(tool_name: str) -> str | None:
    if tool_name in {"place_search", "place_detail", "geocode", "route_search", "weather_search"}:
        return "baidu"
    if tool_name in {"xhs_search", "xhs_get_note"}:
        return "xhs"
    if tool_name == "rail_search":
        return "rail"
    return None


async def _assert_run_active(state: AgentLoopState) -> None:
    _, _, run_id = _ids(state)
    async with SessionFactory() as session:
        run = await session.get(AgentRun, run_id)
        if not run:
            raise RuntimeError("Agent Run 不存在")
        if run.status == RunStatus.CANCELLED.value:
            raise RunCancelledError("Agent Run 已取消")
        run.heartbeat_at = datetime.now(UTC)
        await session.commit()


def _ids(state: AgentLoopState) -> tuple[UUID, UUID, UUID]:
    return UUID(state["trip_id"]), UUID(state["thread_id"]), UUID(state["run_id"])


async def _set_run(run: AgentRun, status: RunStatus, step: str) -> None:
    run.status = status.value
    run.current_step = step
    run.heartbeat_at = datetime.now(UTC)
    if status == RunStatus.WAITING_USER:
        # The worker has intentionally returned control to the user. Do not
        # leave its old ARQ job/lease attached to the suspended Run; the
        # component submission endpoint will acquire a fresh lease on resume.
        run.active_job_id = None
        run.lease_token = None
        run.heartbeat_at = None
    if status in {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}:
        run.completed_at = datetime.now(UTC)


async def _complete_public_progress(state: AgentLoopState, title: str, summary: str) -> None:
    trip_id, thread_id, run_id = _ids(state)
    async with SessionFactory() as session:
        await event_broker.publish(
            session,
            "progress.completed",
            {
                "step_id": f"decision-{state.get('iteration', 0)}",
                "title": title,
                "summary": summary,
            },
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=True,
        )


def _compact(value: Any, *, max_chars: int = 14_000) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        return str(value)[:max_chars]
    if len(encoded) <= max_chars:
        return value
    if isinstance(value, list):
        if not value:
            return value
        item_budget = max(240, max_chars // min(len(value), 12))
        compacted = [_compact(item, max_chars=item_budget) for item in value[:12]]
        while compacted and len(json.dumps(compacted, ensure_ascii=False, default=str)) > max_chars:
            compacted.pop()
        return compacted
    if isinstance(value, dict):
        compacted: dict[str, Any] = {}
        priority = ("status", "error", "tool", "provider", "data", "items", "days", "summary", "title", "query", "arguments")
        keys = list(value)
        ordered = [key for key in priority if key in value] + [key for key in keys if key not in priority]
        for key in ordered:
            item_budget = max(240, (max_chars - len(json.dumps(compacted, ensure_ascii=False, default=str))) // max(1, len(ordered)))
            candidate = {**compacted, str(key): _compact(value[key], max_chars=item_budget)}
            if len(json.dumps(candidate, ensure_ascii=False, default=str)) > max_chars:
                if not compacted and isinstance(value[key], str | int | float | bool):
                    compacted[str(key)] = str(value[key])[: max(80, max_chars - 20)]
                continue
            compacted = candidate
        return compacted
    return encoded[:max_chars]


def _planning_gaps(spec: TripSpecData) -> list[str]:
    return blocking_gap_labels(derive_plan_readiness(spec))


def _readiness_payload(spec: TripSpecData) -> dict[str, Any]:
    return derive_plan_readiness(spec).model_dump(mode="json")


async def _ensure_conversation_state(session, thread_id: UUID) -> TravelConversationState:
    row = await session.scalar(
        select(TravelConversationState).where(TravelConversationState.thread_id == thread_id).with_for_update()
    )
    if row is None:
        row = TravelConversationState(thread_id=thread_id)
        session.add(row)
        await session.flush()
    return row


def _conversation_state_payload(row: TravelConversationState) -> dict[str, Any]:
    return {
        "stage": row.stage,
        "planning_consent": row.planning_consent,
        "active_goal": row.active_goal,
        "consecutive_question_turns": row.consecutive_question_turns,
        "asked_topics": row.asked_topics or [],
        "skipped_topics": row.skipped_topics or [],
        "assumption_permission": row.assumption_permission,
        "interaction_mode": row.interaction_mode,
        "last_value_delivery_turn": row.last_value_delivery_turn,
        "pending_decision_topic": row.pending_decision_topic,
        "classification_done": row.classification_done,
        "source_user_message_id": str(row.source_user_message_id) if row.source_user_message_id else None,
        "readiness": row.readiness,
        "assumptions": row.assumptions or [],
    }


def _default_selected_candidates(candidates: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for candidate in candidates:
        place_id = str(candidate.get("provider_place_id") or "")
        if not place_id or not _is_schedulable_candidate(candidate):
            continue
        selected.append(candidate)
        if len(selected) >= limit:
            break
    return selected


def _is_schedulable_candidate(candidate: dict[str, Any]) -> bool:
    """Keep real POIs that can be placed in a day, not map index noise."""

    name = str(candidate.get("name") or "")
    category = str(candidate.get("category") or "")
    text = f"{name} {category}"
    excluded_markers = (
        "行政地标",
        "行政区划",
        "区县级",
        "地铁站",
        "公交站",
        "交通设施",
        "出入口",
        "进站口",
        "停车场",
        "售票处",
        "门楼",
    )
    return bool(name and candidate.get("provider_place_id")) and not any(marker in text for marker in excluded_markers)


async def _persist_artifact(
    state: AgentLoopState,
    *,
    artifact_type: str,
    payload: dict[str, Any],
    assumptions: list[str] | None = None,
    source_ids: list[str] | None = None,
    status: str = "PRESENTED",
) -> None:
    trip_id, thread_id, run_id = _ids(state)
    async with SessionFactory() as session:
        row = TripArtifact(
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            type=artifact_type,
            status=status,
            payload=_compact(payload, max_chars=50000),
            assumptions=assumptions or [],
            source_ids=source_ids or [],
        )
        session.add(row)
        await session.flush()
        if artifact_type == "destination_brief":
            destination = payload.get("trip_spec", {}).get("destination", {}) if isinstance(payload.get("trip_spec"), dict) else {}
            destination_key = str(destination.get("value") if isinstance(destination, dict) else destination or "unknown")
            session.add(
                DestinationDossier(
                    trip_id=trip_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    destination_key=destination_key,
                    overview=str(payload.get("answer") or ""),
                    source_ids=source_ids or [],
                )
            )
        await event_broker.publish(
            session,
            "artifact.created",
            {
                "artifact_id": str(row.id),
                "artifact_type": artifact_type,
                "status": status,
                "title": "目的地简报" if artifact_type == "destination_brief" else "首版行程草案",
                "summary": "已保存为可回看的中间产物。",
            },
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()


async def _persist_draft_assumptions(state: AgentLoopState, readiness_payload: dict[str, Any]) -> None:
    """Materialize safe defaults without presenting them as user-confirmed facts."""

    trip_id, thread_id, run_id = _ids(state)
    readiness = PlanReadiness.model_validate(readiness_payload)
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        if not trip:
            return
        spec = TripSpecData.model_validate(trip.trip_spec)
        assumptions = list(spec.assumptions or [])
        for value in readiness.assumptions_available.values():
            text = str(value)
            if text not in assumptions:
                assumptions.append(text)
        # The planner needs concrete calendar rows. These dates are explicitly
        # marked ASSUMED and are never treated as a user-confirmed travel date.
        if not (
            spec.start_date.state in {FieldState.CONFIRMED, FieldState.INFERRED}
            and spec.end_date.state in {FieldState.CONFIRMED, FieldState.INFERRED}
        ) and spec.duration_days.value:
            start = datetime.now(UTC).date() + timedelta(days=14)
            end = start + timedelta(days=max(1, int(spec.duration_days.value)) - 1)
            set_spec_value(spec, "start_date", start.isoformat(), FieldState.ASSUMED, "agent_assumption")
            set_spec_value(spec, "end_date", end.isoformat(), FieldState.ASSUMED, "agent_assumption")
            assumptions.append("具体日期尚未确定，首版先按一个占位日期范围排程，确认后再核验天气和交通")
        if not spec.planning_scope.value:
            set_spec_value(spec, "planning_scope", "local_only", FieldState.ASSUMED, "agent_assumption")
            assumptions.append("首版先规划目的地当地行程，不包含出发地到目的地的大交通")
        spec.assumptions = list(dict.fromkeys(assumptions))
        await save_trip_spec(session, trip, spec)
        await event_broker.publish(
            session,
            "trip.spec.updated",
            {"trip_spec": spec.model_dump(mode="json"), "kind": "planning_assumptions"},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()


def _tool_availability() -> dict[str, dict[str, Any]]:
    settings = get_settings()
    return {
        "web_search": {
            "available": settings.web_search_ready,
            "provider": "Serper",
            "arguments": {"query": "string", "limit": "integer 1..10"},
        },
        "web_fetch": {
            "available": True,
            "provider": "公开网页",
            "arguments": {"url": "absolute http(s) URL"},
        },
        "xhs_search": {
            "available": settings.enable_xhs_mcp,
            "provider": "小红书只读 MCP",
            "arguments": {"query": "string"},
        },
        "xhs_get_note": {
            "available": settings.enable_xhs_mcp,
            "provider": "小红书只读 MCP",
            "arguments": {"url": "URL returned by xhs_search"},
        },
        "place_search": {
            "available": settings.baidu_map_ready,
            "provider": "百度地图",
            "arguments": {"query": "string", "region": "optional city/region", "limit": "integer 1..10"},
        },
        "place_detail": {
            "available": settings.baidu_map_ready,
            "provider": "百度地图",
            "arguments": {"provider_place_id": "Baidu UID returned by place_search"},
        },
        "geocode": {
            "available": settings.baidu_map_ready,
            "provider": "百度地图",
            "arguments": {"address": "string"},
        },
        "route_search": {
            "available": settings.baidu_map_ready,
            "provider": "百度地图",
            "arguments": {
                "origin": "lat,lng or coordinates object",
                "destination": "lat,lng or coordinates object",
                "mode": "walking|driving|transit|riding",
            },
        },
        "weather_search": {
            "available": settings.baidu_map_ready,
            "provider": "百度地图",
            "arguments": {
                "district_id": "optional Baidu adcode",
                "location": "optional lng,lat",
                "city": "city name; Harness geocodes it when adcode/location is absent",
            },
        },
        "rail_search": {
            "available": settings.enable_12306_mcp,
            "provider": "12306 社区 MCP",
            "arguments": {
                "from_station": "Chinese station/city name",
                "to_station": "Chinese station/city name",
                "train_date": "YYYY-MM-DD",
                "limited_num": "optional integer 1..20",
            },
        },
        "trip_read": {"available": True, "provider": "Trip State"},
        "trip_validate": {"available": True, "provider": "确定性校验器"},
    }


def _first_text(arguments: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = arguments.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _field_value(context: dict[str, Any], field: str) -> Any:
    value = context.get("trip_spec", {}).get(field, {})
    return value.get("value") if isinstance(value, dict) else value


def _destination_name(context: dict[str, Any]) -> str | None:
    destination = _field_value(context, "destination")
    if isinstance(destination, dict):
        return _first_text(destination, "name", "city", "district", "formatted_address")
    if destination is None:
        return None
    text = str(destination).strip()
    return text if text and text.lower() != "none" else None


def _source_free_destination_orientation(context: dict[str, Any]) -> str:
    """Give useful orientation without allowing the model to invent live facts."""

    destination = _destination_name(context) or "这个目的地"
    return (
        f"关于{destination}，我先不把尚未核验的细节说成事实。可以先从四类玩法理解它："
        "自然风光、人文历史、城市休闲和美食体验。"
        "当前还没有拿到真实地点、开放时间、路线或天气数据，所以我不会给出具体耗时、气温或营业信息。"
        "你更想先看哪一类，还是我按通常的轻松节奏先整理一个方向？"
    )


def _deterministic_initial_schedule(state: AgentLoopState) -> dict[str, Any]:
    """Build a bounded first schedule after the user confirms real POIs.

    At this point destination, dates, travelers and hard needs have already
    crossed deterministic gates. Letting the model continue researching can
    loop indefinitely even though the only valid next action is a patch. The
    Harness therefore owns the transition from selected POIs to a schedulable
    draft; real route times are still fetched and validated by the planner.
    """

    candidates = list(state.get("selected_candidates") or state.get("candidate_places") or [])
    # Filter out invalid candidates (e.g. adcode-only entries)
    candidates = [
        c for c in candidates
        if c.get("provider_place_id") and not str(c.get("provider_place_id", "")).startswith("adcode:")
    ]
    if not candidates:
        raise RuntimeError("生成首版行程前必须先确认真实地点")
    context = state.get("context", {})
    start_value = _field_value(context, "start_date")
    end_value = _field_value(context, "end_date")
    if not start_value or not end_value:
        duration_value = _field_value(context, "duration_days")
        if not duration_value:
            raise RuntimeError("生成首版行程前必须先确认大致时长")
        start = datetime.now(UTC).date() + timedelta(days=14)
        end = start + timedelta(days=max(1, int(duration_value)) - 1)
    else:
        start = datetime.fromisoformat(str(start_value)).date()
        end = datetime.fromisoformat(str(end_value)).date()
    day_count = max(1, (end - start).days + 1)
    pace = str(_field_value(context, "pace") or "适中")
    start_minutes = 9 * 60 if pace == "轻松" else 8 * 60 + 30
    default_duration = 120 if pace == "轻松" else 105
    day_titles = {str(index): f"第 {index} 天 · 已确认地点" for index in range(1, day_count + 1)}
    items: list[dict[str, Any]] = []
    clocks = [start_minutes for _ in range(day_count)]
    for index, candidate in enumerate(candidates):
        day_index = index % day_count
        category = str(candidate.get("requested_category") or candidate.get("category") or "体验")
        duration = 75 if any(marker in category for marker in ("餐饮", "美食", "咖啡", "茶馆")) else default_duration
        clock = clocks[day_index]
        hour, minute = divmod(clock, 60)
        items.append(
            {
                "provider_place_id": str(candidate["provider_place_id"]),
                "day_index": day_index + 1,
                "start_time": f"{hour:02d}:{minute:02d}",
                "duration_minutes": duration,
                "reason": str(candidate.get("reason") or "这是你确认要排入首版行程的真实地点。"),
                "category": category[:80],
            }
        )
        next_clock = clock + duration + 45
        # 午间保留更完整的用餐和休息窗口。
        if clock < 12 * 60 <= next_clock:
            next_clock += 45
        clocks[day_index] = next_clock
    return {"day_titles": day_titles, "items": items}


def _community_query(state: AgentLoopState, arguments: dict[str, Any]) -> str:
    explicit = _first_text(arguments, "query", "keywords", "keyword", "search_query", "q")
    if explicit:
        return explicit
    context = state.get("context", {})
    destination = _destination_name(context)
    if not destination:
        raise ToolGatewayError("小红书搜索缺少 query，且当前 Trip 还没有明确目的地。")
    parts = [destination]
    travelers = _field_value(context, "travelers")
    requirements = _field_value(context, "traveler_requirements")
    pace = _field_value(context, "pace")
    if travelers:
        parts.append("同行旅行")
    if pace:
        parts.append(str(pace))
    if isinstance(requirements, list):
        parts.extend(str(item) for item in requirements[:2] if item)
    return " ".join(parts)[:160]


def _community_content_requested(message: str) -> bool:
    """Return whether the user explicitly asked for community-style input."""

    normalized = message.casefold()
    markers = (
        "小红书",
        "社区",
        "攻略",
        "笔记",
        "机位",
        "拍照",
        "出片",
        "避坑",
        "踩坑",
        "近期体验",
        "最近体验",
        "网红打卡",
        "xhs",
    )
    return any(marker in normalized for marker in markers)


def _apply_community_tool_policy(state: AgentLoopState, action: AgentAction) -> AgentAction:
    """Keep optional community search behind an explicit user request."""

    if action.type != "call_tools" or _community_content_requested(state["message"]):
        return action
    allowed_calls = [call for call in action.calls if call.tool not in {"xhs_search", "xhs_get_note"}]
    if len(allowed_calls) == len(action.calls):
        return action
    if allowed_calls:
        return action.model_copy(update={"calls": allowed_calls})
    return AgentAction(
        type="respond",
        intent=action.intent,
        public_progress="先回答当前问题，不引入未请求的社区经验。",
        response_outline=(
            "直接回应用户当前问题；只能使用已经存在的真实工具观察和来源。"
            "如果现有证据不足，明确说明尚未核验，不得补造实时事实。"
        ),
    )


def _single_topic_place_terms(state: AgentLoopState) -> list[str]:
    message = state["message"]
    place_terms: list[str] = []
    raw_must_visit = _field_value(state.get("context", {}), "must_visit")
    if isinstance(raw_must_visit, list):
        place_terms.extend(str(item).strip() for item in raw_must_visit if str(item).strip())
    place_patterns = (
        re.compile(r"[\u4e00-\u9fffA-Za-z0-9· .&'’-]{1,30}(?:寺|湖|山|岛|村|公园|景区|博物馆|古镇|塔|园|桥|街|湿地)"),
        re.compile(r"[A-Za-z0-9][A-Za-z0-9 .&'’-]{1,30}(?:Museum|museum|Lake|lake|Mountain|mountain|Park|park|Temple|temple)\b"),
    )
    matches = [match for pattern in place_patterns for match in pattern.findall(message)]
    for match in matches:
        term = re.sub(r"^(?:要是|如果|只想|只逛|只看|安排|游览|去|逛|看|和|及|与)+", "", match)
        term = re.sub(r"^(?:.*?)(?=(?:西湖|灵隐寺|[\u4e00-\u9fffA-Za-z0-9][\u4e00-\u9fffA-Za-z0-9· .&'’-]{1,30}(?:寺|湖|山|岛|村|公园|景区|博物馆|古镇|塔|园|桥|街|湿地)))", "", term)
        term = term.strip(" ，,、和及与")
        if term and term not in place_terms:
            place_terms.append(term)
    return place_terms[:2]


def _single_topic_route_action(state: AgentLoopState) -> AgentAction | None:
    message = state["message"]
    if not any(marker in message for marker in ("一天", "同一天", "太赶", "逛完", "交通", "通勤", "到达")):
        return None
    if any(item.get("tool") == "route_search" and item.get("status") == "success" for item in state.get("observations", [])):
        return None
    terms = _single_topic_place_terms(state)
    selected: list[dict[str, Any]] = []
    for term in terms:
        candidate = next(
            (
                item
                for item in state.get("candidate_places", [])
                if term in str(item.get("name") or "")
                and isinstance(item.get("coordinates"), dict)
            ),
            None,
        )
        if candidate is not None:
            selected.append(candidate)
    if len(selected) < 2:
        return None
    return AgentAction(
        type="call_tools",
        intent=Intent.ASK_TRIP_QUESTION,
        public_progress="地点已经找到，再核对相邻地点的实际路线后给你结论。",
        calls=[
            AgentToolCallRequest(
                tool="route_search",
                arguments={
                    "origin": selected[0]["coordinates"],
                    "destination": selected[1]["coordinates"],
                    "mode": "transit",
                },
                reason="核验单项咨询涉及地点之间的实际交通时间。",
            )
        ],
    )


def _apply_single_topic_policy(state: AgentLoopState, action: AgentAction) -> AgentAction:
    """Keep a single-topic consultation from turning into a planning intake."""

    intent = state.get("context", {}).get("run_intent")
    explicit_single_topic = any(
        marker in state["message"]
        for marker in ("只回答", "只给结论", "不要追问", "不要开始完整规划", "不用规划")
    )
    if intent != Intent.ASK_TRIP_QUESTION.value and not explicit_single_topic:
        return action
    if action.skill is None:
        action = action.model_copy(update={"skill": "ANSWER_TRIP_QUESTION"})
    if action.type == "respond":
        route_action = _single_topic_route_action(state)
        if route_action is not None:
            return route_action
        place_terms = _single_topic_place_terms(state)
        has_tool_observation = any(item.get("tool") for item in state.get("observations", []))
        if place_terms and not has_tool_observation:
            destination = _destination_name(state.get("context", {}))
            return AgentAction(
                type="call_tools",
                intent=Intent.ASK_TRIP_QUESTION,
                public_progress="先核验问题中提到的真实地点，再给出单项判断。",
                calls=[
                    AgentToolCallRequest(
                        tool="place_search",
                        arguments={"query": term, "region": destination or ""},
                        reason="核验用户单项咨询中明确提到的地点。",
                    )
                    for term in place_terms
                ],
            )
        return action
    if action.type != "ask_user":
        return action
    place_terms = _single_topic_place_terms(state)
    destination = _destination_name(state.get("context", {}))
    if place_terms:
        return AgentAction(
            type="call_tools",
            intent=Intent.ASK_TRIP_QUESTION,
            public_progress="先核验问题中提到的真实地点，再给出单项判断。",
            calls=[
                AgentToolCallRequest(
                    tool="place_search",
                    arguments={"query": term, "region": destination or ""},
                    reason="核验用户单项咨询中明确提到的地点。",
                )
                for term in place_terms
            ],
        )
    return AgentAction(
        type="respond",
        intent=Intent.ASK_TRIP_QUESTION,
        public_progress="直接回答当前问题，不把单项咨询扩展成完整规划。",
        response_outline=(
            "只回答用户当前提出的单项问题，不再追问旅行偏好，也不启动完整规划。"
            "当前没有足够的真实工具观察时，只说明尚未核验，不得给出开放时间、票价、路线或其他实时事实。"
        ),
    )


def _enforce_interaction_policy(
    state: AgentLoopState,
    action: AgentAction,
    readiness_payload: dict[str, Any],
    planning_task: bool,
) -> AgentAction:
    """Apply cross-turn product rules after the model has chosen an action."""

    from app.domain.schemas import PlanReadiness

    readiness = PlanReadiness.model_validate(readiness_payload)
    conversation = state.get("context", {}).get("conversation_state") or {}
    question_turns = int(conversation.get("consecutive_question_turns") or 0)
    assumption_permission = bool(conversation.get("assumption_permission"))
    asked_topics = {str(item) for item in conversation.get("asked_topics", [])}
    topic = action.question_topic or (action.component.type if action.component else None)
    draftable = readiness.level in {PlanReadinessLevel.DRAFTABLE, PlanReadinessLevel.EXECUTABLE}

    if action.type != "ask_user":
        return action

    if planning_task and readiness.level == PlanReadinessLevel.ORIENTABLE and assumption_permission:
        return AgentAction(
            type="respond",
            intent=Intent.PLAN_ITINERARY,
            skill="BUILD_DESTINATION_BRIEF",
            public_progress="天数还可以稍后决定，我先把目的地的区域差异和适合的停留范围讲清楚。",
            response_outline=(
                "承接用户暂时不确定天数的表达，先提供目的地整体玩法、区域差异和 3/5/7 天的选择依据。"
                "明确说明暂不把任何天数当成用户已确认事实，最后只邀请用户在准备好时选择大致范围。"
            ),
        )

    if planning_task and draftable and (question_turns >= 2 or assumption_permission or topic in asked_topics):
        candidates = state.get("candidate_places") or []
        if _default_selected_candidates(candidates):
            return AgentAction(
                type="propose_trip_patch",
                intent=Intent.PLAN_ITINERARY,
                skill="DRAFT_ITINERARY",
                public_progress="信息已经足够先做一版，我会把暂未确定的内容标成假设并生成当地行程草案。",
                patch={
                    "kind": "initial_plan",
                    "schedule": _deterministic_initial_schedule(
                        {**state, "selected_candidates": _default_selected_candidates(candidates)}
                    ),
                },
            )
        destination = _destination_name(state.get("context", {})) or "目的地"
        return AgentAction(
            type="call_tools",
            intent=Intent.PLAN_ITINERARY,
            skill="RESEARCH_DESTINATION",
            public_progress=f"先查找{destination}的真实候选地点，再直接组织首版草案。",
            calls=[
                AgentToolCallRequest(
                    tool="place_search",
                    arguments={"query": f"{destination} 必去景点", "region": destination, "limit": 10},
                    reason="已达到首版草案条件，不再追问非阻塞字段，先核验真实地点。",
                )
            ],
        )

    if planning_task and question_turns >= 2:
        labels = "、".join(item.label for item in readiness.draft_blockers) or "必要条件"
        return AgentAction(
            type="respond",
            intent=Intent.PLAN_ITINERARY,
            skill="RESPOND",
            public_progress="我先说明真正阻塞首版规划的条件，不再重复追问可选字段。",
            response_outline=f"说明当前还缺少{labels}，这些条件会阻塞首版草案；不要继续追问预算、节奏或其他非阻塞字段。",
        )
    return action


def _route_point(value: Any) -> str | None:
    latitude: Any = None
    longitude: Any = None
    if isinstance(value, dict):
        nested = value.get("coordinates") if isinstance(value.get("coordinates"), dict) else value
        latitude = nested.get("latitude") if nested.get("latitude") is not None else nested.get("lat")
        longitude = nested.get("longitude") if nested.get("longitude") is not None else nested.get("lng")
    elif isinstance(value, list | tuple) and len(value) == 2:
        # Coordinates arrays from map providers are conventionally [lng, lat].
        longitude, latitude = value
    elif isinstance(value, str) and value.strip():
        parts = [part for part in re.split(r"\s*[,，;；/]\s*|\s+", value.strip()) if part]
        if len(parts) == 2:
            try:
                first, second = (float(part) for part in parts)
            except ValueError:
                return None
            if not all(math.isfinite(item) for item in (first, second)):
                return None
            if abs(first) > 90 >= abs(second):
                # The input is lng,lat; the Baidu route API expects lat,lng.
                latitude, longitude = second, first
            else:
                # Already lat,lng (or an ambiguous pair such as 31,121).
                latitude, longitude = first, second
            return f"{latitude if abs(first) <= 90 else parts[1]},{longitude if abs(first) <= 90 else parts[0]}"
        # Keep a non-coordinate address available for upstream validation; a
        # place name is not silently turned into a fake coordinate.
        return value.strip()
    if latitude is not None and longitude is not None:
        try:
            latitude_float = float(latitude)
            longitude_float = float(longitude)
        except (TypeError, ValueError):
            return None
        if (
            math.isfinite(latitude_float)
            and math.isfinite(longitude_float)
            and -90 <= latitude_float <= 90
            and -180 <= longitude_float <= 180
        ):
            return f"{latitude_float},{longitude_float}"
    return None


def _tool_signature(tool: str, arguments: dict[str, Any]) -> str:
    return f"{tool}:{json.dumps(arguments, ensure_ascii=False, sort_keys=True, default=str)}"


async def _apply_spec_updates(state: AgentLoopState, updates: dict[str, Any]) -> None:
    if not updates:
        return
    trip_id, thread_id, run_id = _ids(state)
    allowed = {
        "destination",
        "origin",
        "start_date",
        "end_date",
        "duration_days",
        "planning_scope",
        "transport_modes",
        "travelers",
        "traveler_requirements",
        "budget",
        "pace",
        "interests",
        "must_visit",
        "avoid",
    }
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        if not trip:
            raise RuntimeError("Trip 不存在")
        spec = TripSpecData.model_validate(trip.trip_spec)
        changed = False
        for field, raw in updates.items():
            if field not in allowed:
                continue
            item = raw if isinstance(raw, dict) and "value" in raw else {"value": raw}
            value = item.get("value")
            evidence = str(item.get("evidence") or "").strip()
            requested_state = str(item.get("state") or "INFERRED").upper()
            evidence_confirmed = bool(evidence and evidence in state["message"])
            field_state = (
                FieldState.CONFIRMED
                if requested_state == FieldState.CONFIRMED.value and evidence_confirmed
                else FieldState.ASSUMED
                if requested_state == FieldState.ASSUMED.value
                else FieldState.INFERRED
            )
            set_spec_value(spec, field, value, field_state, "agent_extraction")
            changed = True
        budget_mode_update = updates.get("budget_mode")
        budget_mode = (
            budget_mode_update.get("value")
            if isinstance(budget_mode_update, dict)
            else budget_mode_update
        )
        if budget_mode in {"hard", "target", "unlimited", "estimate"}:
            spec.budget_mode = budget_mode
            changed = True
        if not changed:
            return
        await save_trip_spec(session, trip, spec)
        await event_broker.publish(
            session,
            "trip.spec.updated",
            {"trip_spec": spec.model_dump(mode="json")},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()


async def bootstrap_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    trip_id, thread_id, run_id = _ids(state)
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        thread = await session.get(ConversationThread, thread_id)
        run = await session.get(AgentRun, run_id)
        if not trip or not thread or not run:
            raise RuntimeError("Trip、对话或 Agent Run 不存在")
        await _set_run(run, RunStatus.RUNNING, "bootstrap")
        plan = await get_current_plan(session, trip)
        recent = list(
            reversed(
                (
                    await session.scalars(
                        select(Message)
                        .where(Message.thread_id == thread_id)
                        .order_by(Message.created_at.desc())
                        .limit(16)
                    )
                ).all()
            )
        )
        source_rows = (
            await session.scalars(
                select(SourceRecord)
                .where(SourceRecord.run_id == run_id)
                .order_by(SourceRecord.retrieved_at.asc())
            )
        ).all()
        spec = TripSpecData.model_validate(trip.trip_spec)
        conversation_state = await _ensure_conversation_state(session, thread_id)
        readiness = derive_plan_readiness(spec)
        conversation_state.readiness = readiness.model_dump(mode="json")
        if trip.current_version > 0:
            conversation_state.stage = ConversationStage.PLAN_ACTIVE.value
        elif trip.lifecycle == TripLifecycle.REVIEWING.value:
            conversation_state.stage = ConversationStage.DRAFT_REVIEW.value
        context = {
            "current_request": state["message"],
            "trip_id": str(trip.id),
            "trip_version": trip.current_version,
            "trip_lifecycle": trip.lifecycle,
            "run_intent": run.intent,
            "trip_spec": spec.model_dump(mode="json"),
            "planning_gaps": _planning_gaps(spec),
            "plan_readiness": readiness.model_dump(mode="json"),
            "conversation_state": _conversation_state_payload(conversation_state),
            "current_plan": plan.model_dump(mode="json") if plan else None,
            "thread_summary": thread.summary,
            "recent_messages": [
                {"role": item.role, "content": item.content}
                for item in recent
            ],
            "working_plan": state.get("working_plan", {}),
            "observations": state.get("observations", [])[-12:],
            "verified_place_candidates": state.get("candidate_places", [])[-30:],
            "selected_place_candidates": state.get("selected_candidates", []),
            "sources": [source_data(item).model_dump(mode="json") for item in source_rows],
            "tool_availability": _tool_availability(),
            "limits": {
                "remaining_iterations": max(0, get_settings().max_agent_iterations - state.get("iteration", 0)),
                "max_parallel_read_tools": 3,
            },
        }
        if not state.get("iteration"):
            await event_broker.publish(
                session,
                "progress.started",
                {
                    "step_id": "understand-request",
                    "title": "正在理解这次旅行",
                    "summary": "我会先结合当前旅程和这条消息，判断最值得先确认或核验的事情。",
                },
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
        await session.commit()
    return {"context": context}


async def classify_and_extract_node(state: AgentLoopState) -> AgentLoopState:
    """Classify the turn and apply only a conservative profile delta.

    This node deliberately has no plan-producing branch. It gives the policy
    layer a stable intent before the general model chooses the next action.
    """
    await _assert_run_active(state)
    if state.get("classified"):
        return {}
    context = state["context"]
    extracted_call = await llm_client.extract_request(state["message"], context.get("trip_spec"))
    extracted = extracted_call.value
    updates: dict[str, Any] = {}
    field_map = {
        "destination": extracted.destination,
        "origin": extracted.origin,
        "start_date": extracted.start_date,
        "end_date": extracted.end_date,
        "duration_days": extracted.duration_days,
        "planning_scope": extracted.planning_scope,
        "transport_modes": extracted.transport_modes,
        "travelers": extracted.travelers,
        "traveler_requirements": extracted.traveler_requirements,
        "budget": extracted.budget_cny,
        "pace": extracted.pace,
        "interests": extracted.interests,
        "must_visit": extracted.must_visit,
        "avoid": extracted.avoid,
    }
    for field, value in field_map.items():
        if value is None or value == []:
            continue
        explicit_destination = field == "destination" and str(value).strip() in state["message"]
        updates[field] = {
            "value": value,
            "state": FieldState.CONFIRMED.value if explicit_destination else FieldState.INFERRED.value,
            "evidence": str(value) if explicit_destination else "",
        }
    await _apply_spec_updates(state, updates)
    trip_id, thread_id, run_id = _ids(state)
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        run = await session.get(AgentRun, run_id)
        if not trip or not run:
            raise RuntimeError("Trip 或 Agent Run 不存在")
        conversation_state = await _ensure_conversation_state(session, thread_id)
        if assumption_permission_revoked_by_message(state["message"]):
            conversation_state.assumption_permission = False
        elif assumption_permission_from_message(state["message"]):
            conversation_state.assumption_permission = True
        if (
            conversation_state.assumption_permission
            and extracted.intent in {Intent.PLAN_ITINERARY, Intent.CREATE_TRIP}
        ):
            conversation_state.planning_consent = PlanningConsent.DIRECTION_CONFIRMED.value
        initial_briefing = (
            trip.current_version == 0
            and trip.lifecycle in {TripLifecycle.DRAFT.value, TripLifecycle.CLARIFYING.value}
            and extracted.intent
            in {
                Intent.CREATE_TRIP,
                Intent.PLAN_ITINERARY,
                Intent.SEARCH_PLACE,
                Intent.UPDATE_TRIP_SPEC,
            }
        )
        spec = TripSpecData.model_validate(trip.trip_spec)
        readiness = derive_plan_readiness(spec)
        previous_stage = conversation_state.stage
        if initial_briefing:
            next_stage = ConversationStage.BRIEFING.value
        elif previous_stage == ConversationStage.BRIEFING.value and readiness.level in {
            PlanReadinessLevel.DRAFTABLE,
            PlanReadinessLevel.EXECUTABLE,
        }:
            next_stage = ConversationStage.DIRECTION_REVIEW.value
        else:
            next_stage = stage_for(spec).value
        conversation_state.stage = next_stage
        conversation_state.readiness = readiness.model_dump(mode="json")
        conversation_state.classification_done = True
        source_user_message_id = await session.scalar(
            select(Message.id)
            .where(Message.run_id == run_id, Message.role == "user")
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        conversation_state.source_user_message_id = source_user_message_id
        if initial_briefing and trip.current_version == 0 and trip.lifecycle == TripLifecycle.DRAFT.value:
            trip.lifecycle = TripLifecycle.CLARIFYING.value
        if next_stage != previous_stage:
            await event_broker.publish(
                session,
                "conversation.stage.changed",
                {"stage": next_stage, "previous_stage": previous_stage},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
        run.intent = extracted.intent.value
        run.current_step = "classified"
        await event_broker.publish(
            session,
            "intent.classified",
            {
                "intent": extracted.intent.value,
                "confidence": extracted.confidence,
                "requires_tools": extracted.requires_tools,
                "requires_confirmation": extracted.requires_confirmation,
            },
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    refreshed_context = dict(context)
    refreshed_context["run_intent"] = extracted.intent.value
    # Use the actual persisted lifecycle instead of blindly overwriting.
    # The previous code forced CLARIFYING for version 0, which broke
    # trips that had already advanced to REVIEWING or PLANNING.
    refreshed_context["trip_lifecycle"] = trip.lifecycle
    refreshed_context["trip_spec"] = spec.model_dump(mode="json")
    refreshed_context["planning_gaps"] = _planning_gaps(spec)
    refreshed_context["plan_readiness"] = readiness.model_dump(mode="json")
    refreshed_context["conversation_state"] = _conversation_state_payload(conversation_state)
    return {
        "classified": True,
        "briefing_required": initial_briefing,
        "source_user_message_id": str(source_user_message_id) if source_user_message_id else "",
        "plan_readiness": readiness.model_dump(mode="json"),
        "context": refreshed_context,
    }


async def model_decide_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    iteration = state.get("iteration", 0) + 1
    context = state["context"]
    planning_task = context.get("current_plan") is None and context.get("run_intent") in {
        Intent.CREATE_TRIP.value,
        Intent.PLAN_ITINERARY.value,
        Intent.UPDATE_TRIP_SPEC.value,
        Intent.ANSWER_CLARIFICATION.value,
    }
    readiness_payload = context.get("plan_readiness") or _readiness_payload(
        TripSpecData.model_validate(context.get("trip_spec") or {})
    )
    readiness = PlanReadiness.model_validate(readiness_payload)
    planning_gaps = list(context.get("planning_gaps") or [])
    if state.get("briefing_required") and iteration == 1:
        candidates = state.get("candidate_places") or []
        brief_answer = (
            (await llm_client.destination_brief(context.get("trip_spec") or {}, candidates)).value.answer
            if candidates
            else _source_free_destination_orientation(context)
        )
        await _persist_artifact(
            state,
            artifact_type="destination_brief",
            payload={"answer": brief_answer, "trip_spec": context.get("trip_spec") or {}},
            assumptions=list(readiness.assumptions_available.values()),
        )
        action_call = None
        action = AgentAction(
            type="respond",
            intent=Intent(str(context.get("run_intent") or Intent.CREATE_TRIP.value)),
            skill="BUILD_DESTINATION_BRIEF",
            public_progress="先把目的地的整体印象和玩法方向讲清楚，再一起决定下一步。",
            response_outline=brief_answer,
        )
    elif planning_task and readiness.draft_blockers:
        action_call = await llm_client.decide_next_action(context)
        action = action_call.value
        if action.type not in {"ask_user", "call_tools"}:
            component = _planning_gap_component(state, planning_gaps[0])
            if component is not None:
                action_call = None
                action = AgentAction(
                    type="ask_user",
                    intent=Intent.PLAN_ITINERARY,
                    skill="ASK_DECISION",
                    question_topic=normalize_topic(component.type, "ask_user"),
                    public_progress=f"开始排程前，先确认{planning_gaps[0]}，避免在错误前提上生成行程。",
                    component=component,
                )
    elif planning_task and state.get("candidate_places") and not state.get("selected_candidates"):
        if readiness.level in {PlanReadinessLevel.DRAFTABLE, PlanReadinessLevel.EXECUTABLE}:
            selected = _default_selected_candidates(state.get("candidate_places") or [])
            if selected:
                state = {**state, "selected_candidates": selected}
                action_call = None
                action = AgentAction(
                    type="propose_trip_patch",
                    intent=Intent.PLAN_ITINERARY,
                    skill="DRAFT_ITINERARY",
                    public_progress="真实地点已经核验完成，我会先自动组合一版草案；你可以在预览里增删地点。",
                    patch={"kind": "initial_plan", "schedule": _deterministic_initial_schedule({**state, "selected_candidates": selected})},
                )
            else:
                action_call = await llm_client.decide_next_action(context)
                action = action_call.value
        else:
            action_call = None
            action = AgentAction(
                type="ask_user",
                intent=Intent.PLAN_ITINERARY,
                skill="ASK_DECISION",
                question_topic="place_candidates",
                public_progress="真实地点已经核验完成，请选择希望排入首版日程的地点。",
                component=_place_candidates_component(state),
            )
    elif planning_task and state.get("selected_candidates"):
        action_call = None
        action = AgentAction(
            type="propose_trip_patch",
            intent=Intent.PLAN_ITINERARY,
            skill="DRAFT_ITINERARY",
            public_progress="已使用真实地点生成首版排程，正在补全逐段路线并做确定性校验。",
            patch={"kind": "initial_plan", "schedule": _deterministic_initial_schedule(state)},
        )
    else:
        decision_context = dict(context)
        action_call = await llm_client.decide_next_action(decision_context)
        action = action_call.value

    action = _apply_community_tool_policy(state, action)
    action = _apply_single_topic_policy(state, action)
    if action.type == "respond" and context.get("run_intent") == Intent.ASK_TRIP_QUESTION.value:
        try:
            answer_call = await llm_client.answer_trip_question(
                state["message"],
                context.get("trip_spec") or {},
                context.get("current_plan"),
            )
            action = action.model_copy(
                update={
                    "skill": "ANSWER_TRIP_QUESTION",
                    "response_outline": answer_call.value.answer,
                }
            )
        except Exception:
            # The general response writer remains the safe fallback if the
            # specialized answer call is unavailable.
            pass
    action = _enforce_interaction_policy(state, action, readiness_payload, planning_task)
    if action.type == "propose_trip_patch" and action.patch.get("kind") == "initial_plan":
        await _persist_draft_assumptions(state, readiness_payload)

    effective_max = get_settings().max_agent_iterations + (4 if planning_task else 0)
    if iteration > effective_max:
        return {
            "iteration": iteration,
            "action": AgentAction(
                type="respond",
                public_progress="本轮没有在安全步数内形成可执行计划，我会明确说明阻断项。",
                response_outline="明确说明尚未创建首版计划，不得宣称行程已经完成；列出真实阻断项和下一步。",
            ).model_dump(mode="json"),
        }
    await _apply_spec_updates(state, action.trip_spec_updates)
    trip_id, thread_id, run_id = _ids(state)
    refreshed_context = dict(state["context"])
    if action.trip_spec_updates:
        async with SessionFactory() as session:
            refreshed_trip = await session.get(Trip, trip_id)
            if refreshed_trip:
                refreshed_spec = TripSpecData.model_validate(refreshed_trip.trip_spec)
                refreshed_context["trip_spec"] = refreshed_spec.model_dump(mode="json")
                refreshed_context["planning_gaps"] = _planning_gaps(refreshed_spec)
                readiness_payload = _readiness_payload(refreshed_spec)
                refreshed_context["plan_readiness"] = readiness_payload
    title_by_action = {
        "ask_user": "需要你确认",
        "call_tools": "正在查找真实信息",
        "update_working_plan": "正在整理下一步",
        "propose_trip_patch": "正在准备可检查的方案",
        "respond": "正在整理回答",
        "finish": "本轮工作已完成",
    }
    async with SessionFactory() as session:
        run = await session.get(AgentRun, run_id)
        conversation_state = await _ensure_conversation_state(session, thread_id)
        if run:
            run.intent = action.intent.value if action.intent else run.intent
            run.current_step = f"decide:{action.type}"
        topic = action.question_topic or (action.component.type if action.component else None)
        if action.type == "ask_user":
            conversation_state.consecutive_question_turns += 1
            conversation_state.pending_decision_topic = topic
            if topic and topic not in (conversation_state.asked_topics or []):
                conversation_state.asked_topics = [*(conversation_state.asked_topics or []), topic][-12:]
        elif action.type in {"respond", "propose_trip_patch"}:
            conversation_state.consecutive_question_turns = 0
            conversation_state.last_value_delivery_turn = iteration
            conversation_state.pending_decision_topic = None
        conversation_state.readiness = readiness_payload
        if action.type == "propose_trip_patch":
            conversation_state.stage = ConversationStage.DRAFT_REVIEW.value
        if iteration == 1:
            await event_broker.publish(
                session,
                "progress.completed",
                {
                    "step_id": "understand-request",
                    "title": "已经理解当前需求",
                    "summary": "我已结合当前 Trip State 判断出这一轮最值得先处理的事情。",
                },
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
        await event_broker.publish(
            session,
            "progress.started",
            {
                "step_id": f"decision-{iteration}",
                "title": title_by_action[action.type],
                "summary": action.public_progress,
                "iteration": iteration,
            },
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    if action.type == "update_working_plan":
        await _complete_public_progress(state | {"iteration": iteration}, "下一步已经整理好", action.public_progress)
    result: AgentLoopState = {
        "iteration": iteration,
        "action": action.model_dump(mode="json"),
        "citation_ids": [str(item) for item in action.citation_ids],
        "context": refreshed_context,
        "plan_readiness": readiness_payload,
    }
    if state.get("selected_candidates"):
        result["selected_candidates"] = state["selected_candidates"]
    if action.working_plan:
        result["working_plan"] = action.working_plan
    if action.response_outline:
        result["response_outline"] = action.response_outline
    return result


def route_action(
    state: AgentLoopState,
) -> Literal["execute_tools", "wait_user", "validate_patch", "stream_response", "bootstrap", "finish"]:
    action_type = AgentAction.model_validate(state["action"]).type
    return {
        "call_tools": "execute_tools",
        "ask_user": "wait_user",
        "propose_trip_patch": "validate_patch",
        "respond": "stream_response",
        "finish": "finish",
        "update_working_plan": "bootstrap",
    }[action_type]


def route_bootstrap(state: AgentLoopState) -> Literal["classify_and_extract", "model_decide"]:
    """Only classify a new user turn; tool and component resumes keep intent stable."""

    return "model_decide" if state.get("classified") else "classify_and_extract"


def _component_defaults(component: AgentComponentRequest, state: AgentLoopState) -> dict[str, Any]:
    props = dict(component.props)
    props.setdefault("title", component.title)
    if component.type == "date_range_picker":
        props.setdefault("allow_flexible", False)
        props.setdefault("allow_unknown", False)
    elif component.type == "traveler_selector":
        props.setdefault(
            "options",
            [
                {"id": "solo", "label": "独自旅行", "travelers": [{"name": "我", "relation": "自己", "mobility": "normal"}]},
                {"id": "partner", "label": "伴侣", "travelers": [{"name": "我", "relation": "自己", "mobility": "normal"}, {"name": "同行人", "relation": "伴侣", "mobility": "normal"}]},
                {"id": "parents", "label": "父母或长辈", "travelers": [{"name": "我", "relation": "自己", "mobility": "normal"}, {"name": "同行长辈", "relation": "父母", "mobility": "limited"}]},
                {"id": "friends", "label": "朋友", "travelers": [{"name": "我", "relation": "自己", "mobility": "normal"}, {"name": "同行人", "relation": "朋友", "mobility": "normal"}]},
                {"id": "family", "label": "亲子或家庭", "travelers": [{"name": "我", "relation": "自己", "mobility": "normal"}, {"name": "儿童", "relation": "孩子", "mobility": "limited"}]},
            ],
        )
    elif component.type == "traveler_needs_selector":
        props.setdefault("options", ["减少长距离步行", "避免连续活动过久", "需要午休", "儿童友好", "轮椅或无障碍", "饮食限制", "不早起"])
        props.setdefault("allow_none", True)
        props.setdefault("allow_custom", True)
    elif component.type == "budget_selector":
        props.setdefault(
            "options",
            [
                {"id": "estimate", "label": "先做估算", "budget_mode": "estimate"},
                {"id": "unlimited", "label": "暂不限制", "budget_mode": "unlimited"},
                {"id": "target", "label": "目标预算", "budget_mode": "target", "needs_amount": True},
                {"id": "hard", "label": "硬上限", "budget_mode": "hard", "needs_amount": True},
            ],
        )
    elif component.type == "pace_interest_selector":
        props.setdefault("paces", ["轻松", "适中", "紧凑"])
        props.setdefault("interests", ["自然风景", "人文历史", "当地美食", "拍照", "亲子", "购物"])
    elif component.type == "place_candidates":
        options = []
        for candidate in state.get("candidate_places", []):
            place_id = str(candidate.get("provider_place_id") or "")
            if not place_id:
                continue
            if place_id.startswith("adcode:") or not _is_schedulable_candidate(candidate):
                continue
            options.append(
                {
                    **candidate,
                    "id": place_id,
                    "label": candidate.get("name"),
                    "detail": " · ".join(
                        str(value)
                        for value in (candidate.get("district") or candidate.get("city"), candidate.get("category"), candidate.get("address"))
                        if value
                    ),
                }
            )
            if len(options) >= 12:
                break
        props["options"] = options
        props.setdefault("selection_mode", "multiple")
        props.setdefault("required_ids", [])
    elif component.type == "destination_disambiguation" and not props.get("options"):
        props["options"] = [
            item
            for item in state.get("candidate_places", [])
            if item.get("provider_place_id") and item.get("name")
        ]
    return props


async def _interactive_component(
    state: AgentLoopState,
    component: AgentComponentRequest,
) -> dict[str, Any]:
    trip_id, thread_id, run_id = _ids(state)
    props = _component_defaults(component, state)
    async with SessionFactory() as session:
        run = await session.scalar(select(AgentRun).where(AgentRun.id == run_id).with_for_update())
        trip = await session.get(Trip, trip_id)
        if not run or not trip:
            raise RuntimeError("Agent Run 或 Trip 不存在")
        row = await session.scalar(
            select(UIComponent)
            .where(UIComponent.run_id == run_id, UIComponent.type == component.type)
            .with_for_update()
        )
        if row and row.state == ComponentState.APPLIED.value:
            return dict(row.value or {})
        if row and row.state in {
            ComponentState.SUPERSEDED.value,
            ComponentState.EXPIRED.value,
            ComponentState.CANCELLED.value,
            ComponentState.FAILED.value,
        }:
            raise RuntimeError("该交互已经失效，请重新发送当前需求")
        if not row:
            row = UIComponent(
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                type=component.type,
                state=ComponentState.PRESENTED.value,
                props=props,
                base_version=trip.current_version,
            )
            session.add(row)
            await session.flush()
            session.add(
                Message(
                    thread_id=thread_id,
                    run_id=run_id,
                    role="assistant",
                    content=component.prompt,
                    meta={"kind": "component_prompt", "component_type": component.type},
                )
            )
            await event_broker.publish(
                session,
                "component.created",
                {
                    "component": {
                        "id": str(row.id),
                        "type": row.type,
                        "state": row.state,
                        "props": row.props,
                        "base_version": row.base_version,
                    }
                },
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await event_broker.publish(
                session,
                "question.created",
                {"component_id": str(row.id), "type": row.type, "prompt": component.prompt},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
        await _set_run(run, RunStatus.WAITING_USER, f"waiting:{component.type}")
        await event_broker.publish(
            session,
            "run.waiting_user",
            {"component_id": str(row.id), "component_type": row.type},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
        component_id = row.id
        base_version = row.base_version
    answer = interrupt(
        {"component_id": str(component_id), "type": component.type, "props": props, "base_version": base_version}
    )
    async with SessionFactory() as session:
        row = await session.get(UIComponent, component_id)
        run = await session.get(AgentRun, run_id)
        if row:
            row.value = answer
            row.state = ComponentState.APPLIED.value
            await event_broker.publish(
                session,
                "component.updated",
                {"component_id": str(component_id), "state": ComponentState.APPLIED.value},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
        if run:
            await _set_run(run, RunStatus.RUNNING, f"resumed:{component.type}")
        await event_broker.publish(
            session,
            "question.answered",
            {"component_id": str(component_id), "type": component.type},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    return dict(answer)


async def _apply_component_answer(
    state: AgentLoopState,
    component: AgentComponentRequest,
    answer: dict[str, Any],
) -> list[dict[str, Any]]:
    trip_id, _, _ = _ids(state)
    observations = list(state.get("observations", []))
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        if not trip:
            raise RuntimeError("Trip 不存在")
        spec = TripSpecData.model_validate(trip.trip_spec)
        if component.type == "destination_disambiguation":
            selected = answer.get("option") or answer
            state_value = FieldState.CONFIRMED if isinstance(selected, dict) and selected.get("coordinates") else FieldState.INFERRED
            set_spec_value(spec, "destination", selected, state_value, "component")
        elif component.type == "date_range_picker":
            set_spec_value(spec, "start_date", answer.get("start_date"), FieldState.CONFIRMED, "component")
            set_spec_value(spec, "end_date", answer.get("end_date"), FieldState.CONFIRMED, "component")
        elif component.type == "quick_choice":
            selected = answer.get("option") or answer
            if isinstance(selected, dict):
                for field, value in (selected.get("updates") or {}).items():
                    if hasattr(spec, field) and field != "budget_mode":
                        selected_value = value.get("value") if isinstance(value, dict) and "value" in value else value
                        set_spec_value(spec, field, selected_value, FieldState.CONFIRMED, "component")
        elif component.type == "origin_transport_selector":
            scope = answer.get("planning_scope") or "local_only"
            set_spec_value(spec, "planning_scope", scope, FieldState.CONFIRMED, "component")
            set_spec_value(spec, "transport_modes", answer.get("transport_modes") or (["local"] if scope == "local_only" else []), FieldState.CONFIRMED, "component")
            if answer.get("origin"):
                set_spec_value(spec, "origin", answer["origin"], FieldState.CONFIRMED, "component")
        elif component.type == "traveler_selector":
            set_spec_value(spec, "travelers", answer.get("travelers", []), FieldState.CONFIRMED, "component")
        elif component.type == "traveler_needs_selector":
            set_spec_value(spec, "traveler_requirements", answer.get("requirements", []), FieldState.CONFIRMED, "component")
        elif component.type == "budget_selector":
            spec.budget_mode = answer.get("budget_mode", "estimate")
            set_spec_value(spec, "budget", answer.get("budget"), FieldState.CONFIRMED, "component")
        elif component.type == "pace_interest_selector":
            set_spec_value(spec, "pace", answer.get("pace", "适中"), FieldState.CONFIRMED, "component")
            set_spec_value(spec, "interests", answer.get("interests", []), FieldState.CONFIRMED, "component")
        elif component.type == "trip_priorities_selector":
            set_spec_value(spec, "must_visit", answer.get("must_visit", []), FieldState.CONFIRMED, "component")
            set_spec_value(spec, "avoid", answer.get("avoid", []), FieldState.CONFIRMED, "component")
        elif component.type == "decision_options":
            selected = answer.get("option") or answer
            if isinstance(selected, dict):
                for field, value in (selected.get("updates") or {}).items():
                    if hasattr(spec, field) and field != "budget_mode":
                        selected_value = value.get("value") if isinstance(value, dict) and "value" in value else value
                        if field == "planning_scope" and selected_value not in {"local_only", "door_to_door"}:
                            continue
                        set_spec_value(spec, field, selected_value, FieldState.CONFIRMED, "component")
        elif component.type == "rail_options":
            selected = answer.get("option") or answer
            if isinstance(selected, dict):
                train_code = str(selected.get("train_code") or selected.get("start_train_code") or selected.get("id") or "").strip()
                from_station = str(selected.get("departure_station") or selected.get("from_station") or "").strip() or None
                to_station = str(selected.get("arrival_station") or selected.get("to_station") or "").strip() or None
                train_date = spec.start_date.value
                start_at = None
                end_at = None
                if train_date and selected.get("departure_time"):
                    start_at = datetime.fromisoformat(f"{train_date}T{selected['departure_time']}:00+08:00")
                    if selected.get("arrival_time"):
                        end_at = datetime.fromisoformat(f"{train_date}T{selected['arrival_time']}:00+08:00")
                        if end_at < start_at:
                            end_at += timedelta(days=1)
                ticket = TicketCommitment(
                    kind="rail",
                    title=f"{train_code} {from_station or ''}→{to_station or ''}".strip(),
                    start_at=start_at,
                    end_at=end_at,
                    train_code=train_code or None,
                    from_station=from_station,
                    to_station=to_station,
                    train_date=train_date,
                    source="community-12306",
                )
                existing = {(item.train_code, item.from_station, item.to_station) for item in spec.tickets}
                if (ticket.train_code, ticket.from_station, ticket.to_station) not in existing:
                    spec.tickets = [*spec.tickets, ticket]
        await save_trip_spec(session, trip, spec)
    observations.append({"type": "user_answer", "component": component.type, "value": _compact(answer, max_chars=5000)})
    return observations


async def wait_user_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    action = AgentAction.model_validate(state["action"])
    if not action.component:
        raise RuntimeError("ask_user 缺少组件")
    await _complete_public_progress(state, "需要确认的问题已准备好", action.public_progress)
    answer = await _interactive_component(state, action.component)
    observations = await _apply_component_answer(state, action.component, answer)
    result: AgentLoopState = {"observations": observations}
    if action.component.type == "place_candidates":
        selected_ids = {str(item) for item in answer.get("selected_ids", [])}
        result["selected_candidates"] = [
            item
            for item in state.get("candidate_places", [])
            if str(item.get("provider_place_id")) in selected_ids
        ]
    return result


async def _execute_one_tool(state: AgentLoopState, call) -> dict[str, Any]:
    await _assert_run_active(state)
    trip_id, thread_id, run_id = _ids(state)
    arguments = dict(call.arguments)
    provider_emits_events = False
    try:
        async with SessionFactory() as session:
            if call.tool == "web_search":
                provider_emits_events = True
                result = await web_tool_gateway.search(
                    session,
                    run_id=run_id,
                    trip_id=trip_id,
                    thread_id=thread_id,
                    query=str(arguments.get("query") or ""),
                    limit=int(arguments.get("limit") or 8),
                )
            elif call.tool == "web_fetch":
                provider_emits_events = True
                result = await web_tool_gateway.fetch(
                    session,
                    run_id=run_id,
                    trip_id=trip_id,
                    thread_id=thread_id,
                    url=str(arguments.get("url") or ""),
                )
            elif call.tool in {"xhs_search", "xhs_get_note"}:
                name = "xhs_search_notes" if call.tool == "xhs_search" else "xhs_get_note_content"
                normalized_arguments = (
                    {"keywords": _community_query(state, arguments)}
                    if call.tool == "xhs_search"
                    else {"url": _first_text(arguments, "url", "note_url", "link")}
                )
                if call.tool == "xhs_get_note" and not normalized_arguments["url"]:
                    raise ToolGatewayError("读取小红书笔记缺少搜索结果中的真实 URL。")
                arguments = normalized_arguments
                provider_emits_events = True
                result = await tool_gateway.call_xhs(session, run_id, trip_id, thread_id, name, normalized_arguments)
            elif call.tool in {"place_search", "place_detail", "geocode", "route_search", "weather_search"}:
                name = {
                    "place_search": "map_search_places",
                    "place_detail": "map_place_details",
                    "geocode": "map_geocode",
                    "route_search": "map_directions",
                    "weather_search": "map_weather",
                }[call.tool]
                if call.tool == "place_search":
                    dest_field = state["context"].get("trip_spec", {}).get("destination", {})
                    dest_value = dest_field.get("value") if isinstance(dest_field, dict) else None
                    if isinstance(dest_value, dict):
                        region = dest_value.get("name") or dest_value.get("city") or ""
                    elif dest_value:
                        region = str(dest_value)
                    else:
                        region = ""
                    query = _first_text(arguments, "query", "keyword", "keywords", "name")
                    if not query:
                        raise ToolGatewayError("地点搜索缺少 query。")
                    normalized_region = _first_text(arguments, "region") or region
                    if not normalized_region:
                        raise ToolGatewayError("地点搜索需要明确目的地或区域，避免把同名地点搜错城市。")
                    arguments = {
                        "query": query,
                        "region": normalized_region,
                        "limit": min(int(arguments.get("limit") or 8), 10),
                    }
                elif call.tool == "geocode":
                    address = _first_text(arguments, "address", "query", "city", "name")
                    if not address:
                        raise ToolGatewayError("地理编码缺少 address。")
                    arguments = {"address": address}
                elif call.tool == "place_detail":
                    uid = _first_text(arguments, "provider_place_id", "uid", "place_id")
                    if not uid:
                        raise ToolGatewayError("地点详情缺少 place_search 返回的 provider_place_id。")
                    arguments = {"uid": uid}
                elif call.tool == "route_search":
                    origin = _route_point(arguments.get("origin") or arguments.get("from"))
                    destination = _route_point(arguments.get("destination") or arguments.get("to"))
                    if not origin or not destination:
                        raise ToolGatewayError("路线查询需要 origin 和 destination 的真实坐标。")
                    mode = str(arguments.get("mode") or "driving").lower()
                    if mode not in {"walking", "driving", "transit", "riding"}:
                        raise ToolGatewayError("路线 mode 只能是 walking、driving、transit 或 riding。")
                    arguments = {"origin": origin, "destination": destination, "mode": mode}
                elif call.tool == "weather_search":
                    district_id = _first_text(arguments, "district_id", "adcode")
                    location = _first_text(arguments, "location", "coordinates")
                    if not district_id and not location:
                        city = _first_text(arguments, "city", "address", "query", "destination") or _destination_name(
                            state.get("context", {})
                        )
                        if not city:
                            raise ToolGatewayError("天气查询缺少 district_id、location 或可解析的 city。")
                        geocoded = await tool_gateway.call_baidu_map(
                            session,
                            run_id,
                            trip_id,
                            thread_id,
                            "map_geocode",
                            {"address": city},
                        )
                        rows = geocoded.data if isinstance(geocoded.data, list) else []
                        place = next((item for item in rows if isinstance(item, dict)), None)
                        if place and place.get("adcode"):
                            district_id = str(place["adcode"])
                        elif place and isinstance(place.get("coordinates"), dict):
                            point = place["coordinates"]
                            location = f"{point.get('longitude')},{point.get('latitude')}"
                        else:
                            raise ToolGatewayError(f"百度地图无法把“{city}”解析为天气查询区域。")
                    arguments = {"district_id": district_id} if district_id else {"location": location}
                provider_emits_events = True
                result = await tool_gateway.call_baidu_map(session, run_id, trip_id, thread_id, name, arguments)
            elif call.tool == "rail_search":
                origin = _first_text(arguments, "from_station", "origin", "from", "departure")
                destination = _first_text(arguments, "to_station", "destination", "to", "arrival")
                train_date = _first_text(arguments, "train_date", "date", "departure_date")
                if not origin or not destination or not train_date:
                    raise ToolGatewayError("车次查询需要 from_station、to_station 和 train_date。")
                arguments = {
                    "from_station": origin,
                    "to_station": destination,
                    "train_date": train_date,
                    "train_filter_flags": str(arguments.get("train_filter_flags") or ""),
                    "earliest_start_time": max(0, min(int(arguments.get("earliest_start_time") or 0), 23)),
                    "latest_start_time": max(1, min(int(arguments.get("latest_start_time") or 24), 24)),
                    "limited_num": max(1, min(int(arguments.get("limited_num") or arguments.get("limit") or 12), 20)),
                }
                provider_emits_events = True
                result = await tool_gateway.call_rail(
                    session,
                    run_id,
                    trip_id,
                    thread_id,
                    "query-tickets",
                    arguments,
                )
            elif call.tool == "trip_read":
                return {"tool": call.tool, "status": "success", "data": state["context"].get("trip_spec")}
            elif call.tool == "trip_validate":
                trip = await session.get(Trip, trip_id)
                if not trip:
                    raise RuntimeError("Trip 不存在")
                spec = TripSpecData.model_validate(trip.trip_spec)
                plan = await get_current_plan(session, trip)
                validated = validate_plan(plan, spec).model_dump(mode="json") if plan else None
                return {"tool": call.tool, "status": "success", "data": {"planning_gaps": _planning_gaps(spec), "plan": validated}}
            else:
                raise ToolGatewayError(f"不允许调用工具 {call.tool}")
        await _assert_run_active(state)
        return {
            "tool": call.tool,
            "status": "success",
            "arguments": arguments,
            "tool_call_id": str(result.tool_call_id) if result.tool_call_id else None,
            "provider": result.provider,
            "data": _compact(result.data),
        }
    except RunCancelledError:
        raise
    except Exception as exc:
        if not provider_emits_events:
            display_name = {
                "web_search": "web_search",
                "web_fetch": "web_fetch",
                "xhs_search": "xhs_search_notes",
                "xhs_get_note": "xhs_get_note_content",
                "place_search": "map_search_places",
                "place_detail": "map_place_details",
                "geocode": "map_geocode",
                "route_search": "map_directions",
                "weather_search": "map_weather",
                "rail_search": "query-tickets",
            }.get(call.tool, call.tool)
            provider = {
                "xhs_search": "xiaohongshu",
                "xhs_get_note": "xiaohongshu",
                "place_search": "baidu-map",
                "place_detail": "baidu-map",
                "geocode": "baidu-map",
                "route_search": "baidu-map",
                "weather_search": "baidu-map",
                "rail_search": "community-12306",
            }.get(call.tool, "SuperTravel Harness")
            async with SessionFactory() as session:
                await event_broker.publish(
                    session,
                    "tool.failed",
                    {
                        "tool_call_id": f"harness-{state.get('iteration', 0)}-{call.tool}",
                        "name": display_name,
                        "provider": provider,
                        "error": str(exc)[:600],
                    },
                    trip_id=trip_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    commit=True,
                )
        return {"tool": call.tool, "status": "error", "arguments": arguments, "error": str(exc)[:1200]}


async def execute_tools_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    action = AgentAction.model_validate(state["action"])

    previous_by_signature = {
        _tool_signature(str(item.get("tool") or ""), item.get("arguments") or {}): item
        for item in state.get("observations", [])
        if item.get("tool") and item.get("arguments") is not None
    }

    async def execute_bounded(call):
        signature = _tool_signature(call.tool, call.arguments)
        previous = previous_by_signature.get(signature)
        if previous is not None:
            # A repeated model decision must not repeat a weather/geocode or
            # provider request. Reusing the prior observation also gives the
            # model the real result so it can move to the next action.
            return {**previous, "reused": True}
        provider = _tool_provider(call.tool)
        # Redis leases enforce the same limits across API/worker processes;
        # local locks still avoid needless contention inside one process.
        async with distributed_tool_slot(provider):
            async with _EXTERNAL_TOOL_SEMAPHORE:
                if provider is None:
                    return await _execute_one_tool(state, call)
                async with _PROVIDER_TOOL_LOCKS[provider]:
                    return await _execute_one_tool(state, call)

    results = await asyncio.gather(*(execute_bounded(call) for call in action.calls))
    observations = [*state.get("observations", []), *results]
    candidates = list(state.get("candidate_places", []))
    seen = {str(item.get("provider_place_id")) for item in candidates}
    for result in results:
        if result.get("tool") not in {"place_search", "geocode", "place_detail"} or result.get("status") != "success":
            continue
        data = result.get("data")
        nodes = data if isinstance(data, list) else [data]
        for item in nodes:
            if not isinstance(item, dict):
                continue
            place_id = str(item.get("provider_place_id") or "")
            if place_id and place_id not in seen:
                candidates.append(item)
                seen.add(place_id)
    trip_id, thread_id, run_id = _ids(state)
    success_count = sum(1 for item in results if item.get("status") == "success")
    async with SessionFactory() as session:
        await event_broker.publish(
            session,
            "progress.completed",
            {
                "step_id": f"decision-{state.get('iteration', 0)}",
                "title": "真实信息已返回" if success_count else "查询未完成，正在调整",
                "summary": f"完成 {len(results)} 项查询，其中 {success_count} 项成功。",
            },
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    return {"observations": observations, "candidate_places": candidates}


async def _initial_plan_patch(
    state: AgentLoopState,
    schedule_data: dict[str, Any],
    *,
    draft: bool = False,
) -> tuple[PlanPatch, PlanSnapshot]:
    trip_id, thread_id, run_id = _ids(state)
    schedule = ScheduleProposal.model_validate(schedule_data)
    candidates = state.get("selected_candidates") or state.get("candidate_places") or []
    if not candidates:
        raise RuntimeError("还没有经过真实地图核验的地点，不能生成行程")
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        if not trip:
            raise RuntimeError("Trip 不存在")
        spec = TripSpecData.model_validate(trip.trip_spec)
        gaps = _planning_gaps(spec)
        if gaps:
            raise RuntimeError("规划前仍需确认：" + "、".join(gaps))
        trip.lifecycle = TripLifecycle.PLANNING.value
        snapshot = await build_initial_plan(
            session,
            run_id,
            trip_id,
            thread_id,
            spec,
            candidates=candidates,
            schedule_data=schedule.model_dump(mode="json"),
            draft=draft,
        )
        operations = [
            PatchOperation(op="ADD", item_id=item.id, day_index=day.day_index, payload=item.model_dump(mode="json"))
            for day in snapshot.days
            for item in day.items
        ]
        row = PlanPatch(
            trip_id=trip_id,
            run_id=run_id,
            base_version=trip.current_version,
            state=PatchState.PREVIEW.value,
            scope={"kind": "initial_plan", "days": [day.day_index for day in snapshot.days]},
            reason=(
                "创建经过真实地点核验的首版草案"
                if draft
                else "创建经过真实地点、相邻路线和必要事实核验的正式行程"
            ),
            operations=[item.model_dump(mode="json") for item in operations],
            impact=PatchImpact(
                changed_days=[day.day_index for day in snapshot.days],
                added=[item.title for day in snapshot.days for item in day.items],
            ).model_dump(mode="json"),
            validation_result={
                "blocking": [item.model_dump(mode="json") for item in snapshot.conflicts if item.level == "blocking"],
                "warnings": [item.model_dump(mode="json") for item in snapshot.conflicts if item.level == "warning"],
            },
            proposed_snapshot=snapshot.model_dump(mode="json"),
        )
        session.add(row)
        trip.lifecycle = TripLifecycle.REVIEWING.value
        await session.commit()
        await session.refresh(row)
        return row, snapshot


def _planning_gap_component(state: AgentLoopState, gap: str) -> AgentComponentRequest | None:
    """Turn a deterministic planning blocker into a recoverable user decision."""
    if gap in {"具体目的地区域", "目的地"}:
        if not state.get("candidate_places"):
            return None
        destination_name = _destination_name(state.get("context", {})) or ""
        normalized_destination = destination_name.removesuffix("市")
        candidates = list(state.get("candidate_places", []))
        administrative = [
            item
            for item in candidates
            if str(item.get("provider_place_id") or "").startswith("adcode:")
            or str(item.get("name") or "").removesuffix("市") == normalized_destination
        ]
        # A destination decision must never be satisfied by a scenic spot,
        # entrance or other POI merely because place research happened first.
        # Ask the model to geocode the city/region and resume once an
        # administrative candidate is available.
        if not administrative:
            return None
        options = administrative[:5]
        return AgentComponentRequest(
            type="destination_disambiguation",
            title="确认本次旅行目的地",
            prompt="开始排程前，请确认百度地图解析到的具体目的地。确认后我会继续使用刚才的研究结果，不需要重新开始。",
            props={"source_notice": "候选地点来自本轮百度地图查询。", "options": options},
        )
    if gap in {"旅行日期范围", "大致天数或日期范围"}:
        return AgentComponentRequest(
            type="quick_choice",
            title="先确认大致时长",
            prompt="先给我一个大致时长就可以生成首版草案；具体日期会在后续补齐天气和交通核验。",
            props={
                "options": [
                    {"id": "3", "label": "3 天左右", "updates": {"duration_days": 3}},
                    {"id": "5", "label": "5 天左右", "updates": {"duration_days": 5}},
                    {"id": "7", "label": "一周左右", "updates": {"duration_days": 7}},
                    {"id": "10", "label": "10 天左右", "updates": {"duration_days": 10}},
                ],
                "allow_skip": True,
            },
        )
    if gap in {"同行人", "同行人信息"}:
        return AgentComponentRequest(
            type="traveler_selector",
            title="确认同行人",
            prompt="同行人会改变节奏、步行量和地点选择，请确认这次和谁出发。",
        )
    if gap in {"体力、饮食或无障碍等硬约束", "同行硬约束"}:
        return AgentComponentRequest(
            type="traveler_needs_selector",
            title="确认需要特别照顾的事项",
            prompt="请确认体力、饮食或无障碍要求；没有也可以直接确认。",
        )
    if gap == "旅行节奏":
        return AgentComponentRequest(
            type="pace_interest_selector",
            title="确认旅行节奏",
            prompt="请确认希望每天安排得轻松、适中还是紧凑。",
        )
    return None


def _place_candidates_component(state: AgentLoopState) -> AgentComponentRequest:
    must_visit = _field_value(state.get("context", {}), "must_visit")
    required_names = [str(item) for item in must_visit] if isinstance(must_visit, list) else ([str(must_visit)] if must_visit else [])
    required_ids: list[str] = []
    for required_name in required_names:
        matches = [
            item
            for item in state.get("candidate_places", [])
            if required_name in str(item.get("name") or "")
            and "旅游" in str(item.get("category") or "")
        ]
        if matches:
            required_ids.append(str(matches[0].get("provider_place_id")))
    return AgentComponentRequest(
        type="place_candidates",
        title="选择首版行程地点",
        prompt="这些地点都已通过百度地图核验。请选择希望排入首版日程的地点；标记为必去的地点会被保留。",
        props={
            "source_notice": "地点名称、坐标与基础信息来自本轮百度地图查询。",
            "required_ids": required_ids,
        },
    )


async def validate_patch_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    action = AgentAction.model_validate(state["action"])
    trip_id, thread_id, run_id = _ids(state)
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        if not trip:
            raise RuntimeError("Trip 不存在")
        current_version = trip.current_version
    kind = str(action.patch.get("kind") or ("initial_plan" if current_version == 0 else "modify_plan"))
    if kind == "item_action":
        intent = Intent(str(action.patch.get("intent")))
        async with SessionFactory() as session:
            trip = await session.get(Trip, trip_id)
            if not trip:
                raise RuntimeError("Trip 不存在")
            _, version = await apply_natural_item_action(
                session,
                trip,
                intent=intent,
                message=state["message"],
                scope=action.patch.get("scope") or {},
            )
        return {
            "response_outline": f"说明操作已应用为 V{version.version}，并给出当前下一步。",
            "patch_deferred": False,
        }
    if kind == "initial_plan":
        async with SessionFactory() as session:
            trip = await session.get(Trip, trip_id)
            if not trip:
                raise RuntimeError("Trip 不存在")
            gaps = _planning_gaps(TripSpecData.model_validate(trip.trip_spec))
        if gaps:
            gap = gaps[0]
            component = _planning_gap_component(state, gap)
            observations = list(state.get("observations", []))
            if component is None:
                observations.append(
                    {
                        "type": "validation_blocker",
                        "status": "needs_research",
                        "message": f"规划前仍需确认：{gap}。请先调用地点工具获取真实候选。",
                    }
                )
                await _complete_public_progress(
                    state,
                    "还需要一项真实信息",
                    f"规划前仍需确认{gap}，我会先补充查询再继续。",
                )
            else:
                await _complete_public_progress(
                    state,
                    "发现一项需要确认的信息",
                    f"规划校验发现仍需确认{gap}，确认后会从当前进度继续。",
                )
                answer = await _interactive_component(state, component)
                observations = await _apply_component_answer(state, component, answer)
            return {"observations": observations, "patch_deferred": True}
        schedule_data = action.patch.get("schedule") or action.patch
        # Validate that schedule_data has the minimum required shape before
        # passing it to ScheduleProposal. If the model omitted "items",
        # fall back to the deterministic schedule builder.
        if not isinstance(schedule_data, dict) or not isinstance(schedule_data.get("items"), list) or not schedule_data["items"]:
            try:
                schedule_data = _deterministic_initial_schedule(state)
            except RuntimeError:
                observations = [
                    *state.get("observations", []),
                    {
                        "type": "validation_blocker",
                        "status": "needs_research",
                        "message": "当前没有足够的真实地点候选，暂不生成空行程。",
                    },
                ]
                await _complete_public_progress(state, "还需要真实地点候选", "当前地点候选不足，先补充真实地点后再生成草案。")
                return {"observations": observations, "patch_deferred": True}
        # The deterministic harness owns the safety gate and fallback, while
        # the dedicated scheduling prompt may improve grouping and day titles
        # once the real POI pool is available. Any model-proposed id outside
        # that pool is discarded instead of reaching the planner.
        try:
            async with SessionFactory() as session:
                trip = await session.get(Trip, trip_id)
                if trip:
                    schedule_call = await llm_client.schedule(
                        trip.trip_spec,
                        state.get("selected_candidates") or state.get("candidate_places") or [],
                    )
                    allowed_ids = {
                        str(item.get("provider_place_id"))
                        for item in (state.get("selected_candidates") or state.get("candidate_places") or [])
                        if item.get("provider_place_id")
                    }
                    valid_items = [
                        item.model_dump(mode="json")
                        for item in schedule_call.value.items
                        if item.provider_place_id in allowed_ids
                    ]
                    if valid_items:
                        schedule_data = {
                            "day_titles": schedule_call.value.day_titles,
                            "items": valid_items,
                        }
        except Exception:
            # A schedule prompt failure is non-blocking: the bounded
            # deterministic arrangement remains the safe product fallback.
            pass
        try:
            schedule_data = ScheduleProposal.model_validate(schedule_data).model_dump(mode="json")
        except Exception:
            try:
                schedule_data = _deterministic_initial_schedule(state)
            except RuntimeError:
                observations = [
                    *state.get("observations", []),
                    {
                        "type": "validation_blocker",
                        "status": "needs_research",
                        "message": "首版排程数据格式无效，且当前没有可用真实地点，已停止生成。",
                    },
                ]
                await _complete_public_progress(state, "暂未生成空行程", "排程数据还不完整，我会保留当前状态，等真实地点补齐后继续。")
                return {"observations": observations, "patch_deferred": True}
        row, snapshot = await _initial_plan_patch(state, schedule_data, draft=True)
        await _persist_artifact(
            state,
            artifact_type="plan_draft",
            payload={"patch_id": str(row.id), "plan": snapshot.model_dump(mode="json")},
            assumptions=TripSpecData.model_validate(state.get("context", {}).get("trip_spec") or {}).assumptions,
            source_ids=[str(item) for item in state.get("citation_ids", [])],
        )
        component = AgentComponentRequest(
            type="plan_preview",
            title="首版行程已经准备好",
            prompt="我先按真实地点整理了区域和每天主题，没有提前计算精确路线、住宿通勤或天气。确认草案后，我再补齐这些实时核验。",
            props={"plan": snapshot.model_dump(mode="json"), "patch_id": str(row.id)},
        )
    else:
        proposal = PatchProposal.model_validate(action.patch.get("proposal") or action.patch)
        async with SessionFactory() as session:
            trip = await session.get(Trip, trip_id)
            if not trip:
                raise RuntimeError("Trip 不存在")
            row = await propose_natural_language_patch(
                session,
                trip,
                run_id,
                thread_id,
                state["message"],
                proposal_data=proposal.model_dump(mode="json"),
            )
        component = AgentComponentRequest(
            type="plan_patch_preview",
            title="预览本次行程调整",
            prompt="我只调整了你指定的范围，并保护已完成、锁定和预约事项。确认前，当前行程不会改变。",
            props={"patch": patch_data(row).model_dump(mode="json")},
        )
    async with SessionFactory() as session:
        await event_broker.publish(
            session,
            "trip.patch.preview",
            {"patch": patch_data(row).model_dump(mode="json")},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    answer = await _interactive_component(state, component)
    if answer.get("action") == "apply" and kind == "initial_plan":
        # Applying the preview is the explicit transition into FINALIZING.
        # Only now are adjacent routes, lodging area candidates and weather
        # allowed to touch the provider budget.
        await _complete_public_progress(
            state,
            "开始补齐正式计划",
            "草案已确认，现在只核验入选地点之间的相邻路线、住宿区域和必要天气信息。",
        )
        draft_row = row
        row, _ = await _initial_plan_patch(
            state,
            action.patch.get("schedule") or action.patch,
            draft=False,
        )
        async with SessionFactory() as finalize_session:
            previous = await finalize_session.get(PlanPatch, draft_row.id)
            if previous:
                previous.state = PatchState.SUPERSEDED.value
            await finalize_session.commit()
    async with SessionFactory() as session:
        if answer.get("action") == "apply":
            _, version = await apply_patch(session, row.id, f"agent-loop:{run_id}:{row.id}")
            conversation_state = await _ensure_conversation_state(session, thread_id)
            conversation_state.stage = ConversationStage.PLAN_ACTIVE.value
            conversation_state.planning_consent = PlanningConsent.DRAFT_CONFIRMED.value
            conversation_state.consecutive_question_turns = 0
            artifact = await session.scalar(
                select(TripArtifact)
                .where(TripArtifact.run_id == run_id, TripArtifact.type == "plan_draft")
                .order_by(TripArtifact.created_at.desc())
            )
            if artifact:
                artifact.status = "APPLIED"
                artifact.payload = {
                    "patch_id": str(row.id),
                    "plan": row.proposed_snapshot,
                }
            await event_broker.publish(
                session,
                "trip.patch.applied",
                {"patch_id": str(row.id), "version": version.version},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await event_broker.publish(
                session,
                "plan.draft.confirmed",
                {"artifact_id": str(artifact.id) if artifact else None, "version": version.version},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await session.commit()
            return {
                "response_outline": f"说明方案已保存为 V{version.version}，概括已核验内容、未知项和后续照看。",
                "patch_deferred": False,
            }
        await reject_patch(session, row.id)
        conversation_state = await _ensure_conversation_state(session, thread_id)
        conversation_state.stage = ConversationStage.DRAFT_REVIEW.value
        artifact = await session.scalar(
            select(TripArtifact)
            .where(TripArtifact.run_id == run_id, TripArtifact.type == "plan_draft")
            .order_by(TripArtifact.created_at.desc())
        )
        if artifact:
            artifact.status = "REJECTED"
        await event_broker.publish(
            session,
            "plan.draft.rejected",
            {"artifact_id": str(artifact.id) if artifact else None},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    return {
        "response_outline": "说明这次方案没有应用，当前 Trip State 保持不变，并邀请用户继续调整。",
        "patch_deferred": False,
    }


def route_validated_patch(state: AgentLoopState) -> Literal["bootstrap", "stream_response"]:
    return "bootstrap" if state.get("patch_deferred") else "stream_response"


def _sanitize_citations(content: str, sources: list[dict[str, Any]]) -> str:
    allowed_ids = {str(item["id"]) for item in sources}

    def replace_marker(match: re.Match[str]) -> str:
        return match.group(0) if match.group(1) in allowed_ids else ""

    content = re.sub(r"\[来源:([0-9a-fA-F-]{36})\]", replace_marker, content)
    # Links are rendered exclusively from persisted SourceRecord rows. Any
    # model-authored Markdown URL is reduced to its label.
    return re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", content)


async def stream_response_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    trip_id, thread_id, run_id = _ids(state)
    citation_ids = {str(item) for item in state.get("citation_ids", [])}
    async with SessionFactory() as session:
        trip = await session.get(Trip, trip_id)
        if not trip:
            raise RuntimeError("Trip 不存在")
        plan = await get_current_plan(session, trip)
        rows = (
            await session.scalars(
                select(SourceRecord).where(SourceRecord.run_id == run_id).order_by(SourceRecord.retrieved_at.asc())
            )
        ).all()
        if citation_ids:
            rows = [row for row in rows if str(row.id) in citation_ids]
        sources = [source_data(row).model_dump(mode="json") for row in rows]
        response_context = {
            "current_request": state["message"],
            "run_intent": state["context"].get("run_intent"),
            "trip_spec": trip.trip_spec,
            "current_plan": plan.model_dump(mode="json") if plan else None,
            "observations": state.get("observations", [])[-10:],
        }
    chunks: list[str] = []
    pending_delta = ""
    last_delta_flush = asyncio.get_running_loop().time()
    fast_response_intents = {
        Intent.ASK_TRIP_QUESTION.value,
        Intent.ANSWER_CLARIFICATION.value,
        Intent.SEARCH_PLACE.value,
        Intent.EXPLAIN_PLAN.value,
        Intent.GENERAL_CHAT.value,
    }
    async for chunk in llm_client.stream_final_response(
        context=response_context,
        response_outline=state.get("response_outline") or "回答当前问题，并明确不确定信息。",
        sources=sources,
        thinking_enabled=False if response_context.get("run_intent") in fast_response_intents else None,
        reasoning_effort="low" if response_context.get("run_intent") in fast_response_intents else None,
    ):
        chunks.append(chunk)
        pending_delta += chunk
        now = asyncio.get_running_loop().time()
        if (
            len(pending_delta) >= 40
            or pending_delta.endswith(("。", "！", "？", "\n"))
            or now - last_delta_flush >= 0.35
        ):
            async with SessionFactory() as session:
                await event_broker.publish(
                    session,
                    "message.delta",
                    {"delta": pending_delta},
                    trip_id=trip_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    commit=True,
                )
            pending_delta = ""
            last_delta_flush = now
    if pending_delta:
        async with SessionFactory() as session:
            await event_broker.publish(
                session,
                "message.delta",
                {"delta": pending_delta},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=True,
            )
    message = _sanitize_citations("".join(chunks).strip(), sources)
    if not message:
        message = "这一步没有得到可用的模型回复。已保留当前旅程状态，你可以重新发送刚才的需求。"
    await _complete_public_progress(state, "回答已经整理好", "我只保留了经过 Trip State 或真实来源支持的内容。")
    return {"assistant_message": message, "citation_ids": [str(item["id"]) for item in sources]}


async def finish_node(state: AgentLoopState) -> AgentLoopState:
    await _assert_run_active(state)
    trip_id, thread_id, run_id = _ids(state)
    message = state.get("assistant_message")
    citation_ids = [str(item) for item in state.get("citation_ids", [])]
    async with SessionFactory() as session:
        run = await session.get(AgentRun, run_id)
        thread = await session.get(ConversationThread, thread_id)
        if not run:
            raise RuntimeError("Agent Run 不存在")
        if run.status in {
            RunStatus.SUCCEEDED.value,
            RunStatus.FAILED.value,
            RunStatus.CANCELLED.value,
        }:
            # A resumed/retried checkpoint must not emit a second terminal
            # event or append a duplicate assistant message.
            return {}
        recovered_errors = (
            await session.scalars(
                select(Message).where(
                    Message.run_id == run_id,
                    Message.role == "assistant",
                    Message.meta["kind"].as_string() == "run_error",
                )
            )
        ).all()
        for error_message in recovered_errors:
            error_message.meta = {
                **(error_message.meta or {}),
                "kind": "run_error_recovered",
                "recovered_at": datetime.now(UTC).isoformat(),
            }
        if message:
            session.add(
                Message(
                    thread_id=thread_id,
                    run_id=run_id,
                    role="assistant",
                    content=message,
                    meta={"kind": "agent_response", "citation_ids": citation_ids},
                )
            )
            if thread:
                thread.last_message_at = datetime.now(UTC)
            await event_broker.publish(
                session,
                "message.completed",
                {"message": message, "citation_ids": citation_ids},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
        await _set_run(run, RunStatus.SUCCEEDED, "completed")
        run.error = None
        run.active_job_id = None
        await event_broker.publish(
            session,
            "run.completed",
            {"status": RunStatus.SUCCEEDED.value},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
    return {}


def build_graph(checkpointer):
    builder = StateGraph(AgentLoopState)
    builder.add_node("bootstrap", bootstrap_node)
    builder.add_node("classify_and_extract", classify_and_extract_node)
    builder.add_node("model_decide", model_decide_node)
    builder.add_node("execute_tools", execute_tools_node)
    builder.add_node("wait_user", wait_user_node)
    builder.add_node("validate_patch", validate_patch_node)
    builder.add_node("stream_response", stream_response_node)
    builder.add_node("finish", finish_node)
    builder.add_edge(START, "bootstrap")
    builder.add_conditional_edges(
        "bootstrap",
        route_bootstrap,
        {"classify_and_extract": "classify_and_extract", "model_decide": "model_decide"},
    )
    builder.add_edge("classify_and_extract", "model_decide")
    builder.add_conditional_edges(
        "model_decide",
        route_action,
        {
            "execute_tools": "execute_tools",
            "wait_user": "wait_user",
            "validate_patch": "validate_patch",
            "stream_response": "stream_response",
            "bootstrap": "bootstrap",
            "finish": "finish",
        },
    )
    builder.add_edge("execute_tools", "bootstrap")
    builder.add_edge("wait_user", "bootstrap")
    builder.add_conditional_edges(
        "validate_patch",
        route_validated_patch,
        {"bootstrap": "bootstrap", "stream_response": "stream_response"},
    )
    builder.add_edge("stream_response", "finish")
    builder.add_edge("finish", END)
    return builder.compile(checkpointer=checkpointer)
