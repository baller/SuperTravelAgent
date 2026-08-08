import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.fastmcp import FastMCP


mcp = FastMCP(
    "SuperTravel Xiaohongshu Read Only",
    host=os.getenv("MCP_XHS_HOST", "0.0.0.0"),
    port=int(os.getenv("MCP_XHS_PORT", "8200")),
)


def _cookie() -> str:
    value = os.getenv("XHS_COOKIE", "").strip()
    if not value:
        raise RuntimeError("XHS_COOKIE is not configured")
    return value


def _decode(response: Any) -> Any:
    value = response.structuredContent
    if value is not None:
        return value.get("result") if isinstance(value, dict) and set(value) == {"result"} else value
    texts = [getattr(item, "text", "") for item in response.content or []]
    text = "\n".join(item for item in texts if item).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


async def _call(name: str, arguments: dict[str, Any]) -> Any:
    parameters = StdioServerParameters(
        command="xhs-mcp",
        args=[],
        env={**os.environ, "XHS_COOKIE": _cookie()},
    )
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            response = await session.call_tool(name, arguments)
    if response.isError:
        detail = _decode(response) or "Xiaohongshu MCP call failed"
        raise RuntimeError(str(detail))
    return _decode(response)


def _result(data: Any, ttl_minutes: int = 30) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "status": "success",
        "data": data,
        "provider": "community-xhs",
        "source": "community-mcp:jobsonlook/xhs-mcp@0.1.1",
        "retrieved_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=ttl_minutes)).isoformat(),
        "confidence": 0.65,
        "cache_state": "live",
        "retryable": False,
    }


@mcp.tool()
async def xhs_check_cookie() -> dict[str, Any]:
    """Check the configured Xiaohongshu session without exposing the cookie."""
    return _result(await _call("check_cookie", {}), ttl_minutes=5)


@mcp.tool()
async def xhs_search_notes(keywords: str) -> dict[str, Any]:
    """Search public Xiaohongshu notes through the configured read-only session."""
    return _result(await _call("search_notes", {"keywords": keywords}), ttl_minutes=30)


@mcp.tool()
async def xhs_get_note_content(url: str) -> dict[str, Any]:
    """Read one note returned by xhs_search_notes; no write tools are exposed."""
    return _result(await _call("get_note_content", {"url": url}), ttl_minutes=60)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
