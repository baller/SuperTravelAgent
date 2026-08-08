from __future__ import annotations

import asyncio
import ipaddress
import socket
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from urllib.parse import urlparse
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import ToolCall
from app.domain.schemas import ToolResult
from app.services.events import event_broker
from app.services.sources import persist_tool_sources, public_tool_result
from app.tools.mcp_client import ToolGatewayError


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "title":
            self._in_title = True
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in {"script", "style", "noscript", "svg"} and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        if self._in_title:
            self.title = f"{self.title} {text}".strip()
        elif not self._skip:
            self.parts.append(text)


async def _assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ToolGatewayError("只允许读取公开的 HTTP/HTTPS 网页。")
    if parsed.hostname.lower() in {"localhost", "localhost.localdomain"}:
        raise ToolGatewayError("不能读取本机或内网地址。")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, port)
    except OSError as exc:
        raise ToolGatewayError("网页域名无法解析。") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ToolGatewayError("不能读取本机或内网地址。")


class WebToolGateway:
    async def _start(
        self,
        session: AsyncSession,
        *,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        name: str,
        arguments: dict,
    ) -> ToolCall:
        call = ToolCall(run_id=run_id, name=name, arguments=arguments, status="RUNNING")
        session.add(call)
        await session.flush()
        await event_broker.publish(
            session,
            "tool.started",
            {"tool_call_id": str(call.id), "name": name, "arguments": arguments, "provider": "serper" if name == "web_search" else "web-fetch"},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
        await session.commit()
        return call

    async def _finish(
        self,
        session: AsyncSession,
        *,
        call: ToolCall,
        trip_id: UUID,
        thread_id: UUID,
        result: ToolResult,
    ) -> ToolResult:
        result.tool_call_id = call.id
        call.status = "SUCCEEDED"
        call.result = result.model_dump(mode="json")
        call.completed_at = datetime.now(UTC)
        sources = await persist_tool_sources(
            session,
            run_id=call.run_id,
            trip_id=trip_id,
            thread_id=thread_id,
            tool_name=call.name,
            arguments=call.arguments,
            result=result,
        )
        await event_broker.publish(
            session,
            "tool.completed",
            {**public_tool_result(call.name, result), "sources": [item.model_dump(mode="json") for item in sources]},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=call.run_id,
            commit=False,
        )
        await session.commit()
        return result

    async def search(
        self,
        session: AsyncSession,
        *,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        query: str,
        limit: int = 8,
    ) -> ToolResult:
        settings = get_settings()
        if not settings.web_search_ready:
            raise ToolGatewayError("网页搜索尚未配置 SERPER_API_KEY。")
        query = " ".join(query.split())[:500]
        call = await self._start(
            session,
            run_id=run_id,
            trip_id=trip_id,
            thread_id=thread_id,
            name="web_search",
            arguments={"query": query, "limit": max(1, min(limit, 10))},
        )
        try:
            async with httpx.AsyncClient(timeout=settings.tool_timeout_seconds, trust_env=False) as client:
                response = await client.post(
                    settings.serper_api_url,
                    headers={"X-API-KEY": settings.serper_api_key or "", "Content-Type": "application/json"},
                    json={"q": query, "gl": "cn", "hl": "zh-cn", "num": max(1, min(limit, 10))},
                )
                response.raise_for_status()
                raw = response.json()
            rows = []
            for item in raw.get("organic") or []:
                if not isinstance(item, dict) or not item.get("link"):
                    continue
                rows.append(
                    {
                        "title": item.get("title"),
                        "url": item.get("link"),
                        "snippet": item.get("snippet"),
                        "domain": urlparse(str(item.get("link"))).netloc,
                        "position": item.get("position"),
                    }
                )
            now = datetime.now(UTC)
            return await self._finish(
                session,
                call=call,
                trip_id=trip_id,
                thread_id=thread_id,
                result=ToolResult(
                    status="success",
                    data=rows,
                    provider="serper",
                    source="https://serper.dev",
                    retrieved_at=now,
                    expires_at=now + timedelta(hours=1),
                ),
            )
        except Exception as exc:
            call.status = "FAILED"
            call.result = {"error": str(exc)}
            call.completed_at = datetime.now(UTC)
            await event_broker.publish(
                session,
                "tool.failed",
                {"tool_call_id": str(call.id), "name": call.name, "provider": "serper", "error": str(exc)},
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await session.commit()
            raise ToolGatewayError(f"网页搜索失败：{exc}") from exc

    async def fetch(
        self,
        session: AsyncSession,
        *,
        run_id: UUID,
        trip_id: UUID,
        thread_id: UUID,
        url: str,
    ) -> ToolResult:
        settings = get_settings()
        await _assert_public_url(url)
        call = await self._start(
            session,
            run_id=run_id,
            trip_id=trip_id,
            thread_id=thread_id,
            name="web_fetch",
            arguments={"url": url},
        )
        try:
            async with httpx.AsyncClient(
                timeout=settings.tool_timeout_seconds,
                follow_redirects=True,
                max_redirects=3,
                trust_env=False,
                headers={"User-Agent": "SuperTravel/0.1 (+local travel research)"},
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
                await _assert_public_url(str(response.url))
                content_type = response.headers.get("content-type", "")
                if "text/html" not in content_type and "text/plain" not in content_type:
                    raise ToolGatewayError("当前网页类型不支持提取。")
                raw = response.content[: settings.web_fetch_max_bytes]
            parser = _TextExtractor()
            parser.feed(raw.decode(response.encoding or "utf-8", errors="replace"))
            text = "\n".join(parser.parts)
            now = datetime.now(UTC)
            return await self._finish(
                session,
                call=call,
                trip_id=trip_id,
                thread_id=thread_id,
                result=ToolResult(
                    status="success",
                    data={
                        "url": str(response.url),
                        "title": parser.title or str(response.url),
                        "excerpt": text[:1200],
                        "content": text[:16000],
                    },
                    provider="web-fetch",
                    source=str(response.url),
                    retrieved_at=now,
                    expires_at=now + timedelta(hours=6),
                ),
            )
        except Exception as exc:
            call.status = "FAILED"
            call.result = {"error": str(exc)}
            call.completed_at = datetime.now(UTC)
            await event_broker.publish(
                session,
                "tool.failed",
                {
                    "tool_call_id": str(call.id),
                    "name": call.name,
                    "provider": "web-fetch",
                    "error": str(exc),
                },
                trip_id=trip_id,
                thread_id=thread_id,
                run_id=run_id,
                commit=False,
            )
            await session.commit()
            if isinstance(exc, ToolGatewayError):
                raise
            raise ToolGatewayError(f"网页读取失败：{exc}") from exc


web_tool_gateway = WebToolGateway()
