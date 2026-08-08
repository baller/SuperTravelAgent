from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from app.domain.schemas import Conflict, PlanSnapshot, TripSpecData

PACE_LIMITS = {
    "轻松": {"places": 3, "walking_meters": 5000, "continuous_minutes": 150},
    "适中": {"places": 4, "walking_meters": 8000, "continuous_minutes": 210},
    "紧凑": {"places": 5, "walking_meters": 12000, "continuous_minutes": 240},
}


def validate_plan(plan: PlanSnapshot, spec: TripSpecData) -> PlanSnapshot:
    conflicts: list[Conflict] = []
    planned_place_terms = {
        term
        for day in plan.days
        for item in day.items
        for term in (
            item.title,
            item.place.name if item.place else None,
            item.place.district if item.place else None,
            item.place.address if item.place else None,
        )
        if term
    }
    must_visit = spec.must_visit.value if isinstance(spec.must_visit.value, list) else []
    for required in must_visit:
        required_text = str(required).strip()
        if not any(
            required_text in term or term in required_text
            for term in planned_place_terms
        ):
            conflicts.append(
                Conflict(
                    code="MUST_VISIT_MISSING",
                    level="blocking",
                    title="必去地点尚未安排",
                    detail=f"“{required}”没有进入当前计划，需要补充真实地点或由你决定取舍。",
                )
            )

    pace = str(spec.pace.value or "适中")
    limits = PACE_LIMITS.get(pace, PACE_LIMITS["适中"])
    for day in plan.days:
        major_items = [item for item in day.items if item.place and item.category != "休息"]
        if len(major_items) > limits["places"]:
            conflicts.append(
                Conflict(
                    code="DAY_TOO_DENSE",
                    level="warning",
                    title="当天安排偏密",
                    detail=f"第 {day.day_index} 天有 {len(major_items)} 个主要地点，超过“{pace}”节奏默认值。",
                    day_index=day.day_index,
                    item_ids=[item.id for item in major_items],
                )
            )
        walking = sum(leg.distance_meters for leg in day.route_legs if leg.mode == "walking")
        if walking > limits["walking_meters"]:
            conflicts.append(
                Conflict(
                    code="WALKING_LIMIT_EXCEEDED",
                    level="warning",
                    title="步行量超过偏好",
                    detail=f"第 {day.day_index} 天路线步行约 {walking / 1000:.1f} km，超过默认上限。",
                    day_index=day.day_index,
                )
            )
        ordered = sorted(day.items, key=lambda item: item.start_at)
        legs_by_pair = {
            (leg.origin_item_id, leg.destination_item_id): leg for leg in day.route_legs
        }
        for previous, current in zip(ordered, ordered[1:], strict=False):
            if current.start_at < previous.end_at:
                conflicts.append(
                    Conflict(
                        code="TIME_OVERLAP",
                        level="blocking",
                        title="行程时间重叠",
                        detail=f"{previous.title} 与 {current.title} 的时间发生重叠。",
                        day_index=day.day_index,
                        item_ids=[previous.id, current.id],
                    )
                )
            route = legs_by_pair.get((previous.id, current.id))
            if previous.place and current.place and route is None:
                conflicts.append(
                    Conflict(
                        code="ROUTE_MISSING",
                        level="blocking",
                        title="必要路线尚未取得",
                        detail=f"{previous.title} 到 {current.title} 缺少真实路线，计划不能标记为可出发。",
                        day_index=day.day_index,
                        item_ids=[previous.id, current.id],
                    )
                )
            required_buffer = 30 if current.reservation_state == "booked" else 15
            required_start = previous.end_at + timedelta(
                minutes=(route.duration_minutes if route else 0) + required_buffer
            )
            if route and current.start_at < required_start:
                conflicts.append(
                    Conflict(
                        code="ROUTE_TIME_CONFLICT",
                        level="blocking",
                        title="交通时间无法衔接",
                        detail=(
                            f"按真实路线从 {previous.title} 到 {current.title} 需要 "
                            f"{route.duration_minutes} 分钟，当前时间不足。"
                        ),
                        day_index=day.day_index,
                        item_ids=[previous.id, current.id],
                    )
                )
            if current.start_at < previous.end_at + timedelta(minutes=required_buffer):
                conflicts.append(
                    Conflict(
                        code="BUFFER_TOO_SHORT",
                        level="warning",
                        title="活动缓冲不足",
                        detail=f"{previous.title} 与 {current.title} 之间少于 {required_buffer} 分钟缓冲。",
                        day_index=day.day_index,
                        item_ids=[previous.id, current.id],
                    )
                )
        for item in day.items:
            duration_minutes = int((item.end_at - item.start_at).total_seconds() / 60)
            if duration_minutes > limits["continuous_minutes"]:
                conflicts.append(
                    Conflict(
                        code="CONTINUOUS_ACTIVITY_TOO_LONG",
                        level="warning",
                        title="连续活动时间过长",
                        detail=f"{item.title} 连续约 {duration_minutes} 分钟，超过“{pace}”节奏建议。",
                        day_index=day.day_index,
                        item_ids=[item.id],
                    )
                )
            if item.opening_state != "verified":
                conflicts.append(
                    Conflict(
                        code="OPENING_UNVERIFIED",
                        level="warning",
                        title="营业信息待核验",
                        detail=f"{item.title} 的开放时间尚无可靠实时来源。",
                        day_index=day.day_index,
                        item_ids=[item.id],
                    )
                )

    known_total = sum(
        (item.cost_cny or Decimal("0")) for day in plan.days for item in day.items if item.cost_cny is not None
    )
    unknown_count = sum(1 for day in plan.days for item in day.items if item.cost_cny is None)
    if spec.budget_mode == "hard" and spec.budget.value is not None and known_total > Decimal(str(spec.budget.value)):
        conflicts.append(
            Conflict(
                code="HARD_BUDGET_EXCEEDED",
                level="blocking",
                title="已知费用超过硬预算",
                detail=f"已知费用 ¥{known_total} 已超过预算上限 ¥{spec.budget.value}，且仍有 {unknown_count} 项未知。",
            )
        )
    plan.conflicts = conflicts
    plan.known_cost_cny = known_total
    plan.unknown_cost_items = unknown_count
    return plan


def has_blocking_conflicts(plan: PlanSnapshot) -> bool:
    return any(item.level == "blocking" for item in plan.conflicts)
