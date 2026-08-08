from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import (
    AgentRun,
    ConversationThread,
    DecisionRequest,
    FactSnapshot,
    Trip,
    Watch,
)
from app.db.session import SessionFactory
from app.domain.enums import RiskLevel, RunStatus
from app.domain.schemas import PlanSnapshot
from app.services.events import event_broker
from app.services.trips import get_current_plan
from app.tools.mcp_client import ToolGatewayError, tool_gateway


def next_interval(trip: Trip) -> timedelta:
    start_value = (trip.trip_spec or {}).get("start_date", {}).get("value")
    if not start_value:
        return timedelta(days=1)
    try:
        start = datetime.fromisoformat(str(start_value)).date()
        days = (start - datetime.now(UTC).date()).days
    except ValueError:
        return timedelta(days=1)
    if trip.lifecycle == "IN_TRIP":
        return timedelta(hours=2)
    if days > 5:
        # Weather is not useful enough to poll before the five-day forecast
        # window. The next check is scheduled at the window boundary.
        return timedelta(days=days - 5)
    if days >= 3:
        return timedelta(hours=12)
    if days >= 1:
        return timedelta(hours=6)
    return timedelta(hours=2)


def _watch_days(watch: Watch, trip: Trip, now: datetime) -> int | None:
    value = (trip.trip_spec or {}).get("start_date", {}).get("value")
    if watch.type == "RAIL":
        value = (watch.query or {}).get("train_date") or value
    if not value:
        return None
    try:
        return (datetime.fromisoformat(str(value)).date() - now.date()).days
    except ValueError:
        return None


def weather_changed(previous: dict | None, current: dict) -> bool:
    if not previous:
        return False
    old_casts = previous.get("forecasts") or []
    new_casts = current.get("forecasts") or []
    old = {item.get("date"): (item.get("text_day"), item.get("text_night")) for item in old_casts}
    new = {item.get("date"): (item.get("text_day"), item.get("text_night")) for item in new_casts}
    return old != new


def weather_impacts(plan: PlanSnapshot | None, current: dict) -> list[dict[str, Any]]:
    if not plan:
        return []
    casts = current.get("forecasts") or []
    forecast_by_date = {str(item.get("date")): item for item in casts}
    indoor_markers = ("博物馆", "美术馆", "室内", "商场", "剧院", "展览", "餐饮")
    impacts: list[dict[str, object]] = []
    for day in plan.days:
        forecast = forecast_by_date.get(day.date.isoformat())
        if not forecast:
            continue
        weather_text = f"{forecast.get('text_day', '')}{forecast.get('text_night', '')}"
        if "雨" not in weather_text and "雪" not in weather_text and "台风" not in weather_text:
            continue
        affected = [
            item.title
            for item in day.items
            if not any(marker in f"{item.category}{item.title}" for marker in indoor_markers)
        ]
        if affected:
            impacts.append(
                {
                    "day_index": day.day_index,
                    "date": day.date.isoformat(),
                    "weather": weather_text,
                    "items": affected,
                }
            )
    return impacts


async def check_due_watches(ctx) -> int:
    checked = 0
    async with SessionFactory() as session:
        now = datetime.now(UTC)
        watches = (
            await session.scalars(
                select(Watch)
                .where(Watch.enabled.is_(True), Watch.next_check_at <= now)
                .with_for_update(skip_locked=True)
                .limit(20)
            )
        ).all()
        for watch in watches:
            trip = await session.get(Trip, watch.trip_id)
            if not trip:
                continue
            thread = await session.scalar(
                select(ConversationThread).where(ConversationThread.trip_id == trip.id).order_by(ConversationThread.created_at)
            )
            if not thread:
                continue
            days = _watch_days(watch, trip, now)
            if watch.type == "RAIL" and (days is None or days > 1):
                watch.state = "WAITING_MANUAL"
                watch.next_check_at = now + timedelta(days=max(1, (days or 1) - 1))
                continue
            run = AgentRun(
                trip_id=trip.id,
                thread_id=thread.id,
                status=RunStatus.RUNNING.value,
                intent="WATCH_CHECK",
                input_text=f"system watch {watch.type}",
                current_step="watch_check",
                checkpoint_thread_id=f"watch:{uuid4()}",
                idempotency_key=f"watch:{watch.id}:{now.isoformat()}",
            )
            session.add(run)
            await session.flush()
            try:
                if watch.type == "WEATHER":
                    result = await tool_gateway.call_baidu_map(
                        session,
                        run.id,
                        trip.id,
                        thread.id,
                        "map_weather",
                        {"district_id": watch.query["district_id"]},
                    )
                    current = result.data if isinstance(result.data, dict) else {"forecasts": []}
                    changed = weather_changed(watch.last_result, current)
                    current_plan = await get_current_plan(session, trip)
                    impacts = weather_impacts(current_plan, current)
                    session.add(
                        FactSnapshot(
                            trip_id=trip.id,
                            fact_type="weather_forecast",
                            subject_type="destination",
                            subject_id=watch.query["district_id"],
                            value=current,
                            provider=result.provider,
                            source_url=result.source,
                            observed_at=result.retrieved_at,
                            valid_until=result.expires_at,
                            confidence_millis=1000,
                            state=result.cache_state,
                        )
                    )
                    if changed and impacts:
                        impacted_names = [
                            name
                            for impact in impacts
                            for name in impact["items"]
                        ]
                        decision = DecisionRequest(
                            trip_id=trip.id,
                            title="目的地天气预报发生变化",
                            detail=(
                                "百度地图最新预报可能影响："
                                f"{'、'.join(str(name) for name in impacted_names[:6])}。"
                                "旅行管家会基于真实室内地点和路线准备局部 Plan B，原计划不会自动改变。"
                            ),
                            risk_level=RiskLevel.YELLOW.value,
                            options=[
                                {"id": "review", "label": "检查并准备 Plan B"},
                                {"id": "keep", "label": "暂时保留原计划"},
                            ],
                            recommended_option="review",
                        )
                        session.add(decision)
                        await session.flush()
                        await event_broker.publish(
                            session,
                            "decision.created",
                            {"decision_id": str(decision.id), "risk_level": decision.risk_level},
                            trip_id=trip.id,
                            thread_id=thread.id,
                            run_id=run.id,
                            commit=False,
                        )
                    watch.last_result = current
                elif watch.type == "RAIL":
                    query = watch.query
                    required = ("from_station", "to_station", "train_date")
                    if not all(query.get(field) for field in required):
                        watch.enabled = False
                        raise ToolGatewayError("车次监测缺少出发站、到达站或日期，已停用。")
                    result = await tool_gateway.call_rail(
                        session,
                        run.id,
                        trip.id,
                        thread.id,
                        "query-tickets",
                        {
                            "from_station": query["from_station"],
                            "to_station": query["to_station"],
                            "train_date": str(query["train_date"]),
                        },
                    )
                    payload = result.data if isinstance(result.data, dict) else {}
                    trains = payload.get("trains", [])
                    selected = next(
                        (
                            train
                            for train in trains
                            if not query.get("train_code")
                            or str(train.get("train_no")) == str(query.get("train_code"))
                        ),
                        None,
                    )
                    current = {
                        "train_code": query.get("train_code"),
                        "train": selected,
                        "source": result.source,
                        "retrieved_at": result.retrieved_at.isoformat(),
                    }
                    changed = (
                        selected is None
                        if watch.last_result is None
                        else watch.last_result.get("train") != selected
                    )
                    session.add(
                        FactSnapshot(
                            trip_id=trip.id,
                            fact_type="rail_options",
                            subject_type="rail_ticket",
                            subject_id=str(query.get("train_code") or watch.id),
                            value=current,
                            provider=result.provider,
                            source_url=result.source,
                            observed_at=result.retrieved_at,
                            valid_until=result.expires_at,
                            confidence_millis=800,
                            state=result.cache_state,
                        )
                    )
                    if changed:
                        unavailable = selected is None
                        decision = DecisionRequest(
                            trip_id=trip.id,
                            title="已选车次查询结果发生变化",
                            detail=(
                                f"社区 12306 MCP 本次未查到 {query.get('train_code')}。"
                                if unavailable
                                else f"{query.get('train_code')} 的时刻或席位查询结果已变化，请核对。"
                            ),
                            risk_level=(RiskLevel.RED.value if unavailable else RiskLevel.YELLOW.value),
                            options=[
                                {"id": "review", "label": "检查影响与备选"},
                                {"id": "keep", "label": "我已知晓"},
                            ],
                            recommended_option="review",
                        )
                        session.add(decision)
                        await session.flush()
                        await event_broker.publish(
                            session,
                            "decision.created",
                            {"decision_id": str(decision.id), "risk_level": decision.risk_level},
                            trip_id=trip.id,
                            thread_id=thread.id,
                            run_id=run.id,
                            commit=False,
                        )
                    watch.last_result = current
                else:
                    watch.state = "UNSUPPORTED"
                if watch.state != "UNSUPPORTED":
                    watch.state = "CHECKED"
                watch.last_checked_at = now
                if watch.type == "RAIL":
                    watch.next_check_at = now + timedelta(hours=2 if (days or 0) <= 0 else 24)
                else:
                    watch.next_check_at = now + next_interval(trip)
                run.status = RunStatus.SUCCEEDED.value
                run.completed_at = datetime.now(UTC)
                await event_broker.publish(
                    session,
                    "watch.checked",
                    {"watch_id": str(watch.id), "type": watch.type, "state": watch.state},
                    trip_id=trip.id,
                    thread_id=thread.id,
                    run_id=run.id,
                    commit=False,
                )
                checked += 1
            except ToolGatewayError as exc:
                watch.state = "FAILED"
                watch.last_checked_at = now
                watch.next_check_at = now + timedelta(hours=1)
                run.status = RunStatus.FAILED.value
                run.error = {"message": str(exc)}
                run.completed_at = datetime.now(UTC)
            except Exception as exc:
                watch.state = "FAILED"
                watch.last_checked_at = now
                watch.next_check_at = now + timedelta(hours=1)
                run.status = RunStatus.FAILED.value
                run.error = {
                    "code": "WATCH_CHECK_FAILED",
                    "message": "后台照看任务未完成，原有旅程不受影响。",
                    "detail": str(exc)[:400],
                }
                run.completed_at = datetime.now(UTC)
        await session.commit()
    return checked


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    # Keep scheduled Watch jobs away from the interactive Agent queue. Both
    # workers use the same Redis instance, but their function registries are
    # intentionally different; sharing ARQ's default queue lets the Watch
    # worker consume an Agent job and report "run_agent not found".
    queue_name = "arq:watch"
    functions = [check_due_watches]
    cron_jobs = [cron(check_due_watches, minute={0, 10, 20, 30, 40, 50})]
    max_jobs = 1
