from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SourceRecord
from app.domain.schemas import SourceRecordData, ToolResult
from app.services.events import event_broker


def _walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from _walk(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _walk(nested)


def _clean_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    return value[:2000] if parsed.scheme in {"http", "https"} and parsed.netloc else None


def _source_payloads(
    tool_name: str,
    result: ToolResult,
    arguments: dict[str, Any],
) -> list[dict[str, Any]]:
    query = str(
        arguments.get("query")
        or arguments.get("keywords")
        or arguments.get("address")
        or arguments.get("url")
        or arguments.get("city")
        or arguments.get("district_id")
        or arguments.get("location")
        or ""
    ).strip() or None
    items: list[dict[str, Any]] = []
    seen: set[tuple[str | None, str]] = set()

    def add(
        *,
        title: str,
        url: str | None,
        source_type: str,
        provider: str,
        snippet: str | None = None,
        publisher: str | None = None,
        author: str | None = None,
        published_at: datetime | None = None,
        credibility: str = "unknown",
    ) -> None:
        title = " ".join(str(title).split())[:500]
        if not title:
            return
        identity = (url, title)
        if identity in seen:
            return
        seen.add(identity)
        items.append(
            {
                "source_type": source_type,
                "provider": provider,
                "title": title,
                "canonical_url": url,
                "publisher": publisher,
                "author": author,
                "published_at": published_at,
                "retrieved_at": result.retrieved_at,
                "query": query,
                "snippet": " ".join(str(snippet or "").split())[:1600] or None,
                "credibility_level": credibility,
            }
        )

    if tool_name == "web_search":
        for node in result.data if isinstance(result.data, list) else []:
            if not isinstance(node, dict):
                continue
            url = _clean_url(node.get("url") or node.get("link"))
            add(
                title=str(node.get("title") or url or "网页搜索结果"),
                url=url,
                source_type="official_web" if node.get("official") else "web",
                provider="serper",
                snippet=node.get("snippet"),
                publisher=node.get("publisher") or node.get("domain"),
                credibility="official" if node.get("official") else "unknown",
            )
    elif tool_name == "web_fetch":
        data = result.data if isinstance(result.data, dict) else {}
        url = _clean_url(data.get("url") or arguments.get("url"))
        add(
            title=str(data.get("title") or url or "网页内容"),
            url=url,
            source_type="web",
            provider="web-fetch",
            snippet=data.get("excerpt"),
            publisher=data.get("publisher"),
        )
    elif tool_name.startswith("xhs_"):
        for node in _walk(result.data):
            url = _clean_url(node.get("url") or node.get("note_url") or node.get("share_url"))
            title = node.get("title") or node.get("display_title") or node.get("desc")
            if title or url:
                add(
                    title=str(title or "小红书社区笔记"),
                    url=url,
                    source_type="community",
                    provider="jobsonlook/xhs-mcp",
                    snippet=node.get("excerpt") or node.get("desc") or node.get("content"),
                    author=node.get("author") or node.get("nickname"),
                    credibility="community",
                )
    elif tool_name.startswith("map_"):
        if "weather" in tool_name:
            add(
                title=f"百度地图天气：{query or '当前查询区域'}",
                url=_clean_url(result.source),
                source_type="weather_provider",
                provider="baidu-map",
                snippet="百度地图开放平台返回的实时及预报天气",
                publisher="百度地图开放平台",
                credibility="provider",
            )
        nodes = result.data if isinstance(result.data, list) else [result.data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            title = node.get("name") or node.get("formatted_address")
            url = _clean_url(node.get("detail_url"))
            if title:
                add(
                    title=str(title),
                    url=url,
                    source_type="weather_provider" if "weather" in tool_name else "map_provider",
                    provider="baidu-map",
                    snippet=node.get("address") or node.get("description"),
                    publisher="百度地图开放平台",
                    credibility="provider",
                )
    elif tool_name in {"query-tickets", "query-ticket-price", "query-transfer"}:
        add(
            title=f"12306 社区查询：{query or tool_name}",
            url=None,
            source_type="transport_provider",
            provider="Joooook/12306-mcp",
            snippet="社区只读数据源返回的铁路查询结果",
            credibility="community",
        )
    return items


async def persist_tool_sources(
    session: AsyncSession,
    *,
    run_id: UUID,
    trip_id: UUID,
    thread_id: UUID,
    tool_name: str,
    arguments: dict[str, Any],
    result: ToolResult,
) -> list[SourceRecordData]:
    rows: list[SourceRecord] = []
    for payload in _source_payloads(tool_name, result, arguments):
        existing = await session.scalar(
            select(SourceRecord).where(
                SourceRecord.run_id == run_id,
                SourceRecord.canonical_url == payload["canonical_url"],
                SourceRecord.title == payload["title"],
            )
        )
        if existing:
            rows.append(existing)
            continue
        row = SourceRecord(
            run_id=run_id,
            tool_call_id=result.tool_call_id,
            **payload,
        )
        session.add(row)
        await session.flush()
        rows.append(row)
        await event_broker.publish(
            session,
            "source.discovered",
            {"source": source_data(row).model_dump(mode="json")},
            trip_id=trip_id,
            thread_id=thread_id,
            run_id=run_id,
            commit=False,
        )
    return [source_data(row) for row in rows]


def source_data(row: SourceRecord) -> SourceRecordData:
    return SourceRecordData(
        id=row.id,
        run_id=row.run_id,
        tool_call_id=row.tool_call_id,
        source_type=row.source_type,
        provider=row.provider,
        title=row.title,
        canonical_url=row.canonical_url,
        publisher=row.publisher,
        author=row.author,
        published_at=row.published_at,
        retrieved_at=row.retrieved_at,
        query=row.query,
        snippet=row.snippet,
        credibility_level=row.credibility_level,
    )


def public_tool_result(tool_name: str, result: ToolResult) -> dict[str, Any]:
    data = result.data
    if isinstance(data, list):
        preview = data[:8]
        count = len(data)
    elif isinstance(data, dict):
        nested_rows = next(
            (
                value
                for key in (
                    "results",
                    "places",
                    "pois",
                    "notes",
                    "trains",
                    "routes",
                    "items",
                    "stations",
                    "forecasts",
                )
                if isinstance((value := data.get(key)), list)
            ),
            None,
        )
        preview = nested_rows[:8] if nested_rows is not None else data
        count = len(nested_rows) if nested_rows is not None else (1 if data else 0)
    else:
        preview = str(data or "")[:3000]
        count = 1 if data else 0
    return {
        "tool_call_id": str(result.tool_call_id) if result.tool_call_id else None,
        "name": tool_name,
        "provider": result.provider,
        "cache_state": result.cache_state,
        "retrieved_at": result.retrieved_at.isoformat(),
        "result_count": count,
        "result": preview,
    }
