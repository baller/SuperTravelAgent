import asyncio
import html
import os
import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable

import httpx
from mcp.server.fastmcp import FastMCP

BAIDU_MAP_SERVER_AK = os.getenv("BAIDU_MAP_SERVER_AK")
BAIDU_MAP_BASE_URL = "https://api.map.baidu.com"
BAIDU_MAP_MAX_QPS = max(0.1, float(os.getenv("BAIDU_MAP_MAX_QPS", "2")))

_baidu_rate_lock = asyncio.Lock()
_baidu_next_request_at = 0.0

mcp = FastMCP(
    "SuperTravel Baidu Maps",
    host=os.getenv("MCP_BAIDU_HOST", "0.0.0.0"),
    port=int(os.getenv("MCP_BAIDU_PORT", "8100")),
)


class BaiduMapError(RuntimeError):
    pass


def require_key() -> str:
    if not BAIDU_MAP_SERVER_AK:
        raise BaiduMapError("BAIDU_MAP_SERVER_AK is not configured")
    return BAIDU_MAP_SERVER_AK


async def baidu_get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    global _baidu_next_request_at

    payload = {**params, "ak": require_key(), "output": "json", "from": "supertravel_mcp"}
    # Personal Baidu accounts currently allow three requests per second for
    # the map services used by the MVP. Serialize and pace calls below that
    # ceiling so a multi-day plan cannot burst place and route APIs together.
    async with _baidu_rate_lock:
        now = time.monotonic()
        delay = max(0.0, _baidu_next_request_at - now)
        if delay:
            await asyncio.sleep(delay)
        _baidu_next_request_at = max(now, _baidu_next_request_at) + 1 / BAIDU_MAP_MAX_QPS
    async with httpx.AsyncClient(timeout=25, trust_env=False) as client:
        response = await client.get(f"{BAIDU_MAP_BASE_URL}{path}", params=payload)
        response.raise_for_status()
        data = response.json()
    if int(data.get("status", -1)) != 0:
        message = data.get("message") or data.get("msg") or "unknown error"
        raise BaiduMapError(f"Baidu Maps error {data.get('status')}: {message}")
    return data


def tool_result(data: Any, source: str, ttl_minutes: int = 60) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "status": "success",
        "data": data,
        "provider": "baidu-map",
        "source": source,
        "retrieved_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=ttl_minutes)).isoformat(),
        "confidence": 1,
        "cache_state": "live",
        "retryable": False,
    }


def coordinates(location: dict[str, Any] | None) -> dict[str, float] | None:
    if not location or location.get("lng") is None or location.get("lat") is None:
        return None
    return {"longitude": float(location["lng"]), "latitude": float(location["lat"])}


def normalize_place(place: dict[str, Any]) -> dict[str, Any] | None:
    point = coordinates(place.get("location"))
    uid = str(place.get("uid") or "")
    if not point or not uid or not place.get("name"):
        return None
    detail = place.get("detail_info") or {}
    content_tag = detail.get("content_tag") or detail.get("label") or []
    if isinstance(content_tag, str):
        content_tags = [item.strip() for item in re.split(r"[,;|、]", content_tag) if item.strip()]
    elif isinstance(content_tag, list):
        content_tags = [str(item).strip() for item in content_tag if str(item).strip()]
    else:
        content_tags = []

    def optional_number(value: Any, number_type: type[int] | type[float]) -> int | float | None:
        try:
            return number_type(value) if value not in {None, ""} else None
        except (TypeError, ValueError):
            return None

    return {
        "provider_place_id": uid,
        "name": str(place["name"]),
        "address": place.get("address"),
        "province": place.get("province"),
        "city": place.get("city"),
        "district": place.get("area") or place.get("district"),
        "adcode": str(place.get("adcode") or "") or None,
        "category": detail.get("tag") or place.get("tag"),
        "coordinates": point,
        "telephone": place.get("telephone"),
        "opening_hours": detail.get("shop_hours"),
        "detail_url": detail.get("detail_url"),
        "overall_rating": optional_number(detail.get("overall_rating"), float),
        "comment_count": optional_number(detail.get("comment_num"), int),
        "image_count": optional_number(detail.get("image_num"), int),
        "content_tags": content_tags,
    }


def flatten_steps(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        nested = value.get("steps")
        if nested is not None:
            yield from flatten_steps(nested)
    elif isinstance(value, list):
        for item in value:
            yield from flatten_steps(item)


def parse_path(path: str | None) -> list[dict[str, float]]:
    result: list[dict[str, float]] = []
    for pair in (path or "").split(";"):
        try:
            longitude, latitude = pair.split(",", 1)
            result.append({"longitude": float(longitude), "latitude": float(latitude)})
        except (TypeError, ValueError):
            continue
    return result


def plain_instruction(value: str | None) -> str | None:
    if not value:
        return None
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip() or None


def normalize_routes(data: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    routes: list[dict[str, Any]] = []
    for route in data.get("result", {}).get("routes", []):
        points: list[dict[str, float]] = []
        instructions: list[str] = []
        for step in flatten_steps(route.get("steps", [])):
            points.extend(parse_path(step.get("path")))
            instruction = plain_instruction(step.get("instruction") or step.get("instructions"))
            if instruction and instruction not in instructions:
                instructions.append(instruction)
        routes.append(
            {
                "mode": mode,
                "duration_seconds": int(route.get("duration") or 0),
                "distance_meters": int(route.get("distance") or 0),
                "instructions": instructions,
                "polyline": points,
            }
        )
    return routes


@mcp.tool()
async def map_geocode(address: str) -> dict[str, Any]:
    """Resolve an address to a real BD-09 coordinate and administrative metadata."""
    data = await baidu_get("/geocoding/v3/", {"address": address})
    result = data.get("result") or {}
    point = coordinates(result.get("location"))
    if not point:
        return tool_result([], "https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-geocoding-base")
    reverse = await baidu_get(
        "/reverse_geocoding/v3/",
        {
            "location": f"{point['latitude']},{point['longitude']}",
            "coordtype": "bd09ll",
            "extensions_poi": 1,
        },
    )
    reverse_result = reverse.get("result") or {}
    component = reverse_result.get("addressComponent") or {}
    destination_name = component.get("city") or component.get("province") or address
    return tool_result(
        [
            {
                "provider_place_id": f"adcode:{component.get('adcode') or address}",
                "name": destination_name,
                "formatted_address": reverse_result.get("formatted_address") or address,
                "province": component.get("province"),
                "city": component.get("city"),
                "district": component.get("district"),
                "adcode": str(component.get("adcode") or "") or None,
                "coordinates": point,
                "precision": result.get("precise"),
                "confidence": result.get("confidence"),
            }
        ],
        "https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-geocoding-base",
        ttl_minutes=24 * 60,
    )


@mcp.tool()
async def map_reverse_geocode(longitude: float, latitude: float) -> dict[str, Any]:
    """Reverse geocode a real BD-09 coordinate."""
    data = await baidu_get(
        "/reverse_geocoding/v3/",
        {
            "location": f"{latitude},{longitude}",
            "coordtype": "bd09ll",
            "extensions_poi": 1,
        },
    )
    return tool_result(
        data.get("result") or {},
        "https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-geocoding-abroad",
        ttl_minutes=24 * 60,
    )


@mcp.tool()
async def map_search_places(
    query: str,
    region: str | None = None,
    location: str | None = None,
    radius: int = 5000,
    limit: int = 10,
) -> dict[str, Any]:
    """Search real Baidu POIs by region or around a 'lat,lng' BD-09 point."""
    if not region and not location:
        raise BaiduMapError("map_search_places requires region or location")
    params: dict[str, Any] = {"query": query, "scope": 2, "page_size": min(max(limit, 1), 20)}
    if location:
        path = "/place/v2/search"
        params.update({"location": location, "radius": min(max(radius, 100), 50000)})
    else:
        path = "/place/v2/search"
        params.update({"region": region, "region_limit": "true"})
    data = await baidu_get(path, params)
    places = [place for raw in (data.get("results") or []) if (place := normalize_place(raw))]
    return tool_result(
        places,
        "https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-placeapi",
        ttl_minutes=6 * 60,
    )


@mcp.tool()
async def map_place_details(uid: str) -> dict[str, Any]:
    """Fetch one real Baidu POI by UID."""
    data = await baidu_get("/place/v2/detail", {"uid": uid, "scope": 2})
    raw = data.get("result") or {}
    place = normalize_place(raw)
    return tool_result(
        [place] if place else [],
        "https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-placeapi",
        ttl_minutes=6 * 60,
    )


@mcp.tool()
async def map_directions(origin: str, destination: str, mode: str = "driving") -> dict[str, Any]:
    """Plan a real route between two 'lat,lng' BD-09 coordinates."""
    if mode not in {"walking", "driving", "transit", "riding"}:
        raise BaiduMapError(f"unsupported route mode: {mode}")
    data = await baidu_get(
        f"/directionlite/v1/{mode}",
        {"origin": origin, "destination": destination, "coord_type": "bd09ll"},
    )
    return tool_result(
        normalize_routes(data, mode),
        "https://lbsyun.baidu.com/faq/api?title=webapi/directionlite-v1",
        ttl_minutes=20 if mode != "walking" else 30,
    )


@mcp.tool()
async def map_weather(district_id: str | None = None, location: str | None = None) -> dict[str, Any]:
    """Read Baidu's real-time and five-day weather by district or BD-09 'lng,lat'."""
    if not district_id and not location:
        raise BaiduMapError("map_weather requires district_id or location")
    params: dict[str, Any] = {"data_type": "all", "coordtype": "bd09ll"}
    if district_id:
        params["district_id"] = district_id
    else:
        params["location"] = location
    data = await baidu_get("/weather/v1/", params)
    current = data.get("result") or {}
    return tool_result(
        {
            "location": current.get("location"),
            "now": current.get("now"),
            "forecasts": current.get("forecasts") or [],
            "forecast_hours": current.get("forecast_hours") or [],
            "indexes": current.get("indexes") or [],
            "alerts": current.get("alerts") or [],
        },
        "https://lbsyun.baidu.com/faq/api?title=webapi/weather/base",
        ttl_minutes=60,
    )


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
