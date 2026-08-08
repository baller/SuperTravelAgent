from __future__ import annotations

import re
from typing import Any

from app.domain.enums import ConversationStage, FieldState, PlanReadinessLevel
from app.domain.schemas import PlanningGap, PlanReadiness, TripSpecData


def _has_value(field: Any) -> bool:
    value = getattr(field, "value", None)
    return value is not None and value != "" and value != []


def _known(field: Any) -> bool:
    return _has_value(field) and getattr(field, "state", FieldState.MISSING) not in {
        FieldState.MISSING,
        FieldState.CONFLICTED,
    }


def derive_plan_readiness(spec: TripSpecData) -> PlanReadiness:
    """Separate a useful local draft from an executable door-to-door plan.

    This is intentionally deterministic. The model may explain the result,
    but it cannot turn an optional field into a hard planning blocker.
    """

    blockers: list[PlanningGap] = []
    executable: list[PlanningGap] = []
    optional: list[PlanningGap] = []
    assumptions: dict[str, Any] = {}
    reason_codes: list[str] = []

    if not _known(spec.destination):
        blockers.append(PlanningGap(code="destination", label="目的地", blocking=True, reason="还无法确定要规划的区域"))
        reason_codes.append("destination_missing")

    has_date_range = (
        _has_value(spec.start_date)
        and _has_value(spec.end_date)
        and spec.start_date.state in {FieldState.CONFIRMED, FieldState.INFERRED}
        and spec.end_date.state in {FieldState.CONFIRMED, FieldState.INFERRED}
    )
    has_duration = _known(spec.duration_days) and int(spec.duration_days.value or 0) > 0
    if not has_date_range and not has_duration:
        blockers.append(
            PlanningGap(code="duration_or_date_range", label="大致天数或日期范围", blocking=True, reason="没有天数就无法组织逐日草案")
        )
        reason_codes.append("duration_missing")
    elif not has_date_range:
        assumptions["date_range"] = "暂按用户提供的月份或相对时间安排，具体日期稍后补充"
        executable.append(
            PlanningGap(code="exact_dates", label="具体日期", reason="会影响天气、开放时间和交通核验，但不阻塞当地草案")
        )

    if spec.travelers.state == FieldState.CONFLICTED:
        blockers.append(PlanningGap(code="travelers_conflict", label="同行人", blocking=True, reason="同行人信息存在冲突"))
        reason_codes.append("traveler_conflict")
    elif not _known(spec.travelers):
        assumptions["travelers"] = "暂按普通成年旅行者安排"
        optional.append(PlanningGap(code="travelers", label="同行人详情", reason="可以先按普通成年旅行者生成草案"))

    if spec.traveler_requirements.state == FieldState.CONFLICTED:
        blockers.append(
            PlanningGap(code="traveler_requirements_conflict", label="同行硬约束", blocking=True, reason="已提到的特殊需求尚未明确")
        )
        reason_codes.append("traveler_requirement_conflict")
    elif not _known(spec.traveler_requirements):
        optional.append(PlanningGap(code="traveler_requirements", label="体力、饮食或无障碍需求", reason="没有已知特殊需求时不阻塞初稿"))

    if not _known(spec.planning_scope):
        assumptions["planning_scope"] = "先规划目的地当地行程"
        optional.append(PlanningGap(code="planning_scope", label="规划范围", reason="门到门交通可以后续补充"))
    elif spec.planning_scope.value == "door_to_door" and not _known(spec.origin):
        executable.append(PlanningGap(code="origin", label="出发城市", reason="只阻塞门到门交通，不阻塞当地行程草案"))

    if not _known(spec.budget):
        assumptions["budget"] = "暂不设硬预算，先做路线结构和花费类型估算"
        optional.append(PlanningGap(code="budget", label="预算", reason="预算不是当地初稿的阻塞项"))
    if spec.pace.state not in {FieldState.CONFIRMED, FieldState.ASSUMED}:
        assumptions["pace"] = "中等偏轻松"
        optional.append(PlanningGap(code="pace", label="旅行节奏", reason="先使用中等偏轻松默认值"))

    if blockers:
        level = PlanReadinessLevel.NOT_READY if not _known(spec.destination) else PlanReadinessLevel.ORIENTABLE
    elif not has_date_range and not has_duration:
        level = PlanReadinessLevel.ORIENTABLE
    elif executable:
        level = PlanReadinessLevel.DRAFTABLE
    else:
        level = PlanReadinessLevel.EXECUTABLE

    if level == PlanReadinessLevel.DRAFTABLE:
        reason_codes.append("local_draft_ready")
    if level == PlanReadinessLevel.EXECUTABLE:
        reason_codes.append("execution_ready")

    return PlanReadiness(
        level=level,
        draft_blockers=blockers,
        executable_gaps=executable,
        optional_gaps=optional,
        assumptions_available=assumptions,
        reason_codes=reason_codes,
    )


def blocking_gap_labels(readiness: PlanReadiness) -> list[str]:
    return [item.label for item in readiness.draft_blockers]


def assumption_permission_from_message(message: str) -> bool:
    """Return True only for explicit permission to choose defaults.

    Hesitation ("不确定", "先看看") is not permission. Treating it as
    permission made the agent silently assume dates, budget and pace while
    still presenting a question to the user.
    """
    patterns = (
        "你看着安排",
        "你来安排",
        "先给我一个版本",
        "先规划",
        "先排出来",
        "先按推荐",
        "按推荐先",
        "随便安排",
        "你随便安排",
        "你先推荐",
        "先推荐",
        "就按这个",
        "按这个",
        "开始规划",
        "按一般",
        "按普通成年人",
        "别太赶",
        "你决定",
    )
    return any(pattern in message for pattern in patterns) or bool(
        re.search(r"按[^，。！？]{0,12}(?:版|方案)?排(?:出来|一下|一版)", message)
    )


def assumption_permission_revoked_by_message(message: str) -> bool:
    """Detect an explicit request to stop or take back defaulting authority."""

    patterns = (
        "不要替我决定",
        "别替我决定",
        "我自己决定",
        "先别安排",
        "先不要规划",
        "还没决定",
        "我再想想",
        "等我确认",
    )
    return any(pattern in message for pattern in patterns)


def stage_for(spec: TripSpecData, *, has_plan: bool = False, waiting_review: bool = False) -> ConversationStage:
    if has_plan:
        return ConversationStage.PLAN_ACTIVE
    if waiting_review:
        return ConversationStage.DRAFT_REVIEW
    readiness = derive_plan_readiness(spec)
    if readiness.level == PlanReadinessLevel.NOT_READY:
        return ConversationStage.DISCOVERY
    if readiness.level == PlanReadinessLevel.ORIENTABLE:
        return ConversationStage.BRIEFING
    if readiness.level in {PlanReadinessLevel.DRAFTABLE, PlanReadinessLevel.EXECUTABLE}:
        return ConversationStage.PREFERENCE
    return ConversationStage.DISCOVERY


def normalize_topic(component_type: str | None, action_type: str | None) -> str | None:
    if component_type:
        return re.sub(r"_+", "_", component_type).strip("_")
    return action_type if action_type == "ask_user" else None
