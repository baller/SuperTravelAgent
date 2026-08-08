import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from mcp_servers.baidu.server import normalize_place, normalize_routes, tool_result
from sqlalchemy.exc import IntegrityError

from app.agent.llm import ExtractedTripRequest, _normalize_json_response
from app.agent.loop import (
    _compact,
    _component_defaults,
    _default_selected_candidates,
    _deterministic_initial_schedule,
    _place_candidates_component,
    _planning_gap_component,
    _route_point,
    _source_free_destination_orientation,
    route_validated_patch,
)
from app.api.agent import _public_run_error, _validate_component_payload
from app.domain.enums import FieldState, PatchState
from app.domain.schemas import (
    AgentAction,
    Coordinates,
    FieldValue,
    ItineraryItem,
    Place,
    PlanSnapshot,
    RouteLeg,
    ToolResult,
    TripDay,
    TripSpecData,
)
from app.services.memory import chunk_text
from app.services.patches import _protected
from app.services.planner import _candidate_matches_destination
from app.services.trips import derive_title
from app.services.validator import has_blocking_conflicts, validate_plan
from app.tools.mcp_client import MCPToolGateway, ToolGatewayError, tool_gateway
from app.workers.watch_worker import next_interval, weather_impacts

NOW = datetime(2026, 10, 2, 9, tzinfo=UTC)


def test_source_free_destination_orientation_does_not_claim_live_facts() -> None:
    answer = _source_free_destination_orientation(
        {"trip_spec": {"destination": {"value": "焦作"}}}
    )
    assert "焦作" in answer
    assert "开放时间" in answer
    assert "气温" in answer
    assert "具体耗时" in answer


def test_tool_cache_policy_uses_long_lived_fact_ttls() -> None:
    assert MCPToolGateway._cache_ttl("baidu-map", "map_geocode") == 30 * 24 * 60 * 60
    assert MCPToolGateway._cache_ttl("baidu-map", "map_search_places") == 7 * 24 * 60 * 60
    assert MCPToolGateway._cache_ttl("xiaohongshu", "xhs_get_note_content") == 24 * 60 * 60
    assert MCPToolGateway._cache_ttl("community-12306", "query-tickets") == 15 * 60
    assert MCPToolGateway._normalize_arguments({"query": "  西湖  "}) == {"query": "西湖"}


def test_weather_watch_waits_until_forecast_window() -> None:
    trip = SimpleNamespace(
        lifecycle="READY",
        trip_spec={"start_date": {"value": (datetime.now(UTC).date() + timedelta(days=8)).isoformat()}},
    )
    assert next_interval(trip) == timedelta(days=3)


def test_route_point_normalizes_baidu_coordinate_order() -> None:
    assert _route_point("120.21949381238632,30.2967714130865") == (
        "30.2967714130865,120.21949381238632"
    )
    assert _route_point("30.2967714130865,120.21949381238632") == (
        "30.2967714130865,120.21949381238632"
    )
    assert _route_point({"longitude": 120.2194, "latitude": 30.2967}) == "30.2967,120.2194"
    assert _route_point([120.2194, 30.2967]) == "30.2967,120.2194"
    assert _route_point("not-a-coordinate") == "not-a-coordinate"
    assert _route_point("杭州市") == "杭州市"


def test_compact_preserves_priority_fields_within_bound() -> None:
    value = {"data": [{"name": "地点" + str(index), "description": "x" * 1000} for index in range(20)], "status": "success", "tail": "y" * 10000}
    compacted = _compact(value, max_chars=1200)
    assert compacted["status"] == "success"
    assert len(json.dumps(compacted, ensure_ascii=False, default=str)) <= 1200


def test_candidate_pool_excludes_map_index_noise() -> None:
    candidates = [
        {"provider_place_id": "admin", "name": "西湖区", "category": "行政区划;区县级"},
        {"provider_place_id": "metro", "name": "西湖文化广场站", "category": "交通设施;地铁站"},
        {"provider_place_id": "poi", "name": "西湖风景区", "category": "旅游景点"},
    ]
    assert [item["provider_place_id"] for item in _default_selected_candidates(candidates)] == ["poi"]


def test_structured_json_normalizes_markdown_fence_and_preface() -> None:
    assert _normalize_json_response("```json\n{\"answer\": \"好的\"}\n```") == '{"answer": "好的"}'
    assert _normalize_json_response("结果如下：{\"answer\": \"好的\"}") == '{"answer": "好的"}'


def test_confirmed_places_force_a_bounded_initial_schedule() -> None:
    state = {
        "context": {
            "trip_spec": {
                "start_date": {"value": "2026-07-25"},
                "end_date": {"value": "2026-07-25"},
                "pace": {"value": "轻松"},
            }
        },
        "selected_candidates": [
            {"provider_place_id": "west-lake", "name": "西湖", "category": "旅游景点"},
            {"provider_place_id": "su-causeway", "name": "苏堤", "category": "旅游景点"},
            {"provider_place_id": "taiziwan", "name": "太子湾", "category": "公园"},
        ],
    }

    schedule = _deterministic_initial_schedule(state)

    assert [item["provider_place_id"] for item in schedule["items"]] == [
        "west-lake",
        "su-causeway",
        "taiziwan",
    ]
    assert [item["start_time"] for item in schedule["items"]] == ["09:00", "11:45", "15:15"]


def test_cross_city_candidates_are_rejected_before_scheduling() -> None:
    beijing_center = {"longitude": 116.4074, "latitude": 39.9042}
    beijing_candidate = {
        "coordinates": {"longitude": 116.397, "latitude": 39.908},
        "city": "北京市",
    }
    nanjing_candidate = {
        "coordinates": {"longitude": 118.7969, "latitude": 32.0603},
        "city": "南京市",
    }

    accepted, _ = _candidate_matches_destination(
        beijing_candidate,
        destination="北京市",
        center=beijing_center,
    )
    rejected, reason = _candidate_matches_destination(
        nanjing_candidate,
        destination="北京市",
        center=beijing_center,
    )

    assert accepted
    assert not rejected
    assert "距离" in reason


def test_component_payload_validation_prevents_answer_cross_talk() -> None:
    date_component = SimpleNamespace(type="date_range_picker", props={})
    with pytest.raises(HTTPException) as error:
        _validate_component_payload(
            date_component,
            {"option": {"provider_place_id": "adcode:320500", "name": "苏州"}},
        )
    assert error.value.status_code == 422

    _validate_component_payload(
        date_component,
        {"start_date": "2026-10-02", "end_date": "2026-10-04"},
    )

    assumption_component = SimpleNamespace(type="assumption_confirmation", props={})
    _validate_component_payload(assumption_component, {"action": "confirm"})
    _validate_component_payload(assumption_component, {"action": "revise"})
    with pytest.raises(HTTPException):
        _validate_component_payload(assumption_component, {"action": "unknown"})


def test_database_error_is_not_exposed_to_the_conversation() -> None:
    technical = IntegrityError("INSERT INTO ui_components", {}, Exception("duplicate key"))
    code, message = _public_run_error(technical)

    assert code == "COMPONENT_STATE_CONFLICT"
    assert "sqlalchemy" not in message.lower()
    assert "INSERT INTO" not in message


def test_dynamic_agent_action_requires_a_real_next_step() -> None:
    action = AgentAction.model_validate(
        {
            "type": "call_tools",
            "public_progress": "正在比较适合长辈的目的地区域。",
            "calls": [
                {
                    "tool": "web_search",
                    "arguments": {"query": "云南 九月 带父母 轻松旅行"},
                    "reason": "需要比较区域气候与旅行强度",
                }
            ],
        }
    )

    assert action.type == "call_tools"
    assert action.calls[0].tool == "web_search"

    with pytest.raises(ValueError):
        AgentAction.model_validate({"type": "call_tools", "public_progress": "查询资料", "calls": []})


def test_dynamic_agent_action_accepts_provider_null_for_inactive_containers() -> None:
    action = AgentAction.model_validate(
        {
            "type": "ask_user",
            "public_progress": "确认出发地",
            "component": {
                "type": "assumption_confirmation",
                "title": "确认关键信息",
                "prompt": "请确认这些信息。",
                "props": {"assumptions": []},
            },
            "trip_spec_updates": None,
            "calls": None,
            "working_plan": None,
            "patch": None,
            "citation_ids": None,
        }
    )

    assert action.patch == {}
    assert action.calls == []
    assert action.citation_ids == []


def test_agent_component_schema_accepts_plan_approval_components() -> None:
    for component_type in ("plan_preview", "plan_patch_preview"):
        action = AgentAction.model_validate(
            {
                "type": "ask_user",
                "public_progress": "等待确认行程变更",
                "component": {
                    "type": component_type,
                    "title": "确认方案",
                    "prompt": "确认后才会写入正式版本。",
                },
            }
        )
        assert action.component is not None
        assert action.component.type == component_type


def test_patch_validation_blocker_routes_back_into_agent_loop() -> None:
    assert route_validated_patch({"patch_deferred": True}) == "bootstrap"
    assert route_validated_patch({"patch_deferred": False}) == "stream_response"


def test_patch_state_supports_superseding_a_draft() -> None:
    assert PatchState.SUPERSEDED.value == "SUPERSEDED"


def test_planning_gap_component_ignores_non_blocking_place_context() -> None:
    assert _planning_gap_component({}, "具体目的地区域") is None
    component = _planning_gap_component(
        {"candidate_places": [{"provider_place_id": "adcode:330100", "name": "杭州市"}]},
        "具体目的地区域",
    )
    assert component is not None
    assert component.type == "destination_disambiguation"

    poi_only = _planning_gap_component(
        {
            "context": {"trip_spec": {"destination": {"value": "杭州"}}},
            "candidate_places": [
                {
                    "provider_place_id": "18c1c0518b156f374d5547ee",
                    "name": "曲院风荷",
                    "city": "杭州市",
                }
            ],
        },
        "具体目的地区域",
    )
    assert poi_only is None


def test_initial_plan_candidate_confirmation_filters_non_places() -> None:
    state = {
        "context": {
            "trip_spec": {
                "must_visit": {"value": ["西湖"]},
            }
        },
        "candidate_places": [
            {
                "provider_place_id": "adcode:330100",
                "name": "杭州市",
                "category": "行政区",
            },
            {
                "provider_place_id": "west-lake",
                "name": "西湖风景区",
                "category": "旅游景点",
            },
            {
                "provider_place_id": "parking",
                "name": "西湖停车场",
                "category": "停车场",
            },
        ],
    }
    component = _place_candidates_component(state)
    props = _component_defaults(component, state)

    assert props["required_ids"] == ["west-lake"]
    assert [option["id"] for option in props["options"]] == ["west-lake"]


def test_extracted_request_accepts_provider_null_for_optional_collections() -> None:
    extracted = ExtractedTripRequest.model_validate(
        {
            "intent": "CREATE_TRIP",
            "confidence": 0.95,
            "travelers": None,
            "interests": None,
            "must_visit": None,
            "avoid": None,
            "constraints": None,
            "tickets": None,
            "preference_candidates": None,
            "scope": None,
            "user_facing_summary": "需要补充日期。",
        }
    )

    assert extracted.avoid == []
    assert extracted.travelers == []
    assert extracted.scope == {}


def test_trip_title_uses_destination_name_instead_of_serializing_place() -> None:
    trip_spec = TripSpecData(
        destination=FieldValue(
            value={
                "provider_place_id": "adcode:320508",
                "name": "苏州市",
                "coordinates": {"longitude": 120.62, "latitude": 31.32},
            },
            state=FieldState.CONFIRMED,
        ),
        travelers=FieldValue(
            value=[
                {"name": "self", "relation": "self"},
                {"name": "mother", "relation": "mother"},
            ],
            state=FieldState.CONFIRMED,
        ),
    )

    assert derive_title(trip_spec) == "和妈妈去苏州市"
    assert len(derive_title(trip_spec)) <= 200


def place(place_id: str, name: str) -> Place:
    return Place(
        provider_place_id=place_id,
        name=name,
        city="苏州",
        coordinates=Coordinates(longitude=120.62, latitude=31.32),
        source="baidu-map",
        observed_at=NOW,
    )


def item(item_id: str, title: str, hour: int, *, category: str = "景点") -> ItineraryItem:
    start = NOW.replace(hour=hour)
    return ItineraryItem(
        id=item_id,
        day_index=1,
        start_at=start,
        end_at=start + timedelta(hours=1),
        title=title,
        category=category,
        place=place(item_id, title),
        reason="用户选择",
        source="baidu-map",
        observed_at=NOW,
    )


def spec(**overrides) -> TripSpecData:
    value = TripSpecData(
        destination=FieldValue(
            value={"name": "苏州", "provider": "baidu-map"},
            state=FieldState.CONFIRMED,
        ),
        start_date=FieldValue(value="2026-10-02", state=FieldState.CONFIRMED),
        end_date=FieldValue(value="2026-10-04", state=FieldState.CONFIRMED),
        travelers=FieldValue(
            value=[{"name": "我", "mobility": "normal"}],
            state=FieldState.CONFIRMED,
        ),
    )
    return value.model_copy(update=overrides)


def plan(items: list[ItineraryItem], legs: list[RouteLeg] | None = None) -> PlanSnapshot:
    return PlanSnapshot(
        days=[
            TripDay(
                day_index=1,
                date=date(2026, 10, 2),
                title="园林与老城",
                items=items,
                route_legs=legs or [],
            )
        ],
        generated_at=NOW,
    )


def test_trip_spec_requires_confirmed_destination() -> None:
    assert spec().is_minimally_plannable()
    assert not spec(destination=FieldValue(value="苏州", state=FieldState.INFERRED)).is_minimally_plannable()


def test_route_failure_blocks_ready_state() -> None:
    result = validate_plan(plan([item("a", "拙政园", 9), item("b", "平江路", 11)]), spec())
    assert has_blocking_conflicts(result)
    assert "ROUTE_MISSING" in {conflict.code for conflict in result.conflicts}


def test_real_route_removes_route_blocker() -> None:
    first = item("a", "拙政园", 9)
    second = item("b", "平江路", 11)
    leg = RouteLeg(
        id="leg-1",
        origin_item_id=first.id,
        destination_item_id=second.id,
        mode="walking",
        duration_minutes=20,
        distance_meters=1300,
        summary="百度地图步行路线",
        observed_at=NOW,
    )
    result = validate_plan(plan([first, second], [leg]), spec())
    assert "ROUTE_MISSING" not in {conflict.code for conflict in result.conflicts}


def test_route_must_match_the_actual_item_pair() -> None:
    first = item("a", "拙政园", 9)
    second = item("b", "平江路", 11)
    unrelated = RouteLeg(
        id="leg-wrong",
        origin_item_id="x",
        destination_item_id="y",
        mode="walking",
        duration_minutes=20,
        distance_meters=1300,
        summary="错误配对",
        observed_at=NOW,
    )
    result = validate_plan(plan([first, second], [unrelated]), spec())
    assert "ROUTE_MISSING" in {conflict.code for conflict in result.conflicts}


def test_real_route_duration_must_fit_between_activities() -> None:
    first = item("a", "拙政园", 9)
    second = item("b", "平江路", 11)
    leg = RouteLeg(
        id="leg-slow",
        origin_item_id=first.id,
        destination_item_id=second.id,
        mode="transit",
        duration_minutes=75,
        distance_meters=9000,
        summary="真实路线",
        observed_at=NOW,
    )
    result = validate_plan(plan([first, second], [leg]), spec())
    assert "ROUTE_TIME_CONFLICT" in {conflict.code for conflict in result.conflicts}


def test_non_place_rest_does_not_require_a_route_leg() -> None:
    first = item("a", "拙政园", 9)
    rest = item("rest", "休息", 11, category="休息")
    rest.place = None
    result = validate_plan(plan([first, rest]), spec())
    assert "ROUTE_MISSING" not in {conflict.code for conflict in result.conflicts}


def test_missing_must_visit_is_blocking() -> None:
    must_visit = FieldValue(value=["苏州博物馆"], state=FieldState.CONFIRMED)
    result = validate_plan(plan([item("a", "拙政园", 9)]), spec(must_visit=must_visit))
    assert "MUST_VISIT_MISSING" in {conflict.code for conflict in result.conflicts}


def test_broad_must_visit_area_is_satisfied_by_a_place_in_that_area() -> None:
    west_lake_place = item("a", "曲院风荷", 9)
    assert west_lake_place.place is not None
    west_lake_place.place.city = "杭州市"
    west_lake_place.place.district = "西湖区"
    west_lake_place.place.address = "杭州市西湖区北山街89号"
    must_visit = FieldValue(value=["西湖"], state=FieldState.CONFIRMED)

    result = validate_plan(plan([west_lake_place]), spec(must_visit=must_visit))

    assert "MUST_VISIT_MISSING" not in {conflict.code for conflict in result.conflicts}


def test_unknown_cost_is_counted_without_invention() -> None:
    result = validate_plan(plan([item("a", "拙政园", 9)]), spec())
    assert result.known_cost_cny == Decimal("0")
    assert result.unknown_cost_items == 1


def test_hard_budget_only_uses_known_costs() -> None:
    paid = item("a", "体验活动", 9)
    paid.cost_cny = Decimal("300")
    paid.cost_source = "user"
    budget = FieldValue(value=200, state=FieldState.CONFIRMED)
    result = validate_plan(plan([paid]), spec(budget=budget, budget_mode="hard"))
    assert "HARD_BUDGET_EXCEEDED" in {conflict.code for conflict in result.conflicts}


@pytest.mark.parametrize("attribute", ["locked", "completed", "booked"])
def test_locked_completed_and_booked_items_are_protected(attribute: str) -> None:
    value = item("a", "已确认项目", 9)
    if attribute == "locked":
        value.locked = True
    elif attribute == "completed":
        value.status = "COMPLETED"
    else:
        value.reservation_state = "booked"
    assert _protected(value)


def test_weather_decision_only_targets_rain_affected_outdoor_items() -> None:
    snapshot = plan(
        [
            item("a", "平江路", 9, category="街区"),
            item("b", "苏州博物馆", 11, category="博物馆"),
        ]
    )
    impacts = weather_impacts(
        snapshot,
        {
            "forecasts": [
                {"date": "2026-10-02", "text_day": "中雨", "text_night": "小雨"}
            ]
        },
    )
    assert impacts[0]["items"] == ["平江路"]


def test_dry_weather_does_not_create_impact() -> None:
    snapshot = plan([item("a", "平江路", 9)])
    current = {
        "forecasts": [{"date": "2026-10-02", "text_day": "晴", "text_night": "多云"}]
    }
    assert weather_impacts(snapshot, current) == []


def test_reference_text_chunking_preserves_overlap() -> None:
    chunks = chunk_text("A" * 800, size=300, overlap=50)
    assert len(chunks) == 3
    assert chunks[0][-50:] == chunks[1][:50]


def test_baidu_poi_without_coordinates_is_rejected() -> None:
    assert normalize_place({"uid": "x", "name": "无坐标"}) is None


def test_baidu_route_normalization_uses_provider_values() -> None:
    result = normalize_routes(
        {
            "result": {
                "routes": [
                    {
                        "duration": "600",
                        "distance": "1200",
                        "steps": [
                            {"instruction": "<b>向东</b>步行", "path": "120.1,30.2;120.2,30.3"}
                        ],
                    }
                ]
            }
        },
        "walking",
    )[0]
    assert result["duration_seconds"] == 600
    assert result["distance_meters"] == 1200
    assert result["instructions"] == ["向东步行"]
    assert len(result["polyline"]) == 2


def test_baidu_result_matches_tool_gateway_contract() -> None:
    payload = tool_result([], "https://lbsyun.baidu.com/test")
    normalized = ToolResult.model_validate(payload)
    assert normalized.provider == "baidu-map"
    assert normalized.cache_state == "live"


def test_community_rail_result_is_wrapped_with_visible_source() -> None:
    normalized = tool_gateway._normalize_provider_result(
        {"success": True, "trains": [{"train_no": "G1"}]},
        "community-12306",
        "query-tickets",
    )
    assert normalized.provider == "community-12306"
    assert normalized.data["trains"][0]["train_no"] == "G1"
    assert "Joooook/12306-mcp@0.3.9" in normalized.source


def test_community_rail_error_cannot_be_treated_as_live_fact() -> None:
    with pytest.raises(ToolGatewayError):
        tool_gateway._normalize_provider_result(
            {"success": False, "error": "查询失败"},
            "community-12306",
            "query-tickets",
        )


def test_agent_eval_suite_has_at_least_thirty_scenarios() -> None:
    path = Path(__file__).parents[3] / "packages" / "evals" / "agent_scenarios.json"
    scenarios = json.loads(path.read_text(encoding="utf-8"))
    assert len(scenarios) >= 30
    assert len({scenario["id"] for scenario in scenarios}) == len(scenarios)
