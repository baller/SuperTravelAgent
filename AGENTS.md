# 仓库贡献指南

## 项目结构与模块组织

- `agents/` 是多智能体核心，包含各类智能体、任务模型、工具、配置和通用工具函数。
- `backend/` 提供 FastAPI 应用、REST/WebSocket 接口、配置加载逻辑，以及位于 `backend/static/` 的前端构建产物。
- `frontend/src/` 存放 React/TypeScript 界面。可复用界面组件放在 `components/`，状态提供器放在 `context/`，Hooks 放在 `hooks/`，共享样式放在 `styles/`。
- `mcp_servers/` 包含 MCP 集成和服务器配置示例；产品截图位于现有的 `asserts/` 目录。

不要手动修改 `backend/static/assets/` 中带哈希的文件；运行 `npm run build` 会重新生成这些文件。

## 构建、测试与开发命令

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp backend/config_example.yaml backend/config.yaml
(cd backend && python main.py)
```

以上命令用于创建虚拟环境、安装依赖、生成本地配置并启动 FastAPI。真实 API 密钥只能保存在已被 Git 忽略的 `backend/config.yaml` 中。

```bash
cd frontend
npm ci                 # 按锁文件安装前端依赖
npm run dev            # 在 http://localhost:8080 启动 Vite
npm run type-check     # 执行严格的 TypeScript 类型检查
npm run build          # 将生产构建输出到 backend/static
```

提交 Python 修改前运行 `ruff check agents backend mcp_servers`。仓库虽然声明了前端 lint 脚本，但尚未提交 ESLint 配置和依赖，因此当前以 `type-check` 和 `build` 作为必要的前端检查。

## 编码风格与命名规范

Python 使用四空格缩进；模块和函数采用 `snake_case`，类采用 `PascalCase`，公共接口应提供类型标注。异步 I/O 明确使用 `async`/`await`。TypeScript 遵循现有的两空格缩进和行末分号风格；组件命名为 `PascalCase.tsx`，Hook 命名为 `useThing.ts(x)`，变量和函数使用 `camelCase`。API 数据结构应声明明确类型，已有稳定结构时避免使用 `any`。

## 测试指南

仓库目前没有自动化测试套件或覆盖率门槛。每次修改至少应通过 Ruff、TypeScript 类型检查和生产构建。后端改动需冒烟测试 `/docs` 以及受影响的 REST/WebSocket 流程；界面改动需在桌面和窄屏尺寸下检查对应路由。引入测试时，请同时添加测试运行器配置，并更新 `.gitignore`；它目前会忽略 Python 的 `test_*.py` 和 `*_test.py` 文件。

## 提交与拉取请求规范

现有历史多使用简短祈使句，但也存在含义模糊的 `update`。新提交应使用具体描述，例如 `fix websocket session cleanup` 或 `add MCP search timeout`，并保持单一关注点。拉取请求应说明用户可见变化、配置影响和验证命令，关联相关 Issue；界面改动需附修改前后截图。禁止提交 API 密钥、本地配置、日志、会话数据或生成的缓存。
