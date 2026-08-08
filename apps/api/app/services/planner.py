from __future__ import annotations

import math
from datetime import UTC, date, datetime, time, timedelta
from time import monotonic
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.llm import ScheduleProposal, llm_client
from app.core.config import get_settings
from app.db.models import FactSnapshot, PlanVersion, Trip, Watch
from app.domain.enums import FactState, TripLifecycle
from app.domain.schemas import (
    Coordinates,
    HotelSuggestion,
    ItineraryItem,
    Place,
    PlanSnapshot,
    RouteLeg,
    TripDay,
    TripSpecData,
)
from app.services.events import event_broker
from app.services.validator import has_blocking_conflicts, validate_plan
from app.tools.mcp_client import ToolGatewayError, tool_gateway

SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


def _destination(spec: TripSpecData) -> tuple[str, str | None]:
    value = spec.destination.value
    if isinstance(value, dict):
        return str(value.get("name") or value.get("city") or ""), value.get("adcode")
    return str(value or ""), None


def _destination_coordinates(spec: TripSpecData) -> dict[str, float] | None:
    value = spec.destination.value
    if not isinstance(value, dict) or not isinstance(value.get("coordinates"), dict):
        return None
    try:
        return {
            "longitude": float(value["coordinates"]["longitude"]),
            "latitude": float(value["coordinates"]["latitude"]),
        }
    except (KeyError, TypeError, ValueError):
        return None


def _compact_community_notes(value: Any, *, limit: int = 8) -> list[dict[str, str]]:
    """Extract bounded, attributable note cards from varying community schemas."""

    notes: list[dict[str, str]] = []

    def visit(node: Any) -> None:
        if len(notes) >= limit:
            return
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        title = node.get("title") or node.get("display_title") or node.get("note_title")
        url = node.get("url") or node.get("note_url") or node.get("share_url")
        description = node.get("desc") or node.get("description") or node.get("content")
        if title or url:
            card = {
                "title": str(title or "小红书旅行笔记")[:180],
                "url": str(url or "")[:800],
                "excerpt": str(description or "")[:500],
                "source": "jobsonlook/xhs-mcp",
            }
            signature = (card["title"], card["url"])
            if signature not in {(item["title"], item["url"]) for item in notes}:
                notes.append(card)
        for child in node.values():
            if isinstance(child, dict | list):
                visit(child)

    visit(value)
    return notes


def _candidate_matches_destination(
    candidate: dict[str, Any],
    *,
    destination: str,
    center: dict[str, float] | None,
) -> tuple[bool, str]:
    coordinates = candidate.get("coordinates")
    if not isinstance(coordinates, dict):
        return False, "缺少有效坐标"
    if center:
        try:
            distance_km = _distance(center, coordinates) / 1000
        except (KeyError, TypeError, ValueError):
            return False, "坐标无法解析"
        if distance_km > 160:
            return False, f"距离已确认目的地中心约 {distance_km:.0f} km"
    candidate_city = str(candidate.get("city") or candidate.get("province") or "")
    normalized_destination = destination.removesuffix("市").removesuffix("地区")
    normalized_city = candidate_city.removesuffix("市").removesuffix("地区")
    if normalized_city and normalized_destination:
        matches = normalized_destination in normalized_city or normalized_city in normalized_destination
        if not matches and center is None:
            return False, f"返回城市为{candidate_city}"
    return True, "通过目的地范围校验"


def _date_range(spec: TripSpecData) -> list[date]:
    if not spec.start_date.value or not spec.end_date.value:
        raise ValueError("规划需要明确的开始和结束日期")
    start = date.fromisoformat(str(spec.start_date.value))
    end = date.fromisoformat(str(spec.end_date.value))
    if end < start:
        raise ValueError("结束日期不能早于开始日期")
    return [start + timedelta(days=index) for index in range((end - start).days + 1)]


def _distance(a: dict[str, float], b: dict[str, float]) -> float:
    lat1, lon1 = math.radians(a["latitude"]), math.radians(a["longitude"])
    lat2, lon2 = math.radians(b["latitude"]), math.radians(b["longitude"])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def _tool_timestamp(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        return value
    if value:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return datetime.now(UTC)


async def resolve_destination(
    session: AsyncSession,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    destination: str,
) -> list[dict[str, Any]]:
    result = await tool_gateway.call_baidu_map(
        session,
        run_id,
        trip_id,
        thread_id,
        "map_geocode",
        {"address": destination},
    )
    options = []
    for item in result.data or []:
        options.append(
            {
                "provider_place_id": str(item.get("provider_place_id") or f"adcode:{item.get('adcode')}"),
                "name": item.get("name") or item.get("city") or item.get("formatted_address") or destination,
                "city": item.get("city") or item.get("province") or destination,
                "district": item.get("district"),
                "adcode": item.get("adcode"),
                "coordinates": item.get("coordinates"),
                "provider": "baidu-map",
                "source": result.source,
                "observed_at": result.retrieved_at.isoformat(),
            }
        )
    return options


async def research_candidates(
    session: AsyncSession,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    spec: TripSpecData,
) -> list[dict[str, Any]]:
    destination, _ = _destination(spec)
    community_notes: list[dict[str, str]] = []
    if get_settings().enable_xhs_mcp:
        try:
            xhs_query = " ".join(
                part
                for part in (
                    destination,
                    " ".join(spec.interests.value or []),
                    " ".join(spec.traveler_requirements.value or []),
                    "旅行攻略",
                )
                if part
            )
            xhs_result = await tool_gateway.call_xhs(
                session,
                run_id,
                trip_id,
                thread_id,
                "xhs_search_notes",
                {"keywords": xhs_query},
            )
            community_notes = _compact_community_notes(xhs_result.data)
        except ToolGatewayError:
            community_notes = []
    research_input = spec.model_dump(mode="json")
    research_input["xiaohongshu_read_only_notes"] = community_notes
    await event_broker.publish(
        session,
        "context.compiled",
        {
            "title": "装配地点研究上下文",
            "input": {"destination": destination},
            "output": {
                "sections": [
                    "trip_spec",
                    "xiaohongshu_read_only_notes",
                ],
                "xiaohongshu_note_count": len(community_notes),
            },
            "meta": {"policy": "minimal-sufficient-context", "raw_system_prompt_exposed": False},
        },
        trip_id=trip_id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    await event_broker.publish(
        session,
        "model.started",
        {"name": "llm.research_plan", "provider": "openai-compatible"},
        trip_id=trip_id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    research_started = monotonic()
    research_call = await llm_client.research_plan(research_input)
    research = research_call.value
    await event_broker.publish(
        session,
        "model.response",
        research_call.trace_payload(
            "llm.research_plan",
            duration_ms=round((monotonic() - research_started) * 1000),
        ),
        trip_id=trip_id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    candidates: dict[str, dict[str, Any]] = {}
    rejected: list[dict[str, str]] = []
    destination_center = _destination_coordinates(spec)
    missing_required: list[str] = []
    for query in research.queries:
        result = await tool_gateway.call_baidu_map(
            session,
            run_id,
            trip_id,
            thread_id,
            "map_search_places",
            {"query": query.keyword, "region": destination, "limit": 5},
        )
        pois = result.data or []
        if not pois:
            continue
        valid: list[dict[str, Any]] = []
        for poi in pois:
            matches, reason = _candidate_matches_destination(
                poi,
                destination=destination,
                center=destination_center,
            )
            if matches:
                valid.append(poi)
            else:
                rejected.append({"query": query.keyword, "name": str(poi.get("name")), "reason": reason})
        if not valid:
            if query.required or query.keyword in (spec.must_visit.value or []):
                missing_required.append(query.keyword)
            continue
        exact = next((poi for poi in valid if query.keyword in str(poi.get("name", ""))), valid[0])
        place_id = str(exact["provider_place_id"])
        if place_id not in candidates:
            related_notes = [
                note
                for note in community_notes
                if str(exact.get("name", "")) in f"{note.get('title', '')}{note.get('excerpt', '')}"
            ][:3]
            candidates[place_id] = {
                **exact,
                "reason": query.reason,
                "requested_category": query.category,
                "required": query.required or query.keyword in (spec.must_visit.value or []),
                "source": result.source,
                "observed_at": result.retrieved_at.isoformat(),
                "community_notes": related_notes,
            }
    await event_broker.publish(
        session,
        "validation.completed",
        {
            "title": "校验候选地点所属目的地",
            "summary": f"保留 {len(candidates)} 个真实地点，排除 {len(rejected)} 个跨城或无坐标结果。",
            "input": {"destination": destination, "destination_coordinates": destination_center},
            "output": {
                "accepted": [
                    {"name": item.get("name"), "city": item.get("city"), "coordinates": item.get("coordinates")}
                    for item in candidates.values()
                ],
                "rejected": rejected,
                "missing_required": missing_required,
            },
            "meta": {"validator": "destination-distance-and-city", "max_distance_km": 160},
        },
        trip_id=trip_id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    if missing_required:
        raise ToolGatewayError(
            "以下必去地点无法在已确认目的地范围内解析：" + "、".join(missing_required)
        )
    return list(candidates.values())


async def _route(
    session: AsyncSession,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    origin_item: ItineraryItem,
    destination_item: ItineraryItem,
    city: str,
    call_budget: list[int] | None = None,
) -> RouteLeg | None:
    if not origin_item.place or not destination_item.place:
        return None
    origin = origin_item.place.coordinates
    destination = destination_item.place.coordinates
    origin_value = f"{origin.latitude},{origin.longitude}"
    destination_value = f"{destination.latitude},{destination.longitude}"
    direct_distance = _distance(
        {"longitude": origin.longitude, "latitude": origin.latitude},
        {"longitude": destination.longitude, "latitude": destination.latitude},
    )
    calls = [
        (
            "map_directions",
            {"origin": origin_value, "destination": destination_value, "mode": "walking"},
            "walking",
        )
    ] if direct_distance <= 1800 else [
        (
            "map_directions",
            {"origin": origin_value, "destination": destination_value, "mode": "transit"},
            "transit",
        ),
        (
            "map_directions",
            {"origin": origin_value, "destination": destination_value, "mode": "driving"},
            "driving",
        ),
    ]
    for tool_name, arguments, mode in calls:
        if call_budget is not None:
            if call_budget[0] <= 0:
                return None
            call_budget[0] -= 1
        try:
            result = await tool_gateway.call_baidu_map(
                session, run_id, trip_id, thread_id, tool_name, arguments
            )
        except ToolGatewayError:
            continue
        paths = result.data or []
        if not paths:
            continue
        path = paths[0]
        summary = " · ".join(path.get("instructions", [])[:2]) or {
            "walking": "步行前往",
            "transit": "公共交通前往",
            "driving": "驾车或打车前往",
        }[mode]
        return RouteLeg(
            id=str(uuid4()),
            origin_item_id=origin_item.id,
            destination_item_id=destination_item.id,
            mode=mode,
            duration_minutes=max(1, math.ceil(int(path.get("duration_seconds", 0)) / 60)),
            distance_meters=int(path.get("distance_meters", 0)),
            summary=summary,
            polyline=[Coordinates.model_validate(point) for point in path.get("polyline", [])],
            observed_at=result.retrieved_at,
            fact_state=FactState(result.cache_state),
        )
    return None


async def _commute_minutes(
    session: AsyncSession,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    origin: Coordinates,
    destination: Coordinates,
    city: str,
) -> tuple[int, str] | None:
    origin_value = f"{origin.latitude},{origin.longitude}"
    destination_value = f"{destination.latitude},{destination.longitude}"
    calls = [
        (
            "map_directions",
            {"origin": origin_value, "destination": destination_value, "mode": "transit"},
            "transit",
        ),
        (
            "map_directions",
            {"origin": origin_value, "destination": destination_value, "mode": "driving"},
            "driving",
        ),
    ]
    for tool_name, arguments, mode in calls:
        try:
            result = await tool_gateway.call_baidu_map(
                session, run_id, trip_id, thread_id, tool_name, arguments
            )
        except ToolGatewayError:
            continue
        paths = result.data or []
        if paths and int(paths[0].get("duration_seconds", 0)) > 0:
            return max(1, math.ceil(int(paths[0]["duration_seconds"]) / 60)), mode
    return None


async def build_hotel_suggestions(
    session: AsyncSession,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    destination: str,
    days: list[TripDay],
) -> list[HotelSuggestion]:
    """Return bounded lodging-area candidates without a route matrix.

    Route calls belong to an explicit lodging comparison. Doing them here
    couples every initial plan to ``candidate hotels × itinerary anchors`` and
    makes a useful plan fail or stall when a provider is slow.
    """
    places = [item.place for day in days for item in day.items if item.place]
    if not places:
        return []
    centroid = {
        "longitude": sum(place.coordinates.longitude for place in places) / len(places),
        "latitude": sum(place.coordinates.latitude for place in places) / len(places),
    }
    result = await tool_gateway.call_baidu_map(
        session,
        run_id,
        trip_id,
        thread_id,
        "map_search_places",
        {"region": destination, "query": "酒店", "limit": 12},
    )
    candidates = [candidate for candidate in (result.data or []) if candidate.get("coordinates")]
    candidates.sort(key=lambda candidate: _distance(centroid, candidate["coordinates"]))
    suggestions: list[HotelSuggestion] = []
    for candidate in candidates[:3]:
        coordinates = Coordinates.model_validate(candidate["coordinates"])
        place = Place(
            provider_place_id=str(candidate["provider_place_id"]),
            name=str(candidate["name"]),
            city=candidate.get("city") or destination,
            district=candidate.get("district"),
            address=candidate.get("address"),
            category=candidate.get("category"),
            coordinates=coordinates,
            source=str(result.source),
            observed_at=result.retrieved_at,
        )
        suggestions.append(
            HotelSuggestion(
                place=place,
                average_commute_minutes=0,
                route_samples=0,
                route_modes=[],
                reason="这是基于行程地点分布推荐的住宿区域候选；尚未计算精确通勤。比较具体酒店或住宿区域后，我再核验两个候选与代表性地点之间的真实路线。",
            )
        )
    return suggestions


async def build_initial_plan(
    session: AsyncSession,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    spec: TripSpecData,
    *,
    candidates: list[dict[str, Any]] | None = None,
    schedule_data: dict[str, Any] | None = None,
    draft: bool = False,
) -> PlanSnapshot:
    destination, destination_adcode = _destination(spec)
    trip_dates = _date_range(spec)
    candidates = candidates or await research_candidates(session, run_id, trip_id, thread_id, spec)
    if not candidates:
        raise ToolGatewayError("百度地图没有返回可用地点，无法生成真实行程。")
    if schedule_data is not None:
        schedule = ScheduleProposal.model_validate(schedule_data)
    else:
        # Compatibility fallback for non-Agent callers. The dynamic Agent Loop
        # always supplies a schedule built from its verified observations.
        schedule_call = await llm_client.schedule(spec.model_dump(mode="json"), candidates)
        schedule = schedule_call.value
    by_id = {str(candidate["provider_place_id"]): candidate for candidate in candidates}
    days = [TripDay(day_index=index + 1, date=value, title=f"第 {index + 1} 天") for index, value in enumerate(trip_dates)]
    now = datetime.now(UTC)
    for scheduled in schedule.items:
        candidate = by_id.get(scheduled.provider_place_id)
        if not candidate or scheduled.day_index > len(days):
            continue
        try:
            hour, minute = map(int, scheduled.start_time.split(":", 1))
            start_at = datetime.combine(trip_dates[scheduled.day_index - 1], time(hour, minute), SHANGHAI_TZ)
        except (ValueError, TypeError):
            continue
        coords = Coordinates.model_validate(candidate["coordinates"])
        place = Place(
            provider_place_id=str(candidate["provider_place_id"]),
            name=str(candidate["name"]),
            city=candidate.get("city") or destination,
            district=candidate.get("district"),
            address=candidate.get("address"),
            category=candidate.get("category"),
            telephone=candidate.get("telephone"),
            opening_hours=candidate.get("opening_hours"),
            detail_url=candidate.get("detail_url"),
            overall_rating=candidate.get("overall_rating"),
            comment_count=candidate.get("comment_count"),
            image_count=candidate.get("image_count"),
            content_tags=candidate.get("content_tags") or [],
            community_notes=candidate.get("community_notes") or [],
            coordinates=coords,
            source=str(candidate.get("source", "baidu-map")),
            observed_at=_tool_timestamp(candidate.get("observed_at")),
        )
        days[scheduled.day_index - 1].items.append(
            ItineraryItem(
                id=str(uuid4()),
                day_index=scheduled.day_index,
                start_at=start_at,
                end_at=start_at + timedelta(minutes=scheduled.duration_minutes),
                title=place.name,
                category=scheduled.category,
                place=place,
                reason=scheduled.reason,
                cost_cny=None,
                reservation_state="unknown",
                source="baidu-map + llm_schedule",
                observed_at=now,
                opening_state="unverified",
            )
        )
    for key, title in schedule.day_titles.items():
        try:
            index = int(key) - 1
            if 0 <= index < len(days):
                days[index].title = title
        except ValueError:
            continue

    route_budget = [6]
    if not draft:
        for day in days:
            day.items.sort(key=lambda item: item.start_at)
            for index, (previous, current) in enumerate(zip(day.items, day.items[1:], strict=False)):
                leg = await _route(session, run_id, trip_id, thread_id, previous, current, destination, route_budget)
                if not leg:
                    continue
                day.route_legs.append(leg)
                earliest = previous.end_at + timedelta(minutes=leg.duration_minutes + 15)
                if current.start_at < earliest:
                    duration = current.end_at - current.start_at
                    current.start_at = earliest
                    current.end_at = earliest + duration
                    for later in day.items[index + 2 :]:
                        if later.start_at < current.end_at + timedelta(minutes=15):
                            later_duration = later.end_at - later.start_at
                            later.start_at = current.end_at + timedelta(minutes=15)
                            later.end_at = later.start_at + later_duration

    source_summary = ["百度地图地点检索"]
    source_summary.append(
        "首版草案：未核验精确路线、住宿通勤和天气" if draft else "百度地图真实路线"
    )
    if any(candidate.get("community_notes") for candidate in candidates):
        source_summary.append("小红书只读社区攻略")
    hotel_suggestions: list[HotelSuggestion] = []
    if not draft and len(days) > 1:
        try:
            hotel_suggestions = await build_hotel_suggestions(
                session, run_id, trip_id, thread_id, destination, days
            )
            if hotel_suggestions:
                source_summary.append("百度地图酒店地点与住宿区域建议")
        except ToolGatewayError:
            # Hotel convenience is useful but not a hard prerequisite for a
            # valid city itinerary. A missing result stays visibly empty.
            hotel_suggestions = []
    if not draft and destination_adcode:
        try:
            weather = await tool_gateway.call_baidu_map(
                session,
                run_id,
                trip_id,
                thread_id,
                "map_weather",
                {"district_id": destination_adcode},
            )
            weather_data = weather.data if isinstance(weather.data, dict) else {}
            forecasts = weather_data.get("forecasts") or []
            for day in days:
                match = next((cast for cast in forecasts if cast.get("date") == day.date.isoformat()), None)
                if match:
                    day.weather = {
                        **match,
                        "provider": "baidu-map",
                        "observed_at": weather.retrieved_at.isoformat(),
                    }
            session.add(
                FactSnapshot(
                    trip_id=trip_id,
                    fact_type="weather_forecast",
                    subject_type="destination",
                    subject_id=destination_adcode,
                    value=weather_data,
                    provider="baidu-map",
                    source_url=weather.source,
                    observed_at=weather.retrieved_at,
                    valid_until=weather.expires_at,
                    confidence_millis=1000,
                    state=weather.cache_state,
                )
            )
            source_summary.append("百度地图天气")
        except ToolGatewayError:
            pass
    await session.flush()
    plan = PlanSnapshot(
        days=days,
        hotel_suggestions=hotel_suggestions,
        generated_at=now,
        source_summary=source_summary,
    )
    validated = validate_plan(plan, spec)
    if draft:
        # A draft intentionally does not call route, weather or lodging tools.
        # Missing adjacent routes are therefore an explicit follow-up item,
        # not a blocker that makes a useful first draft look invalid.
        for conflict in validated.conflicts:
            if conflict.code == "ROUTE_MISSING":
                conflict.level = "warning"
                conflict.title = "相邻路线待正式核验"
                conflict.detail = "草案阶段暂不计算精确路线；确认草案后只核验入选地点之间的相邻路线。"
    blocking = [item.model_dump(mode="json") for item in validated.conflicts if item.level == "blocking"]
    warnings = [item.model_dump(mode="json") for item in validated.conflicts if item.level == "warning"]
    suggestions = [item.model_dump(mode="json") for item in validated.conflicts if item.level == "suggestion"]
    await event_broker.publish(
        session,
        "validation.completed",
        {
            "title": "校验首版行程",
            "summary": f"完成确定性校验：{len(blocking)} 个阻断、{len(warnings)} 个警告、{len(suggestions)} 条建议。",
            "input": {
                "day_count": len(validated.days),
                "item_count": sum(len(day.items) for day in validated.days),
                "route_leg_count": sum(len(day.route_legs) for day in validated.days),
            },
            "output": {"blocking": blocking, "warnings": warnings, "suggestions": suggestions},
            "meta": {"validator": "deterministic", "model_can_override": False},
        },
        trip_id=trip_id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    return validated


async def commit_plan(
    session: AsyncSession,
    trip: Trip,
    snapshot: PlanSnapshot,
    *,
    reason: str,
    source_patch_id: UUID | None = None,
) -> PlanVersion:
    next_version = trip.current_version + 1
    row = PlanVersion(
        trip_id=trip.id,
        version=next_version,
        snapshot=snapshot.model_dump(mode="json"),
        reason=reason,
        source_patch_id=source_patch_id,
    )
    session.add(row)
    trip.current_version = next_version
    blocked = has_blocking_conflicts(snapshot)
    spec = TripSpecData.model_validate(trip.trip_spec)
    today = datetime.now(SHANGHAI_TZ).date()
    in_trip_window = False
    if spec.start_date.value and spec.end_date.value:
        try:
            in_trip_window = (
                date.fromisoformat(str(spec.start_date.value))
                <= today
                <= date.fromisoformat(str(spec.end_date.value))
            )
        except ValueError:
            in_trip_window = False
    if trip.lifecycle == TripLifecycle.IN_TRIP.value or (in_trip_window and not blocked):
        trip.lifecycle = TripLifecycle.IN_TRIP.value
        trip.pulse = "存在阻断" if blocked else "旅行进行中"
    else:
        trip.lifecycle = TripLifecycle.REVIEWING.value if blocked else TripLifecycle.READY.value
        trip.pulse = "存在阻断" if blocked else "基本就绪"
    trip.updated_at = datetime.now(UTC)
    await session.flush()
    if not blocked:
        await ensure_default_watches(session, trip, snapshot)
    await session.commit()
    await session.refresh(row)
    return row


async def ensure_default_watches(session: AsyncSession, trip: Trip, snapshot: PlanSnapshot) -> None:
    spec = TripSpecData.model_validate(trip.trip_spec)
    settings = get_settings()
    destination, adcode = _destination(spec)
    existing_types = set(
        (
            await session.scalars(
                select(Watch.type).where(Watch.trip_id == trip.id)
            )
        ).all()
    )
    if adcode and "WEATHER" not in existing_types:
        session.add(
            Watch(
                trip_id=trip.id,
                type="WEATHER",
                query={"district_id": adcode, "destination": destination},
                state="WAITING",
                next_check_at=datetime.now(UTC),
            )
        )
    if "RAIL" not in existing_types and (
        rail_ticket := next((ticket for ticket in spec.tickets if ticket.kind == "rail"), None)
    ):
        can_query = bool(
            rail_ticket.from_station
            and rail_ticket.to_station
            and rail_ticket.train_date
            and settings.enable_12306_mcp
        )
        session.add(
            Watch(
                trip_id=trip.id,
                type="RAIL",
                query=rail_ticket.model_dump(mode="json"),
                state="WAITING" if can_query else "NEEDS_INPUT",
                next_check_at=datetime.now(UTC),
                enabled=can_query,
            )
        )
