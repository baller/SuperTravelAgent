from app.agent.loop import _enforce_interaction_policy
from app.agent.policy import (
    assumption_permission_from_message,
    assumption_permission_revoked_by_message,
    derive_plan_readiness,
    stage_for,
)
from app.domain.enums import ConversationStage, FieldState, Intent, PlanReadinessLevel
from app.domain.schemas import AgentAction, FieldValue, TripSpecData


def _field(value, state=FieldState.CONFIRMED):
    return FieldValue(value=value, state=state)


def test_destination_and_duration_are_enough_for_a_local_draft():
    spec = TripSpecData(
        destination=_field("云南", FieldState.INFERRED),
        duration_days=_field(7),
        travelers=_field([{"name": "我"}, {"name": "同行人", "relation": "伴侣"}]),
    )

    readiness = derive_plan_readiness(spec)

    assert readiness.level == PlanReadinessLevel.DRAFTABLE
    assert readiness.draft_blockers == []
    assert {gap.code for gap in readiness.executable_gaps} == {"exact_dates"}
    assert "origin" not in {gap.code for gap in readiness.draft_blockers}


def test_destination_without_duration_can_be_explained_but_not_drafted():
    readiness = derive_plan_readiness(TripSpecData(destination=_field("云南")))

    assert readiness.level == PlanReadinessLevel.ORIENTABLE
    assert [gap.code for gap in readiness.draft_blockers] == ["duration_or_date_range"]


def test_door_to_door_origin_is_an_executable_gap_only():
    spec = TripSpecData(
        destination=_field("杭州"),
        start_date=_field("2026-10-01"),
        end_date=_field("2026-10-04"),
        planning_scope=_field("door_to_door"),
    )

    readiness = derive_plan_readiness(spec)

    assert readiness.level == PlanReadinessLevel.DRAFTABLE
    assert {gap.code for gap in readiness.executable_gaps} == {"origin"}
    assert readiness.draft_blockers == []


def test_assumption_permission_is_explicit_and_narrow():
    assert assumption_permission_from_message("你先按轻松版排出来")
    assert assumption_permission_from_message("预算随便，先给我一个版本")
    assert not assumption_permission_from_message("我想去云南")
    assert not assumption_permission_from_message("我还不确定，先看看")
    assert assumption_permission_revoked_by_message("我还没决定，先别安排")


def test_stage_follows_readiness_and_does_not_require_a_plan_version():
    spec = TripSpecData(destination=_field("大理"), duration_days=_field(7))

    assert stage_for(spec) == ConversationStage.PREFERENCE
    assert stage_for(spec, has_plan=True) == ConversationStage.PLAN_ACTIVE


def test_interaction_policy_formats_planning_gap_models_after_question_budget():
    spec = TripSpecData(destination=_field("焦作"))
    readiness = derive_plan_readiness(spec)
    action = AgentAction(
        type="ask_user",
        intent=Intent.PLAN_ITINERARY,
        public_progress="确认旅行天数",
        question_topic="duration",
        component={
            "type": "quick_choice",
            "title": "确认大致天数",
            "prompt": "选择一个范围即可。",
            "props": {"options": []},
        },
    )

    result = _enforce_interaction_policy(
        {
            "context": {
                "conversation_state": {
                    "consecutive_question_turns": 2,
                    "asked_topics": [],
                    "assumption_permission": False,
                }
            }
        },
        action,
        readiness.model_dump(mode="json"),
        planning_task=True,
    )

    assert result.type == "respond"
    assert "大致天数或日期范围" in (result.response_outline or "")
