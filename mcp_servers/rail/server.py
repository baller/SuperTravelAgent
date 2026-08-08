import json
import os
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.fastmcp import FastMCP


mcp = FastMCP(
    "SuperTravel 12306 Read Only",
    host=os.getenv("MCP_RAIL_HOST", "0.0.0.0"),
    port=int(os.getenv("MCP_RAIL_PORT", "8000")),
)


def _decode(response: Any) -> Any:
    value = response.structuredContent
    if value is not None:
        return value.get("result") if isinstance(value, dict) and set(value) == {"result"} else value
    text = "\n".join(
        getattr(item, "text", "")
        for item in response.content or []
        if getattr(item, "text", "")
    ).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


async def _call(name: str, arguments: dict[str, Any]) -> Any:
    parameters = StdioServerParameters(command="12306-mcp", args=[], env=dict(os.environ))
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            response = await session.call_tool(name, arguments)
    if response.isError:
        raise RuntimeError(str(_decode(response) or "12306 MCP call failed"))
    value = _decode(response)
    if isinstance(value, str) and value.startswith("Error:"):
        raise RuntimeError(value)
    return value


@mcp.tool(name="query-tickets")
async def query_tickets(
    from_station: str,
    to_station: str,
    train_date: str,
    train_filter_flags: str = "",
    earliest_start_time: int = 0,
    latest_start_time: int = 24,
    limited_num: int = 12,
) -> dict[str, Any]:
    """Query live 12306 ticket data without login, booking or payment."""
    data = await _call(
        "get-tickets",
        {
            "date": train_date,
            "fromStation": from_station,
            "toStation": to_station,
            "trainFilterFlags": train_filter_flags,
            "earliestStartTime": earliest_start_time,
            "latestStartTime": latest_start_time,
            "sortFlag": "startTime",
            "sortReverse": False,
            "limitedNum": limited_num,
            "format": "json",
        },
    )
    return {"trains": data}


@mcp.tool(name="search-stations")
async def search_stations(city: str) -> dict[str, Any]:
    """Resolve real 12306 station names and telecodes for a Chinese city."""
    return {"stations": await _call("get-stations-code-in-city", {"city": city})}


@mcp.tool(name="query-transfer")
async def query_transfer(from_station: str, to_station: str, train_date: str) -> dict[str, Any]:
    """Query up to ten live transfer options from the read-only upstream."""
    data = await _call(
        "get-interline-tickets",
        {
            "date": train_date,
            "fromStation": from_station,
            "toStation": to_station,
            "middleStation": "",
            "showWZ": False,
            "trainFilterFlags": "",
            "earliestStartTime": 0,
            "latestStartTime": 24,
            "sortFlag": "duration",
            "sortReverse": False,
            "limitedNum": 10,
            "format": "json",
        },
    )
    return {"transfer_options": data}


@mcp.tool(name="get-train-route-stations")
async def get_train_route_stations(train_code: str, depart_date: str) -> dict[str, Any]:
    """Read a train's route stations from the upstream community MCP."""
    data = await _call(
        "get-train-route-stations",
        {"trainCode": train_code, "departDate": depart_date, "format": "json"},
    )
    return {"stations": data}


@mcp.tool(name="get-current-time")
async def get_current_time() -> dict[str, Any]:
    """Return the upstream service's current Shanghai date."""
    return {"date": await _call("get-current-date", {})}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
