from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "SuperTravel API"
    app_env: str = "development"
    api_prefix: str = "/api"
    web_origin: str = "http://localhost:8080"

    database_url: str = "postgresql+asyncpg://supertravel:supertravel@postgres:5432/supertravel"
    checkpoint_database_url: str = "postgresql://supertravel:supertravel@postgres:5432/supertravel"
    redis_url: str = "redis://redis:6379/0"

    llm_api_key: str | None = None
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-pro"
    llm_thinking_enabled: bool = True
    llm_reasoning_effort: str = "high"
    llm_timeout_seconds: float = 60
    llm_max_tokens: int = Field(default=8192, ge=512, le=131072)
    llm_structured_retries: int = Field(default=1, ge=0, le=3)

    baidu_map_server_ak: str | None = None
    vite_baidu_map_browser_ak: str | None = None
    baidu_map_mcp_url: str = "http://mcp-baidu:8100/mcp"
    enable_12306_mcp: bool = False
    rail_mcp_url: str = "http://mcp-12306:8000/mcp"
    enable_xhs_mcp: bool = False
    xhs_mcp_url: str = "http://mcp-xhs:8200/mcp"
    serper_api_key: str | None = None
    serper_api_url: str = "https://google.serper.dev/search"
    web_fetch_max_bytes: int = Field(default=750_000, ge=50_000, le=2_000_000)

    default_user_id: str = "00000000-0000-0000-0000-000000000001"
    max_agent_iterations: int = Field(default=12, ge=2, le=30)
    max_agent_tool_calls: int = Field(default=12, ge=1, le=100)
    max_agent_run_seconds: int = Field(default=240, ge=10, le=600)
    run_stale_after_seconds: int = Field(default=300, ge=60, le=1800)
    run_heartbeat_interval_seconds: int = Field(default=10, ge=3, le=60)
    tool_timeout_seconds: float = Field(default=25, ge=3, le=120)
    tool_result_max_bytes: int = Field(default=2_000_000, ge=100_000, le=10_000_000)
    tool_global_concurrency: int = Field(default=2, ge=1, le=10)
    tool_lease_ttl_seconds: float = Field(default=90, ge=10, le=600)
    tool_lease_wait_seconds: float = Field(default=30, ge=1, le=120)
    agent_worker_max_jobs: int = Field(default=2, ge=1, le=8)
    event_retention_days: int = Field(default=30, ge=1, le=365)
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    embedding_dimension: int = 512

    @field_validator("web_origin")
    @classmethod
    def strip_origin(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def llm_ready(self) -> bool:
        return bool(self.llm_api_key and self.llm_model and self.llm_base_url)

    @property
    def baidu_map_ready(self) -> bool:
        return bool(self.baidu_map_server_ak)

    @property
    def baidu_browser_map_ready(self) -> bool:
        return bool(self.vite_baidu_map_browser_ak)

    @property
    def web_search_ready(self) -> bool:
        return bool(self.serper_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
