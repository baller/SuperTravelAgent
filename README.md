# SuperTravel

SuperTravel 是围绕一段 Trip 持续工作的 AI 旅行管家。用户通过一个 Agent 交代目的、约束和变化；系统维护结构化 Trip State，使用真实百度地图地点、路线和天气，所有高影响修改都通过可预览、可确认、可撤销的 PlanPatch 完成。

每段 Trip 可以拥有多个相互隔离的 Conversation Thread：消息、交互组件、Agent Run 与检查点都绑定明确的 `thread_id`。工作台支持新建、切换、重命名、归档和删除对话，并以可折叠的“管家工作过程”展示正在解决的问题、真实工具结果与可点击来源；隐藏推理、提示词和底层请求结构不会进入前端协议。

这不是多 Agent 展示，也不会在缺少 Key 或供应商失败时回退到模拟地点、虚构坐标、假天气或假房价。

## MVP 已实现

- 由模型动态决定询问、研究、调用工具、提出 Patch 或回答的 Agent Loop，而非固定字段工作流；
- 文字创建 Trip，以及目的地、日期、同行人、预算、节奏/兴趣对话组件；
- LangGraph 持久检查点与 `interrupt`/resume，同一 Run 中断后可恢复；
- PostgreSQL Trip State、计划版本、Patch、事实、Watch、Decision、消息、组件和事件；
- 多对话 Thread 隔离、历史切换、重命名/归档/删除，以及按 Run 分组的消息与组件；
- 百度地图 Streamable HTTP MCP 适配器：地点、地理编码、酒店 POI、市内路线、天气；
- 真实地点候选、按天时间线、RouteLeg、地图联动与酒店位置便利度；
- 自然语言局部移动、删除、替换、加休息；真实替换地点会再次调用百度地图；
- 锁定/已预约/已完成项目保护，Patch 审批、拒绝、乐观锁和版本恢复；
- ARQ 天气 Watch、FactSnapshot、应用内 Decision Queue；
- Today Mode：当前/下一项、真实交通、天气、完成、跳过、延迟和余程重排入口；
- Serper 公开网页搜索与受控网页读取，来源独立持久化为 `SourceRecord`；
- `Joooook/12306-mcp@0.3.9` 只读查询适配层，默认启用且不影响核心城市规划；
- `jobsonlook/xhs-mcp` 小红书只读攻略研究适配层，配置 Cookie 后启用；
- SSE 持久事件与 `Last-Event-ID` 重连；
- Docker Compose 一键启动和服务就绪检查。

## 真实数据边界

| 能力 | 数据源 | 失败行为 |
|---|---|---|
| 基础地图瓦片 | OpenStreetMap，CARTO 自动备用 | 百度浏览器端 AK 不可用也保留可操作底图 |
| 地点、BD-09 坐标、酒店地点 | 百度地图开放平台 MCP | 不生成地点；真实点位转换后叠加到底图 |
| 步行、公交、驾车路线 | 百度地图开放平台 MCP | 产生 `ROUTE_MISSING` 阻断，Trip 不进入 READY |
| 天气与天气 Watch | 百度地图开放平台 MCP | 标记检查失败，保留上次事实，不改行程 |
| 旅行意图、排程、Patch 语义 | OpenAI-compatible LLM | Run 失败并保留已提交 Trip State |
| 火车查询 | 可选社区 12306 MCP | 回退为用户文字录入，不影响核心规划 |
| 攻略研究 | 可选 jobsonlook/xhs-mcp 只读工具 | 未配置 Cookie 时明确显示未启用，不伪造社区内容 |
| 公开网页研究 | 可选 Serper + 受控网页读取 | 未配置 Serper Key 时不声称已完成网页搜索 |
| 酒店 | 百度酒店 POI + 到每日首末地点的真实路线 | 不展示房价、房量、取消政策或预订按钮 |

费用只接受用户录入、API 明确返回或可解释规则估算；未知费用保持 `unknown`。

## 快速启动

要求 Docker Engine / Docker Desktop 与 Compose v2。

```bash
cp .env.example .env
```

在 `.env` 中至少填写：

```dotenv
LLM_API_KEY=...
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
LLM_MAX_TOKENS=8192
LLM_STRUCTURED_RETRIES=1
MAX_AGENT_ITERATIONS=12

BAIDU_MAP_SERVER_AK=...
BAIDU_MAP_MAX_QPS=2

# 可选：公开网页研究
SERPER_API_KEY=

# 仅当容器需要通过宿主机代理访问外部服务时填写
CONTAINER_HTTP_PROXY=
```

`BAIDU_MAP_SERVER_AK` 使用百度开放平台服务端类型 AK，供 MCP 调用地点、路线和天气 Web API。前端基础底图使用 OpenStreetMap 主瓦片与 CARTO 备用瓦片，不再依赖百度浏览器端 AK；百度返回的 BD-09 坐标只在显示层转换后叠加。
`BAIDU_MAP_MAX_QPS` 默认设为 `2`，由百度 MCP 对地点、路线与天气请求统一平滑限流，并配合 API 结果缓存避免短时间突发调用。
服务端 AK 应按部署出口 IP 或百度平台支持的安全方式限制调用来源。

启动：

```bash
docker compose up --build
```

当前 Agent 主链路不加载 Skill、RAG 或向量模型。若容器依赖代理访问 DeepSeek、Serper 等外部服务，可将 `CONTAINER_HTTP_PROXY` 设置为 Docker 可访问的代理地址；Docker Desktop 通常使用 `http://host.docker.internal:<端口>`。

打开 [http://localhost:8080](http://localhost:8080)。就绪状态会明确显示 PostgreSQL、Redis、LLM、百度地图、12306 与小红书；核心项未就绪时创建按钮会禁用。

12306 只读查询默认启用；如需关闭，在 `.env` 写入 `ENABLE_12306_MCP=false`。该适配层每次查询通过 stdio 隔离调用固定版本的社区 MCP，不登录、不下单、不抢票，结果始终标记为社区数据源。

启用小红书只读攻略研究：

```bash
# .env
ENABLE_XHS_MCP=true
XHS_COOKIE=你自己的有效小红书 Cookie

docker compose up -d --build mcp-xhs api worker
```

Cookie 只保存在被 Git 忽略的本地 `.env` 中。适配层仅开放 Cookie 检查、笔记搜索和笔记读取，不开放发布、评论或其他写操作。Cookie 无效时就绪状态会明确报错，不回退到模拟攻略。

## 本地开发

后端使用 Python 3.12：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e 'apps/api[dev]'

PYTHONPATH=apps/api uvicorn app.main:app --reload --port 8000
```

前端：

```bash
cd apps/web
npm ci
npm run dev
```

本地 API 仍需要 PostgreSQL、Redis、mcp-baidu 和环境变量；推荐开发时也由 Compose 启动依赖。

## 验证

```bash
.venv/bin/ruff check apps/api/app apps/api/tests mcp_servers/baidu mcp_servers/rail mcp_servers/xhs
PYTHONPATH=. .venv/bin/pytest -q apps/api/tests

cd apps/web
npm run type-check
npm run build
```

填好真实 Key 后运行 31 条 Agent 路由/抽取评测：

```bash
PYTHONPATH=apps/api .venv/bin/python -m app.evals.runner
```

评测低于 90% 会返回非零退出码。场景位于 `packages/evals/agent_scenarios.json`。

完整 Compose 已启动且真实 Key 就绪后，运行端到端真链路（建 Trip → 组件中断/恢复 → 真实规划 → 版本提交 → SSE 重放）：

```bash
SUPERTRAVEL_E2E_BASE_URL=http://localhost:8080 \
  PYTHONPATH=apps/api:. .venv/bin/pytest -q \
  apps/api/tests/integration/test_real_chain.py
```

未设置 `SUPERTRAVEL_E2E_BASE_URL` 时，该真 Key 测试会明确跳过，不会改用模拟供应商数据。

## 项目结构

```text
apps/
├── api/app/
│   ├── agent/          # 7 节点 LangGraph 外壳与动态 Agent Loop
│   ├── api/            # Trip、Run、组件、Patch、SSE API
│   ├── domain/         # Trip State 与前后端契约
│   ├── services/       # 规划、校验、Patch、来源、事件、执行动作
│   ├── tools/          # MCP + Serper/Web Tool Gateway
│   └── workers/        # Watch 调度与 Decision 生成
└── web/src/            # Home、Agent Thread、时间线、百度地图、Today
mcp_servers/
├── baidu/              # 百度地图 MCP 适配器
├── rail/               # 固定版本的只读社区 12306 适配层
└── xhs/                # 可选的小红书只读攻略研究适配层
packages/evals/         # 30 条 Agent 场景
infra/nginx/            # Web 与 SSE 反向代理
docker-compose.yml
```

旧版 `agents/`、`backend/`、`frontend/` 保留为迁移参考，不参与新 Compose 的运行链路；正式 MVP 入口只使用 `apps/`。

更完整的领域边界、业务流程和失败语义见 [MVP 架构说明](docs/MVP_ARCHITECTURE.md)。视觉规范见 [DESIGN.md](DESIGN.md)。

## 当前不做

图片/链接输入、酒店房价和预订、支付/退款、邮件或系统推送、账号登录、多人协作、社区内容、Review、PDF/Markdown 导出，以及多个对用户可见的 Agent，不属于本次 MVP。
