from __future__ import annotations

from fastapi import APIRouter, Query
from redis.asyncio import Redis
from sqlalchemy import select, text

from app.core.config import get_settings
from app.db.models import ToolUsageLedger
from app.db.session import SessionFactory
from app.domain.schemas import ReadinessResponse, ReadinessService
from app.tools.mcp_client import tool_gateway

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/tool-usage")
async def tool_usage(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, object]:
    """Return the bounded provider ledger for settings/debug screens."""

    async with SessionFactory() as session:
        rows = (
            await session.scalars(
                select(ToolUsageLedger)
                .order_by(ToolUsageLedger.created_at.desc())
                .limit(limit)
            )
        ).all()
    return {
        "items": [
            {
                "id": str(row.id),
                "run_id": str(row.run_id),
                "thread_id": str(row.thread_id),
                "activity_id": row.activity_id,
                "provider": row.provider,
                "tool_name": row.tool_name,
                "cache_hit": row.cache_hit,
                "quota_cost": row.quota_cost,
                "result_count": row.result_count,
                "duration_ms": row.duration_ms,
                "status": row.status,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ],
        "limit": limit,
    }


@router.get("/readiness", response_model=ReadinessResponse)
async def readiness() -> ReadinessResponse:
    settings = get_settings()
    services: list[ReadinessService] = []
    try:
        async with SessionFactory() as session:
            await session.execute(text("SELECT 1"))
        services.append(ReadinessService(name="PostgreSQL", ready=True, required=True, detail="Trip State 可持久化"))
    except Exception as exc:
        services.append(ReadinessService(name="PostgreSQL", ready=False, required=True, detail=str(exc)))
    try:
        redis = Redis.from_url(settings.redis_url)
        await redis.ping()
        await redis.aclose()
        services.append(ReadinessService(name="Redis", ready=True, required=True, detail="任务与监测队列可用"))
    except Exception as exc:
        services.append(ReadinessService(name="Redis", ready=False, required=True, detail=str(exc)))
    services.append(
        ReadinessService(
            name="网页搜索",
            ready=settings.web_search_ready,
            required=False,
            detail="Serper 已配置，可检索公开网页" if settings.web_search_ready else "未配置 SERPER_API_KEY；仍可使用百度地图和已启用的社区数据源",
        )
    )
    services.append(
        ReadinessService(
            name="LLM",
            ready=settings.llm_ready,
            required=True,
            detail=f"模型：{settings.llm_model}" if settings.llm_ready else "请填写 LLM_API_KEY",
        )
    )
    baidu_ready, baidu_detail = await tool_gateway.probe_baidu_map()
    services.append(
        ReadinessService(
            name="百度地图数据服务",
            ready=baidu_ready,
            required=True,
            detail=baidu_detail,
        )
    )
    services.append(
        ReadinessService(
            name="基础地图瓦片",
            ready=True,
            required=False,
            detail="浏览器使用 OSM 主瓦片和 CARTO 备用瓦片；百度仅提供地点、路线与天气数据",
        )
    )
    rail_ready, rail_detail = await tool_gateway.probe_rail()
    services.append(
        ReadinessService(
            name="12306 社区 MCP",
            ready=rail_ready,
            required=False,
            detail=rail_detail,
        )
    )
    xhs_ready, xhs_detail = await tool_gateway.probe_xhs()
    services.append(
        ReadinessService(
            name="小红书只读 MCP",
            ready=xhs_ready,
            required=False,
            detail=xhs_detail,
        )
    )
    required_ready = all(service.ready for service in services if service.required)
    return ReadinessResponse(ready=required_ready, services=services)


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
