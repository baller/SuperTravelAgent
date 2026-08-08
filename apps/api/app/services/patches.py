from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.llm import PatchProposal, llm_client
from app.db.models import PlanPatch, PlanVersion, Trip
from app.domain.enums import PatchState
from app.domain.schemas import (
    Coordinates,
    ItineraryItem,
    PatchImpact,
    PatchOperation,
    Place,
    PlanPatchData,
    PlanSnapshot,
    TripSpecData,
)
from app.services.events import event_broker
from app.services.planner import _destination, _route, commit_plan
from app.services.trips import get_current_plan
from app.services.validator import validate_plan
from app.tools.mcp_client import ToolGatewayError, tool_gateway


class PatchError(RuntimeError):
    pass


class VersionConflictError(PatchError):
    pass


SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


def _find_item(plan: PlanSnapshot, item_id: str) -> tuple[int, int, ItineraryItem] | None:
    for day_index, day in enumerate(plan.days):
        for item_index, item in enumerate(day.items):
            if item.id == item_id:
                return day_index, item_index, item
    return None


def _protected(item: ItineraryItem) -> bool:
    return item.locked or item.status == "COMPLETED" or item.reservation_state == "booked"


async def _rebuild_day_routes(
    session: AsyncSession,
    run_id: UUID,
    trip: Trip,
    thread_id: UUID,
    plan: PlanSnapshot,
    day_index: int,
) -> None:
    day = plan.days[day_index]
    day.items.sort(key=lambda value: value.start_at)
    day.route_legs = []
    city, _ = _destination(TripSpecData.model_validate(trip.trip_spec))
    for previous, current in zip(day.items, day.items[1:], strict=False):
        leg = await _route(session, run_id, trip.id, thread_id, previous, current, city)
        if leg:
            day.route_legs.append(leg)
            earliest = previous.end_at + timedelta(minutes=leg.duration_minutes + 15)
            if current.start_at < earliest:
                duration = current.end_at - current.start_at
                current.start_at = earliest
                current.end_at = earliest + duration


async def propose_natural_language_patch(
    session: AsyncSession,
    trip: Trip,
    run_id: UUID,
    thread_id: UUID,
    message: str,
    proposal_data: dict | None = None,
) -> PlanPatch:
    current = await get_current_plan(session, trip)
    if not current:
        raise PatchError("当前 Trip 还没有可修改的计划。")
    await event_broker.publish(
        session,
        "context.compiled",
        {
            "title": "装配局部修改上下文",
            "input": {"request_chars": len(message)},
            "output": {
                "sections": ["current_request", "trip_spec", "current_plan"],
                "base_version": trip.current_version,
                "day_count": len(current.days),
                "protected_items": [
                    item.title for day in current.days for item in day.items if _protected(item)
                ],
            },
            "meta": {"scope_policy": "patch-only", "raw_system_prompt_exposed": False},
        },
        trip_id=trip.id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    if proposal_data is not None:
        proposal = PatchProposal.model_validate(proposal_data)
    else:
        # Compatibility fallback for direct service callers. The dynamic Agent
        # Loop supplies its already validated proposal and avoids a hidden
        # second decision model call.
        proposal_call = await llm_client.patch_proposal(
            message,
            trip.trip_spec,
            current.model_dump(mode="json"),
        )
        proposal = proposal_call.value
    if not proposal.instructions:
        raise PatchError("修改范围仍不明确，请指出具体日期或时间段。")

    proposed = PlanSnapshot.model_validate(current.model_dump(mode="json"))
    operations: list[PatchOperation] = []
    impact = PatchImpact()
    touched_days: set[int] = set()
    protected: list[str] = []

    for instruction in proposal.instructions:
        if instruction.action == "ADD_REST":
            target_day = instruction.target_day or int(proposal.scope.get("day_index") or 1)
            if not 1 <= target_day <= len(proposed.days):
                continue
            day = proposed.days[target_day - 1]
            start = day.items[-1].end_at + timedelta(minutes=15) if day.items else datetime.combine(
                day.date, datetime.min.time(), tzinfo=SHANGHAI_TZ
            ) + timedelta(hours=10)
            rest = ItineraryItem(
                id=str(uuid4()),
                day_index=target_day,
                start_at=start,
                end_at=start + timedelta(minutes=60),
                title="休息与机动时间",
                category="休息",
                place=None,
                reason="根据本次修改增加休息，降低连续活动强度。",
                source="user_request",
                observed_at=datetime.now(UTC),
                opening_state="unavailable",
            )
            day.items.append(rest)
            touched_days.add(target_day - 1)
            operations.append(PatchOperation(op="ADD", day_index=target_day, payload=rest.model_dump(mode="json")))
            impact.added.append(rest.title)
            continue
        if not instruction.item_id:
            continue
        located = _find_item(proposed, instruction.item_id)
        if not located:
            continue
        source_day_index, item_index, item = located
        if _protected(item):
            protected.append(item.title)
            continue
        touched_days.add(source_day_index)
        if instruction.action == "REMOVE":
            proposed.days[source_day_index].items.pop(item_index)
            operations.append(PatchOperation(op="REMOVE", item_id=item.id, day_index=source_day_index + 1))
            impact.removed.append(item.title)
        elif instruction.action == "REPLACE" and instruction.replacement_keyword:
            city, _ = _destination(TripSpecData.model_validate(trip.trip_spec))
            result = await tool_gateway.call_baidu_map(
                session,
                run_id,
                trip.id,
                thread_id,
                "map_search_places",
                {"query": instruction.replacement_keyword, "region": city, "limit": 5},
            )
            existing_place_ids = {
                existing.place.provider_place_id
                for day_value in proposed.days
                for existing in day_value.items
                if existing.place
            }
            candidates = [
                candidate
                for candidate in (result.data or [])
                if str(candidate.get("provider_place_id")) not in existing_place_ids
            ]
            if not candidates:
                raise ToolGatewayError(
                    f"百度地图没有找到“{instruction.replacement_keyword}”，不能用虚构地点替换。"
                )
            candidate = candidates[0]
            duration = item.end_at - item.start_at
            replacement = ItineraryItem(
                id=str(uuid4()),
                day_index=item.day_index,
                start_at=item.start_at,
                end_at=item.start_at + duration,
                title=str(candidate["name"]),
                category=str(candidate.get("category") or "替代活动"),
                place=Place(
                    provider_place_id=str(candidate["provider_place_id"]),
                    name=str(candidate["name"]),
                    city=candidate.get("city") or city,
                    district=candidate.get("district"),
                    address=candidate.get("address"),
                    category=candidate.get("category"),
                    coordinates=Coordinates.model_validate(candidate["coordinates"]),
                    source=result.source,
                    observed_at=result.retrieved_at,
                ),
                reason=f"根据用户要求，以百度地图真实地点替换 {item.title}。",
                source="baidu-map + user_request",
                observed_at=result.retrieved_at,
                opening_state="unverified",
            )
            proposed.days[source_day_index].items[item_index] = replacement
            operations.append(
                PatchOperation(
                    op="REPLACE",
                    item_id=item.id,
                    day_index=source_day_index + 1,
                    payload={
                        "replacement_item": replacement.model_dump(mode="json"),
                        "keyword": instruction.replacement_keyword,
                    },
                )
            )
            impact.removed.append(item.title)
            impact.added.append(replacement.title)
        elif instruction.action in {"MOVE", "UPDATE"}:
            if instruction.target_start_time:
                hour, minute = map(int, instruction.target_start_time.split(":", 1))
                duration = item.end_at - item.start_at
                item.start_at = item.start_at.replace(hour=hour, minute=minute)
                item.end_at = item.start_at + duration
            for key, value in instruction.updates.items():
                if key in {"reason", "category"}:
                    setattr(item, key, value)
            operations.append(
                PatchOperation(
                    op="MOVE" if instruction.action == "MOVE" else "UPDATE",
                    item_id=item.id,
                    day_index=source_day_index + 1,
                    payload=instruction.model_dump(mode="json"),
                )
            )
            impact.moved.append(item.title)

    if not operations:
        if protected:
            raise PatchError(f"请求会影响受保护项目：{'、'.join(protected)}。请调整修改范围。")
        raise PatchError("没有生成可验证的局部修改。")
    for index in touched_days:
        await _rebuild_day_routes(session, run_id, trip, thread_id, proposed, index)
    proposed = validate_plan(proposed, TripSpecData.model_validate(trip.trip_spec))
    impact.changed_days = sorted(index + 1 for index in touched_days)
    impact.protected = protected
    validation = {
        "blocking": [item.model_dump(mode="json") for item in proposed.conflicts if item.level == "blocking"],
        "warnings": [item.model_dump(mode="json") for item in proposed.conflicts if item.level == "warning"],
    }
    await event_broker.publish(
        session,
        "validation.completed",
        {
            "title": "校验局部变更",
            "summary": f"校验 {len(operations)} 个操作，发现 {len(validation['blocking'])} 个阻断和 {len(validation['warnings'])} 个警告。",
            "input": {
                "base_version": trip.current_version,
                "changed_days": sorted(index + 1 for index in touched_days),
                "operation_count": len(operations),
            },
            "output": validation,
            "meta": {"protected_items": protected, "validator": "deterministic", "model_can_override": False},
        },
        trip_id=trip.id,
        thread_id=thread_id,
        run_id=run_id,
        commit=False,
    )
    row = PlanPatch(
        trip_id=trip.id,
        run_id=run_id,
        base_version=trip.current_version,
        scope=proposal.scope,
        reason=proposal.reason,
        operations=[item.model_dump(mode="json") for item in operations],
        impact=impact.model_dump(mode="json"),
        validation_result=validation,
        proposed_snapshot=proposed.model_dump(mode="json"),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


def patch_data(row: PlanPatch) -> PlanPatchData:
    return PlanPatchData(
        id=row.id,
        trip_id=row.trip_id,
        base_version=row.base_version,
        state=PatchState(row.state),
        scope=row.scope,
        reason=row.reason,
        operations=[PatchOperation.model_validate(item) for item in row.operations],
        impact=PatchImpact.model_validate(row.impact),
        validation_result=row.validation_result,
        created_at=row.created_at,
    )


async def apply_patch(
    session: AsyncSession,
    patch_id: UUID,
    idempotency_key: str,
) -> tuple[Trip, PlanVersion]:
    row = await session.scalar(select(PlanPatch).where(PlanPatch.id == patch_id).with_for_update())
    if not row:
        raise PatchError("变更不存在。")
    if row.state == PatchState.APPLIED.value:
        version = await session.scalar(select(PlanVersion).where(PlanVersion.source_patch_id == row.id))
        trip = await session.get(Trip, row.trip_id)
        if trip and version:
            return trip, version
        raise PatchError("已应用变更缺少对应版本。")
    if row.state != PatchState.PREVIEW.value:
        raise PatchError("该变更已经失效或被拒绝。")
    trip = await session.scalar(select(Trip).where(Trip.id == row.trip_id).with_for_update())
    if not trip:
        raise PatchError("Trip 不存在。")
    if trip.current_version != row.base_version:
        row.state = PatchState.EXPIRED.value
        await session.commit()
        raise VersionConflictError("Trip 已产生新版本，请重新计算本次变更。")
    if not row.proposed_snapshot:
        raise PatchError("变更缺少可提交快照。")
    row.idempotency_key = idempotency_key
    version = await commit_plan(
        session,
        trip,
        PlanSnapshot.model_validate(row.proposed_snapshot),
        reason=row.reason,
        source_patch_id=row.id,
    )
    row.state = PatchState.APPLIED.value
    await session.commit()
    return trip, version


async def reject_patch(session: AsyncSession, patch_id: UUID) -> PlanPatch:
    row = await session.get(PlanPatch, patch_id)
    if not row:
        raise PatchError("变更不存在。")
    if row.state == PatchState.PREVIEW.value:
        row.state = PatchState.REJECTED.value
        await session.commit()
    return row


async def restore_version(
    session: AsyncSession,
    trip: Trip,
    version: int,
    idempotency_key: str,
) -> PlanVersion:
    existing = await session.scalar(select(PlanPatch).where(PlanPatch.idempotency_key == idempotency_key))
    if existing and existing.state == PatchState.APPLIED.value:
        row = await session.scalar(select(PlanVersion).where(PlanVersion.source_patch_id == existing.id))
        if row:
            return row
    source = await session.scalar(
        select(PlanVersion).where(PlanVersion.trip_id == trip.id, PlanVersion.version == version)
    )
    if not source:
        raise PatchError("目标历史版本不存在。")
    patch = PlanPatch(
        trip_id=trip.id,
        base_version=trip.current_version,
        state=PatchState.APPLIED.value,
        scope={"restore_version": version},
        reason=f"恢复历史版本 V{version}",
        operations=[{"op": "UPDATE", "payload": {"restore_version": version}}],
        impact={"changed_days": [day["day_index"] for day in source.snapshot.get("days", [])]},
        validation_result={"restored": True},
        proposed_snapshot=source.snapshot,
        idempotency_key=idempotency_key,
    )
    session.add(patch)
    await session.flush()
    row = await commit_plan(
        session,
        trip,
        PlanSnapshot.model_validate(source.snapshot),
        reason=patch.reason,
        source_patch_id=patch.id,
    )
    return row
