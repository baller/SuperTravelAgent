from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from time import monotonic
from typing import Any
from uuid import UUID

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import FactSnapshot, ToolCall
from app.domain.schemas import ToolResult
from app.services.events import event_broker
from app.services.sources import persist_tool_sources, public_tool_result


class ToolGatewayError(RuntimeError):
    pass


class MCPToolGateway:
    RAIL_READ_TOOLS = {
        "query-tickets",
        "query-ticket-price",
        "search-stations",
        "query-transfer",
        "get-train-route-stations",
        "get-train-no-by-train-code",
        "get-current-time",
    }
    XHS_READ_TOOLS = {
        "xhs_check_cookie",
        "xhs_search_notes",
        "xhs_get_note_content",
    }

    def __init__(self) -> None:
        self.settings = get_settings()
        self.failures: dict[str, int] = {}
        self.circuit_until: dict[str, float] = {}

    @staticmethod
    def _httpx_client_factory(headers=None, timeout=None, auth=None):
        return httpx.AsyncClient(
            headers=headers,
            timeout=timeout,
            auth=auth,
            follow_redirects=True,
            trust_env=False,
        )

    def _cache_key(self, provider: str, name: str, arguments: dict[str, Any]) -> str:
        payload = json.dumps(self._normalize_arguments(arguments), ensure_ascii=False, sort_keys=True)
        digest = sha256(payload.encode("utf-8")).hexdigest()
        return f"tool:{provider}:{name}:{digest}"

    @staticmethod
    def _normalize_arguments(value: Any, key: str | None = None) -> Any:
        if isinstance(value, dict):
            return {str(item_key): MCPToolGateway._normalize_arguments(item, str(item_key)) for item_key, item in value.items()}
        if isinstance(value, list):
            return [MCPToolGateway._normalize_arguments(item, key) for item in value]
        if isinstance(value, float):
            return round(value, 6)
        if isinstance(value, str) and key in {
            "query",
            "keywords",
            "region",
            "address",
            "city",
            "from_station",
            "to_station",
            "train_date",
        }:
            return " ".join(value.split()).casefold()
        return value

    @staticmethod
    def _cache_ttl(provider: str, name: str) -> int:
        if provider == "community-12306":
            return 15 * 60 if name in {"query-tickets", "query-ticket-price"} else 5 * 60
        if provider == "xiaohongshu":
            return 7 * 24 * 60 * 60 if name == "xhs_search_notes" else 24 * 60 * 60
        if name in {"map_geocode", "map_reverse_geocode"}:
            return 30 * 24 * 60 * 60
        if name in {"map_search_places", "map_place_details"}:
            return 7 * 24 * 60 * 60
        if "route" in name or name in {"map_directions", "map_distance_matrix"}:
            return 6 * 60 * 60
        if "weather" in name:
            return 60 * 60
        return 6 * 60 * 60

    async def probe_baidu_map(self) -> tuple[bool, str]:
        if not self.settings.baidu_map_ready:
            return False, "请填写 BAIDU_MAP_SERVER_AK"
        try:
            async with streamablehttp_client(
                self.settings.baidu_map_mcp_url,
                timeout=3,
                sse_read_timeout=3,
                httpx_client_factory=self._httpx_client_factory,
            ) as (read, write, _):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    response = await client.list_tools()
            available = {tool.name for tool in response.tools}
            required = {
                "map_geocode",
                "map_search_places",
                "map_directions",
                "map_weather",
            }
            missing = required - available
            if missing:
                return False, f"MCP 缺少工具：{'、'.join(sorted(missing))}"
            return True, "服务端 AK 已配置，MCP 工具协议可用"
        except Exception:
            return False, "MCP 当前不可连接，请检查 mcp-baidu 容器"

    async def _probe_provider(
        self,
        url: str,
        required: set[str],
        *,
        unavailable_message: str,
    ) -> tuple[bool, str, set[str]]:
        try:
            async with streamablehttp_client(
                url,
                timeout=4,
                sse_read_timeout=4,
                httpx_client_factory=self._httpx_client_factory,
            ) as (read, write, _):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    response = await client.list_tools()
            available = {tool.name for tool in response.tools}
            missing = required - available
            if missing:
                return False, f"缺少只读工具：{'、'.join(sorted(missing))}", available
            return True, f"协议可用，共发现 {len(available)} 个工具", available
        except Exception:
            return False, unavailable_message, set()

    async def probe_rail(self) -> tuple[bool, str]:
        if not self.settings.enable_12306_mcp:
            return False, "未启用，可继续用文字录入车次"
        ready, detail, available = await self._probe_provider(
            self.settings.rail_mcp_url,
            {"query-tickets"},
            unavailable_message="容器不可连接，城市内行程仍可正常使用",
        )
        if ready:
            allowed = sorted(available & self.RAIL_READ_TOOLS)
            return True, f"Joooook/12306-mcp 只读工具已连接：{'、'.join(allowed)}"
        return False, detail

    async def probe_xhs(self) -> tuple[bool, str]:
        if not self.settings.enable_xhs_mcp:
            return False, "未启用；填写 XHS_COOKIE 后可开启只读攻略研究"
        ready, detail, _ = await self._probe_provider(
            self.settings.xhs_mcp_url,
            self.XHS_READ_TOOLS,
            unavailable_message="容器不可连接或 Cookie 未就绪",
        )
        if not ready:
            return False, detail
        try:
            async with streamablehttp_client(
                self.settings.xhs_mcp_url,
                timeout=8,
                sse_read_timeout=8,
                httpx_client_factory=self._httpx_client_factory,
            ) as (read, write, _):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    response = await client.call_tool("xhs_check_cookie", {})
            if response.isError:
                return False, "协议可用，但 XHS_COOKIE 无效或已过期"
            return True, "jobsonlook/xhs-mcp 只读搜索与笔记读取已连接"
        except Exception:
            return False, "协议可用，但 XHS_COOKIE 无效或已过期"

    async def _read_cache(self, key: str) -> ToolResult | None:
        redis = Redis.from_url(self.settings.redis_url)
        try:
            value = await redis.get(key)
            if not value:
                return None
            result = ToolResult.model_validate_json(value)
            result.cache_state = "cached"
            return result
        except Exception:
            return None
        finally:
            await redis.aclose()

    async def _write_cache(self, key: str, provider: str, name: str, result: ToolResult) -> None:
        redis = Redis.from_url(self.settings.redis_url)
        try:
            cache_value = result.model_copy(update={"tool_call_id": None})
            await redis.set(key, cache_value.model_dump_json(), ex=self._cache_ttl(provider, name))
        except Exception:
            return
        finally:
            await redis.aclose()

    def _normalize_provider_result(self, raw: Any, provider: str, name: str) -> ToolResult:
        if provider != "community-12306":
            return ToolResult.model_validate(raw)
        if not isinstance(raw, dict):
            raise ToolGatewayError("12306 社区 MCP 返回了无法解析的结果。")
        if raw.get("success") is False:
            detail = raw.get("error") or raw.get("message") or raw.get("errors") or "查询失败"
            raise ToolGatewayError(f"12306 社区 MCP：{detail}")
        retrieved_at = datetime.now(UTC)
        return ToolResult.model_validate(
            {
                "status": "success",
                "data": raw,
                "provider": provider,
                "source": "community-mcp:Joooook/12306-mcp@0.3.9",
                "retrieved_at": retrieved_at.isoformat(),
                "expires_at": (
                    retrieved_at + timedelta(seconds=self._cache_ttl(provider, name))
                ).isoformat(),
                "confidence": 0.8,
                "cache_state": "live",
                "retryable": False,
            }
        )

    async def call_baidu_map(
        self,
        session: AsyncSession,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        if not self.settings.baidu_map_ready:
            raise ToolGatewayError("百度地图服务尚未配置，不能生成真实地点或路线。")
        return await self._call(
            session,
            self.settings.baidu_map_mcp_url,
            run_id,
            trip_id,
            thread_id,
            name,
            arguments,
            provider="baidu-map",
        )

    async def call_rail(
        self,
        session: AsyncSession,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        if not self.settings.enable_12306_mcp:
            raise ToolGatewayError("12306 社区 MCP 未启用，请改用文字录入车次。")
        if name not in self.RAIL_READ_TOOLS:
            raise ToolGatewayError("只允许调用 12306 社区 MCP 的只读查询工具。")
        return await self._call(
            session,
            self.settings.rail_mcp_url,
            run_id,
            trip_id,
            thread_id,
            name,
            arguments,
            provider="community-12306",
        )

    async def call_xhs(
        self,
        session: AsyncSession,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        if not self.settings.enable_xhs_mcp:
            raise ToolGatewayError("小红书只读 MCP 未启用，不能声称已检索社区攻略。")
        if name not in self.XHS_READ_TOOLS:
            raise ToolGatewayError("只允许调用小红书 MCP 的检查、搜索和读取工具。")
        return await self._call(
            session,
            self.settings.xhs_mcp_url,
            run_id,
            trip_id,
            thread_id,
            name,
            arguments,
            provider="xiaohongshu",
        )

    async def _call(
        self,
        db: AsyncSession,
        url: str,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        name: str,
        arguments: dict[str, Any],
        *,
        provider: str,
    ) -> ToolResult:
        cache_key = self._cache_key(provider, name, arguments)
        cached = await self._read_cache(cache_key)
        call_count = await db.scalar(
            select(func.count(ToolCall.id)).where(ToolCall.run_id == run_id)
        )
        # A cache hit is a local read and does not consume the external-call
        # budget. It remains auditable as a CACHED ToolCall below.
        if (call_count or 0) >= self.settings.max_agent_tool_calls and cached is None:
            raise ToolGatewayError("本次 Agent Run 已达到工具调用上限，已停止继续扩展。")
        if cached is None and self.circuit_until.get(provider, 0) > monotonic():
            raise ToolGatewayError(f"{provider} 工具暂时熔断，请稍后重试。")
        call = ToolCall(run_id=run_id, name=name, arguments=arguments, status="RUNNING")
        db.add(call)
        await db.flush()
        await event_broker.publish(
            db,
            "tool.started",
            {"tool_call_id": str(call.id), "name": name, "arguments": arguments, "provider": provider},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await db.commit()
        if cached:
            cached.tool_call_id = call.id
            call.status = "CACHED"
            call.result = cached.model_dump(mode="json")
            call.completed_at = datetime.now(UTC)
            arguments_key = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
            db.add(
                FactSnapshot(
                    trip_id=trip_id,
                    fact_type=name,
                    subject_type="tool_query",
                    subject_id=sha256(arguments_key.encode("utf-8")).hexdigest(),
                    value={"arguments": arguments, "data": cached.data},
                    provider=cached.provider,
                    source_url=cached.source,
                    observed_at=cached.retrieved_at,
                    valid_until=cached.expires_at,
                    confidence_millis=round(cached.confidence * 1000),
                    state="cached",
                )
            )
            sources = await persist_tool_sources(
                db,
                run_id=run_id,
                trip_id=trip_id,
                thread_id=thread_id,
                tool_name=name,
                arguments=arguments,
                result=cached,
            )
            await event_broker.publish(
                db,
                "tool.completed",
                {
                    **public_tool_result(name, cached),
                    "sources": [item.model_dump(mode="json") for item in sources],
                },
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await db.commit()
            return cached
        try:
            response = None
            last_error: Exception | None = None
            for attempt in range(2):
                try:
                    async with streamablehttp_client(
                        url,
                        timeout=self.settings.tool_timeout_seconds,
                        sse_read_timeout=self.settings.tool_timeout_seconds,
                        httpx_client_factory=self._httpx_client_factory,
                    ) as (read, write, _):
                        async with ClientSession(read, write) as client:
                            await client.initialize()
                            response = await client.call_tool(name, arguments)
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt == 0:
                        await asyncio.sleep(0.25)
            if response is None:
                raise ToolGatewayError(str(last_error or "MCP tool failed"))
            if response.isError:
                message = "MCP tool failed"
                if response.content and getattr(response.content[0], "text", None):
                    message = response.content[0].text
                raise ToolGatewayError(message)

            raw: Any = response.structuredContent
            if raw is None and response.content:
                text = getattr(response.content[0], "text", "")
                raw = json.loads(text) if text else {}
            if isinstance(raw, dict) and "result" in raw and len(raw) == 1:
                raw = raw["result"]
            serialized = json.dumps(raw, ensure_ascii=False, default=str).encode("utf-8")
            if len(serialized) > self.settings.tool_result_max_bytes:
                raise ToolGatewayError("工具结果超过大小限制，已拒绝写入 Trip State。")
            normalized = self._normalize_provider_result(raw, provider, name)
            normalized.tool_call_id = call.id
            call.status = "SUCCEEDED"
            call.result = normalized.model_dump(mode="json")
            call.completed_at = datetime.now(UTC)
            arguments_key = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
            db.add(
                FactSnapshot(
                    trip_id=trip_id,
                    fact_type=name,
                    subject_type="tool_query",
                    subject_id=sha256(arguments_key.encode("utf-8")).hexdigest(),
                    value={"arguments": arguments, "data": normalized.data},
                    provider=normalized.provider,
                    source_url=normalized.source,
                    observed_at=normalized.retrieved_at,
                    valid_until=normalized.expires_at,
                    confidence_millis=round(normalized.confidence * 1000),
                    state=normalized.cache_state,
                )
            )
            sources = await persist_tool_sources(
                db,
                run_id=run_id,
                trip_id=trip_id,
                thread_id=thread_id,
                tool_name=name,
                arguments=arguments,
                result=normalized,
            )
            await event_broker.publish(
                db,
                "tool.completed",
                {
                    **public_tool_result(name, normalized),
                    "sources": [item.model_dump(mode="json") for item in sources],
                },
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await db.commit()
            self.failures[provider] = 0
            self.circuit_until.pop(provider, None)
            await self._write_cache(cache_key, provider, name, normalized)
            return normalized
        except Exception as exc:
            self.failures[provider] = self.failures.get(provider, 0) + 1
            if self.failures[provider] >= 3:
                self.circuit_until[provider] = monotonic() + 60
            call.status = "FAILED"
            call.result = {"error": str(exc), "provider": provider}
            call.completed_at = datetime.now(UTC)
            await event_broker.publish(
                db,
                "tool.failed",
                {"tool_call_id": str(call.id), "name": name, "provider": provider, "error": str(exc)},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await db.commit()
            if isinstance(exc, ToolGatewayError):
                raise
            raise ToolGatewayError(str(exc)) from exc


tool_gateway = MCPToolGateway()
