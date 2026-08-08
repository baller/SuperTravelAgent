from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agent.policy import derive_plan_readiness
from app.core.config import get_settings
from app.db.models import ConversationThread, DecisionRequest, PlanVersion, Trip
from app.domain.enums import FieldState, PlanReadinessLevel, TripLifecycle, TripPulse
from app.domain.schemas import Conflict, PlanSnapshot, TripDetail, TripSpecData, TripSummary


def default_trip_spec() -> TripSpecData:
    return TripSpecData()


def _display_name(value: object) -> str:
    if isinstance(value, dict):
        for key in ("name", "city", "district", "label"):
            candidate = value.get(key)
            if candidate:
                return str(candidate).strip()
        return ""
    return str(value).strip() if value is not None else ""


def _traveler_label(value: str) -> str:
    labels = {
        "mother": "妈妈",
        "mom": "妈妈",
        "mum": "妈妈",
        "father": "爸爸",
        "dad": "爸爸",
        "parents": "父母",
        "partner": "伴侣",
        "spouse": "伴侣",
        "friend": "朋友",
        "child": "孩子",
    }
    return labels.get(value.lower(), value)


def derive_title(spec: TripSpecData, fallback: str = "未命名旅程") -> str:
    destination = _display_name(spec.destination.value)
    travelers = spec.travelers.value
    if destination and isinstance(travelers, list) and travelers:
        relations = [
            _display_name(item.get("relation") or item.get("name"))
            for item in travelers
            if isinstance(item, dict)
        ]
        self_labels = {"自己", "我", "self", "me", "user"}
        companion = next(
            (_traveler_label(item) for item in relations if item and item.lower() not in self_labels),
            None,
        )
        title = f"和{companion}去{destination}" if companion else f"去{destination}"
    elif destination:
        title = f"去{destination}"
    else:
        title = fallback
    return title[:200]


def compute_pulse(trip: Trip, plan: PlanSnapshot | None) -> TripPulse:
    if trip.lifecycle == TripLifecycle.COMPLETED.value:
        return TripPulse.COMPLETED
    if trip.lifecycle == TripLifecycle.IN_TRIP.value:
        return TripPulse.IN_TRIP
    if plan:
        if any(item.level == "blocking" for item in plan.conflicts):
            return TripPulse.BLOCKED
        if any(item.level == "warning" for item in plan.conflicts):
            return TripPulse.ATTENTION
    if trip.lifecycle == TripLifecycle.READY.value:
        return TripPulse.READY
    if trip.lifecycle == TripLifecycle.REVIEWING.value:
        return TripPulse.AWAITING_REVIEW
    spec = TripSpecData.model_validate(trip.trip_spec or {})
    if derive_plan_readiness(spec).level in {PlanReadinessLevel.NOT_READY, PlanReadinessLevel.ORIENTABLE}:
        return TripPulse.NEEDS_INPUT
    return TripPulse.PREPARING


async def create_trip(session: AsyncSession, title: str | None = None) -> tuple[Trip, ConversationThread]:
    settings = get_settings()
    spec = default_trip_spec()
    trip = Trip(
        user_id=UUID(settings.default_user_id),
        title=title or "未命名旅程",
        lifecycle=TripLifecycle.DRAFT.value,
        pulse=TripPulse.PREPARING.value,
        trip_spec=spec.model_dump(mode="json"),
    )
    session.add(trip)
    await session.flush()
    thread = ConversationThread(trip_id=trip.id, title="新对话", status="ACTIVE")
    session.add(thread)
    await session.commit()
    await session.refresh(trip)
    await session.refresh(thread)
    return trip, thread


async def get_trip_model(
    session: AsyncSession,
    trip_id: UUID,
    *,
    for_update: bool = False,
) -> Trip | None:
    statement = select(Trip).where(Trip.id == trip_id, Trip.archived.is_(False))
    if for_update:
        statement = statement.with_for_update()
    return await session.scalar(statement)


async def get_current_plan(session: AsyncSession, trip: Trip) -> PlanSnapshot | None:
    if trip.current_version < 1:
        return None
    row = await session.scalar(
        select(PlanVersion).where(PlanVersion.trip_id == trip.id, PlanVersion.version == trip.current_version)
    )
    return PlanSnapshot.model_validate(row.snapshot) if row else None


async def list_trips(session: AsyncSession) -> list[TripSummary]:
    trips = (
        await session.scalars(
            select(Trip)
            .where(Trip.archived.is_(False))
            .options(selectinload(Trip.versions))
            .order_by(Trip.updated_at.desc())
        )
    ).all()
    result: list[TripSummary] = []
    for trip in trips:
        plan = await get_current_plan(session, trip)
        pending = await session.scalar(
            select(func.count(DecisionRequest.id)).where(
                DecisionRequest.trip_id == trip.id, DecisionRequest.state == "OPEN"
            )
        )
        pulse = compute_pulse(trip, plan)
        result.append(
            TripSummary(
                id=trip.id,
                title=trip.title,
                category=trip.category or "未分类",
                lifecycle=TripLifecycle(trip.lifecycle),
                pulse=pulse,
                current_version=trip.current_version,
                trip_spec=TripSpecData.model_validate(trip.trip_spec),
                updated_at=trip.updated_at,
                pending_decisions=pending or 0,
            )
        )
    return result


async def trip_detail(session: AsyncSession, trip: Trip) -> TripDetail:
    plan = await get_current_plan(session, trip)
    pending = await session.scalar(
        select(func.count(DecisionRequest.id)).where(
            DecisionRequest.trip_id == trip.id, DecisionRequest.state == "OPEN"
        )
    )
    return TripDetail(
        id=trip.id,
        title=trip.title,
        category=trip.category or "未分类",
        lifecycle=TripLifecycle(trip.lifecycle),
        pulse=compute_pulse(trip, plan),
        current_version=trip.current_version,
        trip_spec=TripSpecData.model_validate(trip.trip_spec),
        current_plan=plan,
        created_at=trip.created_at,
        updated_at=trip.updated_at,
        pending_decisions=pending or 0,
    )


def set_spec_value(
    spec: TripSpecData,
    field: str,
    value: object,
    state: FieldState = FieldState.CONFIRMED,
    source: str = "user",
) -> None:
    field_value = getattr(spec, field)
    field_value.value = value
    field_value.state = state
    field_value.source = source


def recalculate_dates(spec: TripSpecData) -> None:
    try:
        if spec.start_date.value and spec.end_date.value:
            start = date.fromisoformat(str(spec.start_date.value))
            end = date.fromisoformat(str(spec.end_date.value))
            days = (end - start).days + 1
            if days > 0:
                set_spec_value(spec, "duration_days", days, FieldState.INFERRED, "date_range")
    except ValueError:
        spec.start_date.state = FieldState.CONFLICTED
        spec.end_date.state = FieldState.CONFLICTED


async def save_trip_spec(session: AsyncSession, trip: Trip, spec: TripSpecData) -> Trip:
    recalculate_dates(spec)
    trip.trip_spec = spec.model_dump(mode="json")
    trip.title = derive_title(spec, trip.title)
    trip.lifecycle = (
        TripLifecycle.RESEARCHING.value
        if derive_plan_readiness(spec).level in {PlanReadinessLevel.DRAFTABLE, PlanReadinessLevel.EXECUTABLE}
        else TripLifecycle.CLARIFYING.value
    )
    trip.pulse = compute_pulse(trip, None).value
    trip.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(trip)
    return trip


async def invalidate_destination_dependent_state(
    session: AsyncSession,
    trip: Trip,
    spec: TripSpecData,
    *,
    previous_destination: str,
    new_destination: str,
) -> None:
    """Detach an old city's plan and constraints before accepting a new city.

    Historical PlanVersion rows remain immutable.  A new empty version becomes
    current so no stale POI can continue to appear under the new destination.
    """

    set_spec_value(spec, "must_visit", [], FieldState.MISSING, "destination_changed")
    set_spec_value(spec, "avoid", [], FieldState.MISSING, "destination_changed")
    spec.tickets = []
    spec.constraints = []
    spec.assumptions = [
        item
        for item in spec.assumptions
        if previous_destination not in item
    ]
    if trip.current_version > 0:
        next_version = trip.current_version + 1
        snapshot = PlanSnapshot(
            days=[],
            conflicts=[
                Conflict(
                    code="DESTINATION_CHANGED",
                    level="blocking",
                    title="目的地已切换，旧计划已停止使用",
                    detail=(
                        f"当前目的地已从{previous_destination}改为{new_destination}。"
                        "旧地点仍保留在历史版本中，但不会再显示为当前行程。"
                    ),
                )
            ],
            generated_at=datetime.now(UTC),
            source_summary=["目的地切换保护"],
        )
        session.add(
            PlanVersion(
                trip_id=trip.id,
                version=next_version,
                snapshot=snapshot.model_dump(mode="json"),
                reason=f"目的地从{previous_destination}切换为{new_destination}，失效旧计划",
            )
        )
        trip.current_version = next_version
    trip.lifecycle = TripLifecycle.CLARIFYING.value
    trip.pulse = TripPulse.NEEDS_INPUT.value
    trip.trip_spec = spec.model_dump(mode="json")
    trip.updated_at = datetime.now(UTC)
    await session.commit()
