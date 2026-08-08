当前版本虽然已经有 LangGraph、Checkpoint、Interrupt、工具调用和 Trip State，但本质上仍是“LLM 驱动的固定工作流”，不是你想要的、能够根据任务动态规划、搜索、调用工具、观察结果并继续行动的 Agent。当前 27 个节点、固定澄清顺序以及由 Python 节点预先决定工具的结构，也正是造成执行过程僵硬、步骤冗长和界面像调试台的主要原因。

这次应当明确收缩范围：

* 保留一个对外可见的 SuperTravel Agent；
* 把固定 Graph 改成真正的动态 Agent Loop；
* 实现你截图中那种流式、可折叠的执行过程；
* 搜索、地图、小红书等工具结果必须带可点击来源；
* 暂时移除 Skill、RAG、复杂长期记忆和地图坐标精度问题；
* 保留 Trip State、PlanPatch、版本、组件交互和中断恢复能力。

## 一、当前系统为什么还不能算真正的 Agent

Anthropic 对两者的区分非常准确：

* Workflow：模型和工具沿预定义代码路径运行；
* Agent：模型动态决定执行过程和工具使用方式。

你现在的 27 节点 Graph 属于前者。目的地、日期、预算、同行人、研究、排程等路径都由代码提前固定；模型只是完成部分结构化抽取或生成任务，并没有决定“下一步需要做什么”。([Anthropic][1])

字节 CloudWeGo 的 Eino 官方文档也明确将两者分开：Graph 用于确定性编排，而 ChatModelAgent 以模型为决策器、工具为行动空间，通过 ReAct Loop 不断执行“推理—行动—反馈”；当核心需求是自主决策时，官方建议使用 Agent，而不是继续增加固定 Flow 节点。([CloudWeGo][2])

Codex 的核心也不是一个包含几十个业务节点的流程图，而是一个循环：

```text
用户目标
→ 模型判断下一步
→ 发起工具调用
→ Harness 执行工具
→ 将工具结果返回模型
→ 模型重新判断
→ 继续调用工具、询问用户或完成任务
```

这个循环持续到模型不再请求工具，并输出最终消息。Codex 将 Agent Loop 和执行逻辑统称为 Harness。([OpenAI][3])

因此，SuperTravel 的核心重构不是把 27 个节点优化成 20 个节点，而是：

> 从“代码提前规定每一步”改为“代码规定边界，模型决定下一步”。

---

# 二、你要展示的不是原始思维链，而是“可公开执行轨迹”

你截图中的体验可以实现，但产品中不应该直接展示模型的原始隐藏推理文本。

真正适合展示给用户的是四类信息：

1. Agent 当前在解决什么问题；
2. Agent 选择了什么行动；
3. Agent 实际调用了哪些工具；
4. Agent 根据哪些资料得出了什么阶段性结论。

可以将它命名为：

> Agent 执行过程
> Execution Trace / Research Progress

而不是“完整思维链”。

原始模型推理往往冗长、跳跃、包含被放弃的假设，不适合作为用户可见内容。Codex 的实现也将底层流式事件转换成客户端可消费的事件对象，用于分别呈现文本增量、工具调用、推理摘要和执行结果，而不是把所有内部状态原样打印出来。([OpenAI][3])

## 推荐的用户可见效果

例如用户输入：

> 帮我规划一次九月底带父母去云南的轻松旅行。

界面中的执行过程应当流式显示为：

```text
思考了 1m 36s

✓ 理解旅行需求
  识别到：云南、九月底、父母同行、轻松节奏
  云南范围较大，目前缺少具体旅行区域

● 比较适合的旅行区域
  正在查询昆明、大理—丽江和西双版纳的气候、
  交通强度与父母出行适配情况

  搜索了 4 个网站和 8 条社区内容
  [云南省文旅厅] [大理文旅] [小红书 8 条]

✓ 形成初步判断
  大理—丽江路线景观丰富，但跨城和步行较多
  西双版纳节奏更舒缓，但九月底降雨风险较高
  昆明及周边交通负担最低

需要你确认
  这次更看重哪一种体验？

  [昆明及周边]
  [大理—丽江]
  [西双版纳]
  [继续帮我比较]
```

用户确认以后，原 Run 从等待状态继续：

```text
✓ 已确认旅行区域：昆明及周边

● 核验适合父母的地点
  正在查询景点开放情况、游览时长和交通距离

  [百度地图：石林风景区]
  [昆明市文旅局：翠湖公园]
  [小红书：父母昆明慢游经验 5 条]

● 编排三日行程
  已将景点按空间距离分组
  正在控制每日步行量和连续游览时间

● 检查可执行性
  检查交通时间、开放时间、用餐和休息窗口

✓ 已生成首版计划
```

这才是用户需要的“思考过程”：能够理解系统在做什么，但不会看到 Prompt、JSON Schema、内部变量和大段模型草稿。

---

# 三、重新设计流式事件协议

现在前端看到的是持久化的 Graph 节点事件。新架构应改成一套与具体框架无关的 `Agent Event Protocol`。

建议用户侧只暴露这些事件：

```text
run.started
plan.created
progress.started
progress.delta
progress.completed

tool.started
tool.progress
source.discovered
tool.completed
tool.failed

question.created
question.answered

trip.draft.updated
trip.patch.preview
trip.patch.applied

message.delta
message.completed

run.waiting_user
run.completed
run.failed
run.cancelled
```

其中：

```json
{
  "event": "progress.started",
  "run_id": "run_123",
  "step_id": "step_research_destination",
  "title": "比较适合父母的云南旅行区域",
  "summary": "将从气候、交通和旅行强度三个方面进行比较"
}
```

搜索工具启动时：

```json
{
  "event": "tool.started",
  "run_id": "run_123",
  "tool_call_id": "call_01",
  "tool": "web_search",
  "display_name": "搜索官方旅游资料",
  "public_input": {
    "query": "九月底 云南 父母 轻松旅行 气候"
  }
}
```

找到来源时立即推送：

```json
{
  "event": "source.discovered",
  "tool_call_id": "call_01",
  "source": {
    "source_id": "src_001",
    "type": "official_web",
    "title": "云南秋季旅游提示",
    "publisher": "云南省文化和旅游厅",
    "url": "实际网页地址",
    "retrieved_at": "2026-07-17T10:20:00Z"
  }
}
```

前端收到后立即增加一个可点击的来源 Chip，而不需要等 Agent 最终回复完成。

你当前使用 SSE 完全可以继续保留。用户交互通过 REST 提交，服务端通过 SSE 单向推送进度，暂时不需要为了“实时”改成 WebSocket。

---

# 四、来源与超链接必须成为一等数据

现在工具返回的内容主要是模型上下文，来源信息没有完整进入最终产品。新架构里，来源不能只是回复末尾的一串 URL，而应该有独立的 `SourceRecord`。

```text
SourceRecord
├── source_id
├── run_id
├── tool_call_id
├── source_type
├── title
├── canonical_url
├── publisher
├── author
├── published_at
├── retrieved_at
├── query
├── snippet
└── credibility_level
```

来源类型建议至少区分：

```text
official_web       官方网站
map_provider       地图或 POI 平台
transport_provider 交通服务
weather_provider   天气服务
community          小红书等社区内容
news               新闻
user_input         用户自己提供
model_inference    模型推断，不是外部事实
```

## 1. 执行过程中的来源

例如：

```text
正在搜索昆明适合长辈的轻松景点

[百度地图 · 6 个地点]
[昆明市文旅局 · 2 篇]
[小红书 · 9 条笔记]
```

每一个 Chip 都可以点击打开来源列表。

## 2. 最终回复中的行内引用

例如：

> 石林景区通常需要预留半天以上的游览时间，并且景区内部步行距离较长，因此不建议与另一个大型郊区景点安排在同一天。¹ ²

其中 `¹ ²` 点击后显示：

* 百度地图地点详情；
* 用户社区游览经验；
* 查询时间；
* 来源类型。

## 3. 行程卡片中的事实来源

行程卡不能只有一个笼统的“百度地图核验”。

应按字段挂载来源：

```text
石林风景区

开放时间：07:30–18:00
[百度地图 · 18 分钟前]

建议游览：4–5 小时
[官方介绍] [社区经验 6 条]

预计交通：单程 1 小时 25 分钟
[百度路线 · 5 分钟前]
```

## 4. 小红书内容的定位

小红书适合提供：

* 游览体验；
* 拥挤程度；
* 实际踩坑；
* 适合拍照或休息的位置；
* 行程节奏经验。

它不应作为开放时间、票价、政策等关键事实的唯一依据。

来源标签应明确写成“社区经验”，而不是“已核验事实”。

搜索适配器必须返回真实可访问的笔记 URL。只有标题或摘要、没有原始链接的结果不能伪装成可点击引用。

---

# 五、真正的 SuperTravel Agent Loop

建议彻底删除“每个业务字段一个 Graph 节点”的设计。

新的主循环只需要模型输出有限的行动类型：

```typescript
type AgentAction =
  | AskUserAction
  | CallToolsAction
  | UpdateWorkingPlanAction
  | ProposeTripPatchAction
  | RespondAction
  | FinishAction;
```

例如模型认为目的地范围不明确：

```json
{
  "type": "ask_user",
  "reason_summary": "云南范围较大，区域选择会显著改变行程",
  "component": {
    "type": "destination_choice",
    "options": [
      "昆明及周边",
      "大理—丽江",
      "西双版纳",
      "继续比较"
    ]
  }
}
```

模型认为需要搜索：

```json
{
  "type": "call_tools",
  "reason_summary": "需要比较不同区域的气候和旅行强度",
  "calls": [
    {
      "tool": "web_search",
      "arguments": {
        "query": "九月底 昆明 父母 轻松旅行"
      }
    },
    {
      "tool": "rednote_search",
      "arguments": {
        "query": "带父母 昆明 慢游"
      }
    }
  ]
}
```

Harness 执行完工具后，把结构化结果重新交给模型。模型可能决定：

* 继续搜索；
* 换一个查询词；
* 调用地图工具；
* 询问用户；
* 开始编排行程；
* 输出最终结论。

完整流程应是：

```text
读取当前状态
→ 模型决定下一步
→ 展示公开执行摘要
→ 执行工具或等待用户
→ 获取真实环境反馈
→ 更新上下文
→ 模型重新决定
→ 直到完成、等待或达到停止条件
```

Anthropic 的生产经验同样指出，Agent 通常就是模型基于环境反馈循环使用工具，并在阻塞点或检查点请求人类反馈；同时必须设置最大迭代次数等停止条件。([Anthropic][1])

---

# 六、推荐的底层 Harness 架构

```text
Web Client
│
├── Agent Conversation
├── Streaming Trace Renderer
├── Generative UI Renderer
├── Trip Timeline
└── Map
        │
        │ REST + SSE
        ▼
Run API
        │
        ▼
SuperTravel Agent Harness
│
├── Run Manager
├── Agent Loop
├── Context Compiler
├── Model Adapter
├── Tool Gateway
├── Policy Engine
├── Trip Patch Manager
├── Event Emitter
└── Source / Citation Manager
        │
        ├── Trip Service
        ├── PostgreSQL Event Store
        ├── Tool Adapters
        └── External Services
```

## 1. Agent Loop

负责模型—工具—观察—再推理的循环。

## 2. Run Manager

负责：

```text
QUEUED
RUNNING
WAITING_USER
SUCCEEDED
PARTIAL
FAILED
CANCELLED
```

以及暂停、恢复、取消、超时和最大步数。

## 3. Context Compiler

每次模型调用前动态构造上下文，而不是固定塞入最近 12 条消息。

当前暂时只需要：

```text
系统行为规则
当前用户输入
当前等待中的组件
当前 Trip State 摘要
当前 Plan
本轮工作计划
最近必要对话
本轮工具结果
```

## 4. Tool Gateway

第一阶段工具建议控制在：

```text
web_search
web_fetch
rednote_search

place_search
place_detail
route_search

weather_search
rail_search

trip_read
trip_validate
trip_patch_preview
trip_patch_commit
```

模型可以自主选择工具，但 Harness 决定：

* 工具是否允许调用；
* 参数是否合法；
* 是否需要确认；
* 是否允许并行；
* 超时和重试；
* 返回哪些内容给模型；
* 哪些内容展示给用户。

Anthropic 强调 Tool 接口本身需要像用户界面一样认真设计；清晰的参数、边界、示例和防错设计会显著影响 Agent 使用工具的可靠性。([Anthropic][1])

## 5. Policy Engine

低风险操作自动执行：

* 搜索资料；
* 查询地图；
* 查询天气；
* 读取 Trip；
* 生成草案；
* 校验行程。

高影响操作停止确认：

* 修改已确认行程；
* 删除项目；
* 改变日期或目的地；
* 移动预约项目；
* 突破预算；
* 提交外部交易。

Codex 采用的也是“低风险操作尽量不中断，高风险操作明确审批”的运行边界，并为行为保留专门的遥测和审计记录。([OpenAI][4])

---

# 七、LangGraph 应该保留，但只能做运行时外壳

不建议现在彻底移除 LangGraph，因为你已经实现了：

* PostgreSQL Checkpoint；
* Interrupt；
* Resume；
* Run 状态；
* UI Component 恢复。

这些都可以复用。

但是 Graph 应从 27 个业务节点缩减成大约 5—7 个通用节点：

```text
START
  ↓
bootstrap
  ↓
model_decide
  ├── tool_execute ───────┐
  │                       │
  ├── wait_user ──────────┤
  │                       │
  ├── validate_patch ─────┤
  │                       │
  └── final_response      │
                          │
           model_decide ◀─┘
  ↓
END
```

其中：

### `bootstrap`

读取 Trip、Thread、Run 和待处理组件。

### `model_decide`

模型根据当前上下文输出下一项 `AgentAction`。

### `tool_execute`

执行一个或多个工具，将结果加入事件流和上下文，然后回到 `model_decide`。

### `wait_user`

生成时间、地点、预算等对话组件并 `interrupt()`。

### `validate_patch`

校验 Agent 提议的 Trip 修改，必要时等待用户确认。

### `final_response`

流式输出最终答复并结束 Run。

不要再设置：

```text
clarify_destination
clarify_dates
clarify_budget
clarify_travelers
clarify_preferences
clarify_priorities
...
```

Agent 根据缺少的信息和信息价值，自主选择 `ask_user`，组件渲染器根据 Schema 展示相应组件。

这样 LangGraph 管理的是：

* 循环；
* 中断；
* 恢复；
* 运行状态。

模型管理的是：

* 下一步行动；
* 工具选择；
* 是否继续研究；
* 是否需要询问用户；
* 何时可以生成结果。

这与 Eino 官方的 `ChatModelAgent + Middleware + Runner + TurnLoop` 分工非常接近：模型负责 ReAct 决策，Middleware 注入压缩、重试等运行能力，Runner 输出事件流，TurnLoop 负责多轮、取消和恢复。([CloudWeGo][2])

---

# 八、会话、上下文和记忆：暂时不需要 RAG

你现在的判断合理：RAG 暂时不会提升核心旅行 Agent 的工作能力，反而增加链路复杂度。

当前先保留三层状态即可。

## 1. Session Event Log

完整保存所有事件：

* 用户消息；
* 模型输出；
* 工具调用；
* 工具结果；
* 来源；
* 组件；
* Trip Patch；
* 用户确认；
* 异常。

这是可恢复的原始记录，不直接全部放进模型上下文。

## 2. Agent Working Context

每次模型调用只选择当前有用的信息：

* 当前任务；
* 最近关键消息；
* 当前 Todo；
* 必要工具结果；
* 当前 Trip 摘要。

## 3. Trip State

结构化保存：

* 目的地；
* 日期；
* 同行人；
* 约束；
* 当前计划；
* 已确认事实；
* 待决定事项；
* 版本。

Anthropic 在 Managed Agents 架构中也明确将 Session Event Log 与模型 Context Window 分离：Session 是可持久化、可重放的完整事件对象；Harness 决定每次从中选择哪些内容进入模型上下文。这样 Harness 或执行环境发生故障后，可以基于事件记录恢复，而不需要依赖进程内状态。([Anthropic][5])

因此暂时删除：

* `reference` 节点；
* `knowledge_documents` 主链路；
* 目的地研究中的 RAG 检索；
* 向量召回和 RRF；
* 自动长期记忆候选。

数据库表可以保留，但不进入主流程。

长期偏好第一阶段只保留明确结构化字段：

```text
不早起
不吃生食
步行强度低
偏好慢节奏
```

没有必要通过向量检索获取。

---

# 九、Skill 也暂时不要做

Skill 的价值在于大量能力需要按需加载和复用时，减少 Prompt 膨胀。

你目前只有一个旅行 Agent 和十个左右工具，还没有出现必须引入 Skill 的复杂度。

第一阶段只需：

```text
System Prompt
Tool Registry
AgentAction Schema
Policy Rules
Trip Validator
```

不要同时建设：

* Skill Registry；
* 子 Agent 系统；
* RAG；
* 多 Agent 调度；
* MCP 全工具化。

MCP 只保留已有且有价值的 12306 接入即可。地图、天气、搜索继续用强类型 Python Adapter，工程上更直接。

---

# 十、前端需要彻底区分“用户执行过程”和“开发 Trace”

## 用户执行过程

显示：

```text
理解了什么
准备做什么
搜索了什么
找到了哪些来源
正在核验什么
遇到了什么问题
为什么需要用户确认
最终形成什么结果
```

## 开发者 Trace

单独进入调试页面，显示：

```text
完整模型输入
原始模型输出
Reasoning 数据
Tool 参数
Tool 原始响应
Token 使用量
节点状态
Checkpoint
重试
异常堆栈
```

阿里 AgentScope 的官方设计也是通过 OpenTelemetry 对模型、工具、Agent、Formatter 和异常进行统一追踪，并将这些内容放入开发者可观测系统，而不是直接作为普通用户聊天内容。([AgentScope][6])

国内资料中，字节 Eino 的官方文档对 Agent Loop、Middleware、事件流和恢复机制最有直接参考价值；阿里 AgentScope 对运行追踪和可观测性有较成熟的设计。阿里云和腾讯云开发者社区的工程文章则普遍强调 Agent 需要可预测、可追踪、可兜底，以及推理、规划和工具交互闭环，但这些社区文章属于作者投稿，不应当等同于企业官方架构规范。([阿里云开发者社区][7])

---

# 十一、当前代码的保留与删除

## 直接保留

* Trip；
* TripSpec；
* PlanVersion；
* PlanPatch；
* ConversationThread；
* AgentRun；
* UIComponent；
* ToolCall；
* Event；
* LangGraph PostgreSQL Checkpoint；
* SSE；
* Interrupt / Resume；
* 百度地图、天气、12306、小红书和网页搜索适配器；
* 版本和撤销机制。

## 重构

* `graph.py`：从 27 个节点改成通用 Agent Loop；
* `llm.py`：从七个固定任务 Prompt 改成统一 Agent Prompt；
* 当前执行事件：改成用户事件协议与开发 Trace 两套；
* 搜索工具：所有结果必须返回 SourceRecord；
* 最终输出：支持行内 Citation；
* 前端执行过程：从调试日志改为流式进度树。

## 暂时停用

* RAG；
* `reference` 节点；
* 向量数据库主链路；
* Skill；
* Subagent；
* 自动长期记忆；
* 地图坐标精度优化；
* 复杂主动 Watch。

---

# 十二、推荐的实施顺序

第一阶段先完成真正的 Agent Loop：

```text
统一 AgentAction Schema
→ 动态工具调用
→ 工具结果回传模型
→ 多轮循环
→ 最大步数和取消
→ AskUser Interrupt
```

第二阶段完成流式产品体验：

```text
用户执行事件协议
→ 公开进度摘要
→ Tool 实时状态
→ SourceRecord
→ 可点击来源
→ 最终回复行内引用
```

第三阶段接回 Trip：

```text
Agent 读取 Trip
→ 生成 Trip Draft
→ 规则校验
→ PlanPatch Preview
→ 用户确认
→ 提交版本
```

第四阶段再完善页面协同：

```text
对话执行过程
↔ 时间线
↔ 地图
↔ 来源面板
```

最终目标架构应概括为：

> **LangGraph 负责耐久运行、暂停与恢复；SuperTravel Harness 负责 Agent Loop、上下文、工具、来源、策略和事件；模型根据任务与环境反馈动态决定下一步；Trip State 负责保存最终可信业务状态。**

这才会从当前的“固定旅行工作流”升级为能够真正研究、行动、观察、调整并与用户协作的旅行 Agent。

[1]: https://www.anthropic.com/engineering/building-effective-agents "Building Effective AI Agents \ Anthropic"
[2]: https://www.cloudwego.io/zh/docs/eino/core_modules/eino_adk/agent_quickstart/ "Quickstart | CloudWeGo"
[3]: https://openai.com/index/unrolling-the-codex-agent-loop/ "Unrolling the Codex agent loop | OpenAI"
[4]: https://openai.com/ja-JP/index/running-codex-safely/ "OpenAI における Codex の安全な運用 | OpenAI"
[5]: https://www.anthropic.com/engineering/managed-agents "Scaling Managed Agents: Decoupling the brain from the hands \ Anthropic"
[6]: https://doc.agentscope.io/tutorial/task_tracing.html "Tracing - AgentScope"
[7]: https://developer.aliyun.com/article/1708881?utm_source=chatgpt.com "智能体来了：从0 到1：企业级LLM Agent 的工程化落地实践"
