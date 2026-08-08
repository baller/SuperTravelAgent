from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date
from typing import Any, Generic, TypeVar

import httpx
from openai import AsyncOpenAI, BadRequestError
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.core.config import get_settings
from app.domain.enums import Intent, RiskLevel
from app.domain.schemas import AgentAction

T = TypeVar("T", bound=BaseModel)


@dataclass(slots=True)
class StructuredLLMCall(Generic[T]):
    """A validated value plus the provider responses that produced it.

    Prompt bodies are intentionally excluded: the execution trace exposes what
    the model API returned, not system instructions or hidden reasoning state.
    """

    value: T
    request: dict[str, Any]
    attempts: list[dict[str, Any]]

    def trace_payload(self, name: str, *, duration_ms: int) -> dict[str, Any]:
        return {
            "name": name,
            "provider": "openai-compatible",
            "duration_ms": duration_ms,
            "request": self.request,
            "attempts": self.attempts,
        }


class LLMNotReadyError(RuntimeError):
    pass


class LLMOutputError(RuntimeError):
    pass


def _normalize_json_response(content: str) -> str:
    """Accept JSON returned in a markdown fence or with a short preface.

    JSON mode is not implemented consistently by OpenAI-compatible providers.
    The result is still validated by the requested Pydantic schema; this only
    removes transport formatting around the JSON object.
    """

    text = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    if text.startswith("{") or text.startswith("["):
        return text
    decoder = json.JSONDecoder()
    for marker in ("{", "["):
        start = text.find(marker)
        if start < 0:
            continue
        try:
            value, _ = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        return json.dumps(value, ensure_ascii=False)
    return text


class ExtractedTripRequest(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0, le=1)
    destination: str | None = None
    origin: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    duration_days: int | None = None
    planning_scope: str | None = None
    transport_modes: list[str] = Field(default_factory=list)
    travelers: list[dict[str, Any]] = Field(default_factory=list)
    traveler_requirements: list[str] = Field(default_factory=list)
    budget_cny: int | None = None
    budget_mode: str | None = None
    pace: str | None = None
    interests: list[str] = Field(default_factory=list)
    must_visit: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)
    constraints: list[dict[str, Any]] = Field(default_factory=list)
    tickets: list[dict[str, Any]] = Field(default_factory=list)
    preference_candidates: list[dict[str, Any]] = Field(default_factory=list)
    scope: dict[str, Any] = Field(default_factory=dict)
    risk_level: RiskLevel = RiskLevel.GREEN
    requires_tools: bool = False
    requires_confirmation: bool = False
    user_facing_summary: str

    @field_validator(
        "travelers",
        "transport_modes",
        "traveler_requirements",
        "interests",
        "must_visit",
        "avoid",
        "constraints",
        "tickets",
        "preference_candidates",
        mode="before",
    )
    @classmethod
    def normalize_nullable_lists(cls, value: Any) -> Any:
        # OpenAI-compatible providers sometimes emit JSON null for an optional
        # collection even when its schema declares an empty-array default.
        return [] if value is None else value

    @field_validator("scope", mode="before")
    @classmethod
    def normalize_nullable_scope(cls, value: Any) -> Any:
        return {} if value is None else value


class PlaceSearchRequest(BaseModel):
    keyword: str
    category: str
    reason: str
    required: bool = False


class PlaceResearchPlan(BaseModel):
    queries: list[PlaceSearchRequest] = Field(min_length=2, max_length=8)


class ScheduleItem(BaseModel):
    provider_place_id: str
    day_index: int = Field(ge=1)
    start_time: str
    duration_minutes: int = Field(ge=30, le=480)
    reason: str
    category: str


class ScheduleProposal(BaseModel):
    day_titles: dict[str, str]
    items: list[ScheduleItem]


class PatchInstruction(BaseModel):
    action: str
    item_id: str | None = None
    target_day: int | None = None
    target_start_time: str | None = None
    replacement_keyword: str | None = None
    updates: dict[str, Any] = Field(default_factory=dict)


class PatchProposal(BaseModel):
    scope: dict[str, Any]
    reason: str
    instructions: list[PatchInstruction]


class ChatAnswer(BaseModel):
    answer: str


class ConversationSummary(BaseModel):
    summary: str


class ConciergeBrief(BaseModel):
    answer: str


SYSTEM_PROMPT = """
你是 SuperTravel 的旅行意图与旅行条件增量解析器。你只负责识别用户此刻想做什么，
以及从当前这句话中新增或修正的 Trip State 字段；不要在这个步骤生成行程或替用户做未授权的决定。
只提取用户明确表达或能从文本可靠推断的信息；不要创造地点、坐标、价格、开放时间、车次或预约状态。
所有外部事实必须由工具核验。高影响修改必须 requires_confirmation=true。
planning_scope 只能为 local_only 或 door_to_door。只有用户明确表示只规划目的地当地行程时才能使用 local_only。
transport_modes 只记录用户明确表达的跨城偏好，如 rail、flight、driving；不要自行选择。
traveler_requirements 只记录明确的体力、饮食、儿童、老人、无障碍和作息要求。
将相对日期结合提供的当前日期解析为 ISO 日期；无法可靠解析时返回 null。
对于 COMPLETE_ITEM、SKIP_ITEM、DELAY_ITEM，在 scope 中输出 item_title；延迟还应输出 minutes。
对于 UNDO_VERSION，在 scope 中输出用户明确指定的 version；未指定则省略。
当用户查询列车方案时使用 SEARCH_RAIL_OPTIONS，并在 scope 中输出 from_station、to_station、train_date。
用户明确提供已确定车次时，tickets 仅记录 kind=rail、title、train_code、from_station、to_station、train_date 等已知值。
preference_candidates 只能收录用户明确表达的跨旅程稳定偏好，每项包含 key、value(对象)、evidence。
一次性预算、某天疲劳、本次同行人和模型推断不得进入 preference_candidates。
用户说“不确定”“先看看”只表示尚未决定，不表示允许你替他设置默认值。
只有“你看着安排”“先给我一个版本”“你按推荐规划”等明确表达才表示允许安全假设。
只输出符合给定 JSON Schema 的 JSON 对象，不输出 Markdown。
""".strip()


AGENT_SYSTEM_PROMPT = """
你是 SuperTravel，一个围绕一段 Trip 持续工作的旅行管家。语气像懂行、耐心且主动推进的真人顾问，
先回应用户当前表达，再给出判断、推荐或下一步；不要把对话变成字段问卷。在询问用户要求前，请先提供价值（例如介绍目的地的特色、推荐最合适的旅行时间），保持互动的自然与舒适。

你的工作方式：读取当前 Trip State、当前对话、本轮工作计划、真实工具观察和可用来源，然后只选择一个下一步行动。工具返回后你会再次获得环境反馈并重新决定，直到需要用户确认或可以回答。

行动边界：主 Agent 只选择一个明确的 Skill，Skill 内部负责专门的输出；不要在一次行动中混合问询、泛化搜索和正式排程。
1. ask_user：向用户抛出交互卡片或询问高价值决策主题。你可以使用 component 字段主动输出 UI 组件（如 date_range_picker, traveler_selector, pace_interest_selector 等）。每次回复最多只能询问一个缺失的核心约束，其余通过 assumptions（假设）兜底或留到后续再问。
2. call_tools：需要现实数据时调用 1-3 个只读工具。不得虚构工具、参数、地点、坐标、价格、开放时间、天气、车次或来源。
3. update_working_plan：整理本轮下一步研究或排程计划，不修改 Trip State。
4. propose_trip_patch：提出首版日程或局部修改。只能引用真实工具结果中的地点 ID、现有 item_id 和 SourceRecord ID。
5. respond：证据和上下文已足够时，提供回答提纲与引用；最终自然语言由流式回答节点生成。
6. finish：没有更多内容需要输出时结束。

旅行澄清原则：
- 云南、欧洲、江浙沪等宽泛目的地必须先帮助用户比较或确认具体区域，不能静默收敛成某座城市。
 - 区分目的地简报、首版草案和最终可执行计划：目的地与大致天数明确时即可生成带 assumptions 的首版当地草案。
 - 精确日期、出发地、预算、交通偏好和普通成年同行需求通常不阻塞首版当地计划；出发地只阻塞 door_to_door 交通。
 - 只有目的地、天数都无法确定，或已经出现但未明确的儿童、老人、无障碍、疾病等高影响硬约束，才可阻塞首版草案。
 - 预算可以选择暂不限制或仅估算，不得因为未给金额而阻塞。
 - 普通兴趣和节奏可以根据用户明确表达更新；临时假设必须在 assumptions 或 assumption_confirmation 中明确标出，不得伪装成已确认事实。
 - 用户说“你看着安排”“先给我一个版本”“你先推荐”时，视为允许安全默认假设；达到 draftable 后不得继续机械补问。
 - “不确定”“先看看”“随便看看”不等于授权假设，应先交付介绍或候选方向。
 - 每次只处理当前最重要的一个决策主题，不按数据库字段顺序逐项询问；最多连续 ask_user 两轮，之后必须交付已有价值。
- 宽泛目的地区域比较使用 decision_options，每个 option 必须包含稳定 id、label、detail 和需要确认写入的 updates；只有上下文中已经存在百度地图真实候选时才使用 destination_disambiguation，且不得自行编造 provider_place_id。
- decision_options、rail_options 必须在 component.props.options 中提供实际选项。place_candidates 由 Harness 从真实地图候选填充，不要伪造 options。
- 如果还没有任何工具观察，decision_options 只能列出常识层面的初步方向；prompt 和 detail 必须明确写“初步方向，具体天气、交通和体验仍待核验”，不得给出气温、海拔、耗时、开放时间、拥挤度等具体事实。需要这些对比时，先调用可用工具。
- decision_options 中 updates 直接填写要写入的字段值，例如 {"destination":"大理-丽江"}，不要再次嵌套 value/state/evidence。

事实与来源：
- 外部事实只能来自本轮工具观察。社区内容只能用于体验、拥挤和踩坑线索，不能单独证明开放时间、票价、政策和余票。
- citation_ids 只能从上下文中的 SourceRecord 选择。
- 没有可点击 URL 的供应商结果可以引用为数据来源，但不能创造链接。

计划安全：
- 模型不能直接写数据库。
- 已完成、锁定、预约事项不可静默移动或删除。
- 首版计划和所有移动、删除、替换、跨日重排都必须先预览并确认。
- 如果路线、时间或必要地点数据不足，继续调用工具或询问用户，不能宣称计划已经可执行。

结构化写入约定：
- trip_spec_updates 的每个字段使用 {"value": ..., "state": "CONFIRMED|INFERRED", "evidence": "用户原文片段"}。只有 evidence 是当前用户原文中的连续片段时才可请求 CONFIRMED；目的地仍须地图核验。
- 首版计划的 patch 必须使用 {"kind":"initial_plan","schedule":{"day_titles":{"1":"..."},"items":[{"provider_place_id":"真实候选 ID","day_index":1,"start_time":"09:00","duration_minutes":120,"reason":"...","category":"ATTRACTION"}]}}。
- 修改已有计划的 patch 使用 {"kind":"modify_plan","proposal":{"scope":{},"reason":"...","instructions":[{"action":"MOVE|REMOVE|UPDATE|REPLACE|ADD_REST","item_id":"现有 item_id","target_day":1,"target_start_time":"14:00","replacement_keyword":null,"updates":{}}]}}。
- 单项执行动作使用 {"kind":"item_action","intent":"COMPLETE_ITEM|SKIP_ITEM|DELAY_ITEM","scope":{}}。

public_progress 是给旅行者看的当前行动说明：使用自然、具体的中文说明正在解决什么、为什么要做；不要输出 Prompt、JSON、Schema、token、内部变量、隐藏思维链或开发术语。
不要展示隐藏思维链；public_progress 只写可审计的公开行动摘要。只输出符合给定 JSON Schema 的 JSON 对象。
""".strip()


class LLMClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = AsyncOpenAI(
            api_key=self.settings.llm_api_key or "not-configured",
            base_url=self.settings.llm_base_url,
            timeout=self.settings.llm_timeout_seconds,
            http_client=httpx.AsyncClient(
                timeout=self.settings.llm_timeout_seconds,
                trust_env=False,
            ),
        )

    def ensure_ready(self) -> None:
        if not self.settings.llm_ready:
            raise LLMNotReadyError("LLM 尚未配置，不能解析旅行需求。")

    async def structured(
        self,
        schema: type[T],
        *,
        system: str,
        user: str,
        temperature: float = 0.1,
        thinking_enabled: bool | None = None,
        reasoning_effort: str | None = None,
    ) -> StructuredLLMCall[T]:
        self.ensure_ready()
        effective_thinking = self.settings.llm_thinking_enabled if thinking_enabled is None else thinking_enabled
        effective_reasoning = reasoning_effort or self.settings.llm_reasoning_effort
        schema_json = json.dumps(schema.model_json_schema(), ensure_ascii=False)
        messages = [
            {"role": "system", "content": f"{system}\nJSON Schema:\n{schema_json}"},
            {"role": "user", "content": user},
        ]
        last_error: Exception | None = None
        attempts: list[dict[str, Any]] = []
        request_trace = {
            "schema": schema.__name__,
            "model": self.settings.llm_model,
            "temperature": temperature,
            "max_tokens": self.settings.llm_max_tokens,
            "response_format": "json_object",
            "thinking_mode": "enabled" if effective_thinking else "disabled",
            "reasoning_effort": effective_reasoning,
            "system_prompt_chars": len(system),
            "user_prompt_chars": len(user),
            "prompt_bodies_exposed": False,
        }
        for attempt_number in range(1, self.settings.llm_structured_retries + 2):
            request: dict[str, Any] = {
                "model": self.settings.llm_model,
                "temperature": temperature,
                "max_tokens": self.settings.llm_max_tokens,
                "response_format": {"type": "json_object"},
                "messages": messages,
            }
            if "api.deepseek.com" in self.settings.llm_base_url:
                request["extra_body"] = {
                    "thinking": {
                        "type": "enabled" if effective_thinking else "disabled"
                    },
                    "reasoning_effort": effective_reasoning,
                }
            try:
                response = await self.client.chat.completions.create(**request)
                json_mode = "json_object"
            except BadRequestError as exc:
                # Some OpenAI-compatible providers do not implement JSON mode.
                # Keep a provider-neutral fallback; Pydantic remains the gate.
                attempts.append(
                    {
                        "attempt": attempt_number,
                        "status": "request_rejected",
                        "response_mode": "json_object",
                        "error_type": type(exc).__name__,
                        "next_action": "retry_without_json_mode",
                    }
                )
                request.pop("response_format", None)
                request.pop("extra_body", None)
                response = await self.client.chat.completions.create(**request)
                json_mode = "provider_text_fallback"

            choice = response.choices[0]
            content = choice.message.content
            reasoning_content = getattr(choice.message, "reasoning_content", None)
            if reasoning_content is None and getattr(choice.message, "model_extra", None):
                reasoning_content = choice.message.model_extra.get("reasoning_content")
            usage = response.usage.model_dump(mode="json") if response.usage else None
            attempt_trace: dict[str, Any] = {
                "attempt": attempt_number,
                "status": "received",
                "response_mode": json_mode,
                "response_id": response.id,
                "model": response.model,
                "finish_reason": choice.finish_reason,
                "usage": usage,
                "raw_content": content,
                "reasoning_content": reasoning_content,
            }
            if not content:
                last_error = LLMOutputError("LLM returned an empty structured response")
                attempt_trace["status"] = "empty_response"
                attempts.append(attempt_trace)
                continue
            try:
                value = schema.model_validate_json(_normalize_json_response(content))
                attempt_trace["status"] = "validated"
                attempts.append(attempt_trace)
                return StructuredLLMCall(value=value, request=request_trace, attempts=attempts)
            except (ValidationError, json.JSONDecodeError) as exc:
                last_error = exc
                attempt_trace["status"] = "validation_failed"
                attempt_trace["validation_error"] = str(exc)
                attempts.append(attempt_trace)

        raise LLMOutputError(f"LLM structured output validation failed: {last_error}") from last_error

    async def extract_request(
        self,
        message: str,
        trip_context: dict[str, Any] | None = None,
    ) -> StructuredLLMCall[ExtractedTripRequest]:
        context = json.dumps(trip_context or {}, ensure_ascii=False)
        return await self.structured(
            ExtractedTripRequest,
            system=SYSTEM_PROMPT,
            user=f"当前日期：{date.today().isoformat()}\n当前 Trip：{context}\n用户输入：{message}",
            # Classification and conservative field extraction are policy
            # inputs, not open-ended planning. Keeping them fast makes the
            # first public progress state useful instead of waiting on a
            # long reasoning pass before the agent can react.
            thinking_enabled=False,
            reasoning_effort="low",
        )

    async def decide_next_action(self, context: dict[str, Any]) -> StructuredLLMCall[AgentAction]:
        quick_intents = {
            Intent.ASK_TRIP_QUESTION.value,
            Intent.ANSWER_CLARIFICATION.value,
            Intent.SEARCH_PLACE.value,
            Intent.EXPLAIN_PLAN.value,
            Intent.GENERAL_CHAT.value,
        }
        quick_mode = context.get("run_intent") in quick_intents
        return await self.structured(
            AgentAction,
            system=AGENT_SYSTEM_PROMPT,
            user=(
                f"当前日期：{date.today().isoformat()}\n"
                "以下是本轮经过 Harness 筛选的上下文。请只决定一个下一步行动：\n"
                + json.dumps(context, ensure_ascii=False, default=str)
            ),
            temperature=0.15,
            thinking_enabled=False if quick_mode else None,
            reasoning_effort="low" if quick_mode else None,
        )

    async def stream_final_response(
        self,
        *,
        context: dict[str, Any],
        response_outline: str,
        sources: list[dict[str, Any]],
        thinking_enabled: bool | None = None,
        reasoning_effort: str | None = None,
    ) -> AsyncIterator[str]:
        self.ensure_ready()
        effective_thinking = self.settings.llm_thinking_enabled if thinking_enabled is None else thinking_enabled
        effective_reasoning = reasoning_effort or self.settings.llm_reasoning_effort
        allowed_sources = [
            {
                "source_id": item.get("id"),
                "title": item.get("title"),
                "provider": item.get("provider"),
                "url": item.get("canonical_url"),
                "snippet": item.get("snippet"),
            }
            for item in sources
        ]
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 SuperTravel 旅行管家。根据回答提纲、Trip State 和允许引用的来源，"
                    "用自然、周到但简洁的中文回答。不要描述内部工作流，不要声称执行了未发生的操作。"
                    "当允许引用的来源列表为空时，只能忠实改写回答提纲，不得补充任何具体日期、数字、天气、"
                    "交通耗时、开放时间、价格、评分或景点事实。"
                    "需要引用时只能写 [来源:source_id] 标记，不要直接输出任何 URL；"
                    "系统会把有效标记转换成真实超链接。没有 URL 的来源也使用同一标记。"
                    "只使用允许来源列表中的 source_id。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "answer_outline": response_outline,
                        "trip_context": context,
                        "allowed_sources": allowed_sources,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            },
        ]
        request: dict[str, Any] = {
            "model": self.settings.llm_model,
            "temperature": 0.25,
            "max_tokens": min(self.settings.llm_max_tokens, 4096),
            "messages": messages,
            "stream": True,
        }
        if "api.deepseek.com" in self.settings.llm_base_url:
            request["extra_body"] = {
                "thinking": {
                    "type": "enabled" if effective_thinking else "disabled"
                },
                "reasoning_effort": effective_reasoning,
            }
        stream = await self.client.chat.completions.create(**request)
        async for chunk in stream:
            if not chunk.choices:
                continue
            content = chunk.choices[0].delta.content
            if content:
                yield content

    async def research_plan(self, spec: dict[str, Any]) -> StructuredLLMCall[PlaceResearchPlan]:
        return await self.structured(
            PlaceResearchPlan,
            system="""
你负责把已确认旅行需求与只读社区攻略转成真实地图检索词。输出地点名称或明确类别，不输出坐标、价格和开放时间。
必须包含用户的每个必去地点；其余查询应匹配兴趣、节奏和同行人约束。轻松节奏每天 2-3 个主要地点。
社区内容只能帮助发现候选和理解偏好，不能作为营业时间、价格、坐标或余票事实。
总共只生成 2-8 个高价值、互不重复的检索词，优先复用每次检索返回的候选，避免为相近类别逐项查询。
餐饮和休息点仅在确有必要时加入。只输出 JSON。
""".strip(),
            user=json.dumps(spec, ensure_ascii=False),
            temperature=0.2,
        )

    async def schedule(
        self,
        spec: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> StructuredLLMCall[ScheduleProposal]:
        return await self.structured(
            ScheduleProposal,
            system="""
你负责把真实百度地图 POI 候选分配到旅行日期。只能引用候选中的 provider_place_id，不得发明地点。
按相近地理区域聚类，遵守节奏、老人儿童体力、必去和避开项。开始时间使用 HH:MM。
不需要插入交通段，系统会调用真实路线服务并调整时间。不要输出价格或开放状态。只输出 JSON。
""".strip(),
            user=json.dumps({"trip_spec": spec, "candidates": candidates}, ensure_ascii=False),
            temperature=0.2,
            # Candidate selection and day grouping are bounded and validated
            # by the Harness; deep reasoning here only delays the first useful
            # draft and used to make the UI appear stuck for a minute.
            thinking_enabled=False,
            reasoning_effort="low",
        )

    async def destination_brief(
        self,
        spec: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> StructuredLLMCall[ConciergeBrief]:
        return await self.structured(
            ConciergeBrief,
            system="""
你是 SuperTravel 的目的地研究子任务。请像细致的旅行管家一样，用自然中文先向用户汇报研究发现，再让用户决定哪些地点进入排程。
只能使用提供的已确认 TripSpec、百度地图真实候选和候选附带的小红书只读摘要；不得创造坐标、价格、开放时间、评分或预约状态。
当 verified_candidates 为空时，只能改写已有的概括性方向，不得补充具体日期、数字、天气、交通耗时、开放时间、拥挤度或任何景点事实。
回答应覆盖：目的地整体取舍、最匹配的景点、当地美食或适合觅食的区域、住宿通勤思路、同行人和天气/预约方面需要留意的事项。
明确区分“已由地图核验的地点”和“社区体验线索”，对未核验信息直接说明。不要说已经生成最终行程。只输出 JSON。
""".strip(),
            user=json.dumps({"trip_spec": spec, "verified_candidates": candidates}, ensure_ascii=False),
            temperature=0.3,
        )

    async def patch_proposal(
        self,
        message: str,
        trip_spec: dict[str, Any],
        current_plan: dict[str, Any],
    ) -> StructuredLLMCall[PatchProposal]:
        return await self.structured(
            PatchProposal,
            system="""
你负责把自然语言修改转成局部行程变更指令。只引用当前计划存在的 item_id。
已完成、锁定或预约项目不可移动、删除、替换。作用域不明确时 instructions 返回空数组。
可用 action: MOVE, REMOVE, UPDATE, REPLACE, ADD_REST。替换时只给 replacement_keyword，系统会用真实地图检索。
只输出 JSON。
""".strip(),
            user=json.dumps(
                {"request": message, "trip_spec": trip_spec, "current_plan": current_plan}, ensure_ascii=False
            ),
            temperature=0.1,
        )

    async def answer_trip_question(
        self,
        message: str,
        trip_spec: dict[str, Any],
        current_plan: dict[str, Any] | None,
    ) -> StructuredLLMCall[ChatAnswer]:
        return await self.structured(
            ChatAnswer,
            system="""
你是 SuperTravel 的旅行管家。仅根据提供的 Trip State 回答，不创造价格、开放时间、路线或天气。
如果信息不在 Trip State 中，明确说明需要实时核验。不要声称已经修改计划。只输出 JSON。
""".strip(),
            user=json.dumps(
                {"question": message, "trip_spec": trip_spec, "current_plan": current_plan}, ensure_ascii=False
            ),
            temperature=0.2,
        )

    async def summarize_conversation(
        self,
        existing_summary: str | None,
        messages: list[dict[str, str]],
    ) -> StructuredLLMCall[ConversationSummary]:
        return await self.structured(
            ConversationSummary,
            system="""
你负责压缩 SuperTravel 旅程对话。仅保留用户已确认的意图、待决策事项、已拒绝方案与近期执行反馈。
不复制 Trip State 中的日程、锁定项、票务、预算和硬约束，它们由结构化数据库保护。
不添加新事实，不保留模型推理过程。使用简洁中文，只输出 JSON。
""".strip(),
            user=json.dumps(
                {"existing_summary": existing_summary, "messages": messages},
                ensure_ascii=False,
            ),
            temperature=0,
        )


llm_client = LLMClient()
