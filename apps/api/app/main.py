from __future__ import annotations

from contextlib import asynccontextmanager
from inspect import isawaitable

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.agent.loop import build_graph
from app.api import agent, patches, profile, system, trips
from app.core.config import get_settings
from app.db.bootstrap import ensure_default_user

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_default_user()
    agent_queue = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    async with AsyncPostgresSaver.from_conn_string(settings.checkpoint_database_url) as checkpointer:
        await checkpointer.setup()
        app.state.agent_graph = build_graph(checkpointer)
        app.state.agent_queue = agent_queue
        try:
            yield
        finally:
            close_queue = getattr(agent_queue, "aclose", None) or getattr(agent_queue, "close", None)
            if close_queue:
                result = close_queue()
                if isawaitable(result):
                    await result


app = FastAPI(
    title="SuperTravel API",
    version="0.1.0",
    description="Trip-centered AI travel concierge",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(system.router, prefix=settings.api_prefix)
app.include_router(trips.router, prefix=settings.api_prefix)
app.include_router(agent.router, prefix=settings.api_prefix)
app.include_router(patches.router, prefix=settings.api_prefix)
app.include_router(profile.router, prefix=settings.api_prefix)


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": settings.app_name, "docs": "/docs", "readiness": f"{settings.api_prefix}/system/readiness"}
