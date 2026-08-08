"""Cross-process leases for read-only provider calls.

The Agent worker can be scaled beyond one process. An asyncio semaphore in one
worker cannot protect a provider quota in another worker, so tool calls use a
short Redis lease in addition to the local fast-path locks.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from time import monotonic
from uuid import uuid4

from redis.asyncio import Redis

from app.core.config import get_settings

_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


async def _release(redis: Redis, key: str | None, token: str) -> None:
    if not key:
        return
    try:
        await redis.eval(_RELEASE_SCRIPT, 1, key, token)
    except Exception:
        # Lease expiry is the final safety net. A failed best-effort release
        # must not turn a successful tool call into a failed Agent Run.
        pass


@asynccontextmanager
async def distributed_tool_slot(provider: str | None):
    """Acquire one of the global slots and one provider slot.

    Provider slots are intentionally one-at-a-time, matching the Demo quota
    for Baidu/XHS/12306. The global slot count is configurable and defaults to
    two. Both leases expire so a killed worker cannot hold a quota forever.
    """

    settings = get_settings()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    token = uuid4().hex
    global_key: str | None = None
    provider_key: str | None = None
    ttl_ms = max(5_000, int(settings.tool_lease_ttl_seconds * 1000))
    deadline = monotonic() + settings.tool_lease_wait_seconds
    global_prefix = "supertravel:tool:global:"
    provider_key_name = f"supertravel:tool:provider:{provider or 'generic'}"
    try:
        while monotonic() < deadline:
            for index in range(max(1, settings.tool_global_concurrency)):
                key = f"{global_prefix}{index}"
                if await redis.set(key, token, nx=True, px=ttl_ms):
                    global_key = key
                    break
            if global_key:
                if await redis.set(provider_key_name, token, nx=True, px=ttl_ms):
                    provider_key = provider_key_name
                    break
                await _release(redis, global_key, token)
                global_key = None
            await asyncio.sleep(0.05)
        if not global_key or not provider_key:
            raise TimeoutError(f"工具预算繁忙，暂时无法调用 {provider or 'generic'}")
        yield
    finally:
        await _release(redis, provider_key, token)
        await _release(redis, global_key, token)
        await redis.aclose()
