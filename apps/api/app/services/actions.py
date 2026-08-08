from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PlanPatch, Trip
from app.domain.enums import Intent, PatchState
from app.domain.schemas import PlanSnapshot, TripSpecData
from app.services.planner import commit_plan
from app.services.trips import get_current_plan
from app.services.validator import validate_plan


class ItemActionError(RuntimeError):
    pass


def _find_target(plan: PlanSnapshot, message: str, scope: dict):
    item_id = scope.get("item_id")
    item_title = str(scope.get("item_title") or "")
    ordered = sorted(
        (item for day in plan.days for item in day.items if item.status == "PLANNED"),
        key=lambda item: item.start_at,
    )
    for item in ordered:
        if item.id == item_id or (item_title and item_title in item.title) or item.title in message:
            return item
    now = datetime.now(UTC)
    future = [item for item in ordered if item.end_at.astimezone(UTC) >= now]
    if "下一个" in message or "晚" in message or "延迟" in message:
        return (future or ordered)[0] if (future or ordered) else None
    return None


def _delay_minutes(message: str, scope: dict) -> int:
    if scope.get("minutes"):
        return max(1, min(int(scope["minutes"]), 720))
    match = re.search(r"(\d{1,3})\s*分钟", message)
    return max(1, min(int(match.group(1)), 720)) if match else 30


async def apply_natural_item_action(
    session: AsyncSession,
    trip: Trip,
    *,
    intent: Intent,
    message: str,
    scope: dict,
    idempotency_key: str,
) -> tuple[PlanPatch, int]:
    current = await get_current_plan(session, trip)
    if not current:
        raise ItemActionError("当前 Trip 还没有可执行计划。")
    proposed = PlanSnapshot.model_validate(current.model_dump(mode="json"))
    target = _find_target(proposed, message, scope)
    if not target:
        raise ItemActionError("无法确定你指的是哪个行程项，请说出地点名称。")

    operation: dict = {"item_id": target.id, "day_index": target.day_index, "payload": {}}
    if intent == Intent.COMPLETE_ITEM:
        target.status = "COMPLETED"
        operation["op"] = "COMPLETE"
    elif intent == Intent.SKIP_ITEM:
        if target.locked or target.reservation_state == "booked":
            raise ItemActionError("该项目已锁定或预约，不能直接跳过；请先让管家生成变更预览。")
        target.status = "SKIPPED"
        operation["op"] = "SKIP"
    elif intent == Intent.DELAY_ITEM:
        minutes = _delay_minutes(message, scope)
        day = next(day for day in proposed.days if day.day_index == target.day_index)
        affected = [item for item in day.items if item.start_at >= target.start_at]
        locked = [
            item.title
            for item in affected
            if item.id != target.id and (item.locked or item.reservation_state == "booked")
        ]
        if locked:
            raise ItemActionError(
                f"延迟会影响锁定或预约项目：{'、'.join(locked)}。需要先生成 PlanPatch 再由你决定。"
            )
        delta = timedelta(minutes=minutes)
        for item in affected:
            item.start_at += delta
            item.end_at += delta
        operation.update({"op": "UPDATE", "payload": {"delay_minutes": minutes}})
    else:
        raise ItemActionError(f"不支持的执行动作：{intent.value}")

    proposed = validate_plan(proposed, TripSpecData.model_validate(trip.trip_spec))
    patch = PlanPatch(
        trip_id=trip.id,
        base_version=trip.current_version,
        state=PatchState.APPLIED.value,
        scope={"day_index": target.day_index, "item_id": target.id},
        reason=f"旅行执行反馈：{message}",
        operations=[operation],
        impact={"changed_days": [target.day_index]},
        validation_result={"direct_structured_action": True},
        proposed_snapshot=proposed.model_dump(mode="json"),
        idempotency_key=idempotency_key,
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
    return patch, version.version
