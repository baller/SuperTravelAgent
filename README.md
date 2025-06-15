[![English](https://img.shields.io/badge/English-Click-yellow)](README.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-brightgreen.svg)](https://python.org)
[![Version](https://img.shields.io/badge/Version-1.0-green.svg)](https://github.com/ZHangZHengEric/SuperTravelAgent)


# 🚀 SuperTravelAgent 旅游规划智能体



SuperTravelAgent 是一个多智能体旅游规划智能体，通过无缝衔接的智能体协作，智能地将复杂的旅游需求分解为可管理的规划任务。

**🌟 ：集成了百度地图、12306火车票、小红书社交内容、实时网络搜索等MCP，为旅游规划提供前所未有的数据支撑和服务能力。**

## ✨ 核心亮点

🧠 **智能旅程规划** - 自动将复杂旅游需求分解为可管理的任务，支持行程依赖关系跟踪  
🔄 **六大智能体协作** - 专业旅游智能体间的无缝协调，具备强大的错误处理机制  
🛠️ **强大工具生态** - 集成百度地图、12306、小红书、网络搜索等MCP
🌐 **现代化Web界面** - React + TypeScript前端，FastAPI后端，实时WebSocket通信   
⚙️ **丰富配置系统** - 环境变量、配置文件、多模型支持和热重载  


## 🏗️ 架构概览

SuperTravelAgent 采用现代化多智能体协作架构，结合了强大的后端服务和业界最完整的旅游工具生态系统：

```mermaid
graph TB
    subgraph "🌐 前端应用"
        A[React + TypeScript 界面] --> B[Ant Design UI组件]
        B --> C[WebSocket实时通信]
        C --> D[智能体状态可视化]
    end
    
    subgraph "⚡ FastAPI后端"
        E[REST API接口] --> F[WebSocket管理器]
        F --> G[配置管理系统]
        G --> H[会话管理]
    end
    
    subgraph "🤖 多智能体系统"
        I[智能体控制器] --> J[任务分析智能体]
        I --> K[任务分解智能体]
        I --> L[规划智能体]
        I --> M[执行智能体]
        I --> N[观察智能体]
        I --> O[总结智能体]
    end
    
    subgraph "🛠️ 专业旅游工具生态"
        P[工具管理器] --> Q[🗺️ 百度地图MCP]
        P --> R[🚄 12306火车票MCP]
        P --> S[📱 小红书MCP]
        P --> T[🔍 网络搜索MCP]
        P --> U[📁 文件系统MCP]
        P --> V[🌐 HTTP请求MCP]
        
        Q --> Q1[地理编码/逆编码]
        Q --> Q2[POI搜索]
        Q --> Q3[路线规划]
        Q --> Q4[周边搜索]
        
        R --> R1[列车时刻表]
        R --> R2[余票查询]
        R --> R3[中转搜索]
        R --> R4[过站信息]
        
        S --> S1[旅游笔记搜索]
        S --> S2[用户体验分析]
        S --> S3[热门景点发现]
        S --> S4[社交内容筛选]
        
        T --> T1[实时信息搜索]
        T --> T2[旅游资讯获取]
        T --> T3[价格信息查询]
    end
    
    subgraph "📊 监控统计"
        W[Token使用跟踪] --> X[成本分析]
        X --> Y[性能监控]
        Y --> Z[会话统计]
    end
    
    A --> E
    E --> I
    I --> P
    I --> W
    P --> M
    
    style A fill:#e1f5fe
    style I fill:#fff3e0
    style P fill:#f3e5f5
    style W fill:#e8f5e8
    style Q fill:#e8f5e8
    style R fill:#fff3e0
    style S fill:#ffebee
    style T fill:#f3e5f5
```

### 🔄 智能体工作流程

```mermaid
graph TD
    A[🔍 用户旅游需求] --> B[📋 任务分析智能体]
    B --> C[🎯 任务分解智能体]
    C --> D[📝 规划智能体]
    D --> E[⚡ 执行智能体]
    E --> F[👁️ 观察智能体]
    F --> G{任务完成?}
    G -->|否| D
    G -->|是| H[📄 总结智能体]
    H --> I[🎉 旅游方案输出]
    
    subgraph "🛠️ 专业旅游工具矩阵"
        E --> J[🗺️ 百度地图服务]
        E --> K[🚄 12306火车票服务]
        E --> L[📱 小红书内容服务]
        E --> M[🔍 实时搜索服务]
        E --> N[📁 文件管理服务]
        
        J --> J1[位置搜索 & 路线规划]
        K --> K1[火车票查询 & 预订建议]
        L --> L1[旅游攻略 & 用户评价]
        M --> M1[实时信息 & 价格对比]
        N --> N1[行程保存 & 文档管理]
    end
    
    style A fill:#e1f5fe
    style I fill:#e8f5e8
    style B fill:#fff3e0
    style E fill:#f3e5f5
    style J fill:#e8f5e8
    style K fill:#fff3e0
    style L fill:#ffebee
    style M fill:#f3e5f5
```

## 🚀 快速开始

### 📦 安装

```bash
# 克隆项目
git clone https://github.com/
cd SuperTravelAgent

# 安装Python依赖
pip install -r requirements.txt

# 安装前端依赖
cd frontend
npm install

# 启动前端
npm run dev

# 启动后端
cd backend
python main.py
```

然后在浏览器中访问 `http://localhost:8080` 体验SuperTravelAgent旅游规划智能体。

#### ⚙️ 配置API密钥


**DeepSeek (推荐)**
```
API密钥: your-deepseek-api-key
模型: deepseek-chat
API地址: https://api.deepseek.com/v1
```

**OpenRouter (多模型访问)**
```
API密钥: your-openrouter-api-key
模型: deepseek/deepseek-chat
API地址: https://openrouter.ai/api/v1
```

**OpenAI**
```
API密钥: your-openai-api-key
模型: gpt-4o
API地址: https://api.openai.com/v1
```

## 🎯 核心功能

### 🤖 **六大智能体协作系统**

#### 1. 任务分析智能体 (TaskAnalysisAgent)
- **深度需求理解**: 分析用户旅游需求的细节和偏好
- **上下文提取**: 识别预算、时间、目的地、兴趣点等关键信息
- **统一系统提示管理**: 为后续智能体提供一致的上下文理解

#### 2. 任务分解智能体 (TaskDecomposeAgent)
- **智能任务分解**: 将复杂旅游规划分解为可管理的子任务
- **依赖关系分析**: 识别任务间的逻辑依赖和执行顺序
- **并行规划支持**: 支持同时进行多个独立任务的规划

#### 3. 规划智能体 (PlanningAgent)
- **战略性行程设计**: 基于分解任务制定详细的执行计划
- **资源优化**: 最优工具选择和资源分配
- **风险评估**: 识别潜在问题并制定备选方案

#### 4. 执行智能体 (ExecutorAgent)
- **智能工具调用**: 自动选择和使用合适的工具完成任务
- **错误恢复机制**: 自动处理工具执行失败和异常情况
- **并行处理**: 支持同时执行多个独立的工具调用

#### 5. 观察智能体 (ObservationAgent)
- **进度监控**: 实时跟踪任务执行进度和状态
- **质量评估**: 评估执行结果的完整性和质量
- **完成度检测**: 智能判断任务是否达到预期目标

#### 6. 总结智能体 (TaskSummaryAgent)
- **结果综合**: 将所有执行结果整合为完整的旅游方案
- **结构化输出**: 生成清晰、可操作的旅游建议
- **价值提炼**: 提取关键信息和实用建议

### 🛠️ **强大的旅游工具生态系统**

SuperTravelAgent 集成了强大的专业旅游工具生态系统，通过Model Context Protocol (MCP) 提供无缝的服务集成：

#### 🗺️ **百度地图MCP**
```
🌟 核心能力: 中国最权威的地图和位置服务
```
- **地理编码服务**: 地址转坐标、坐标转地址，支持模糊匹配
- **POI搜索**: 周边景点、餐厅、酒店、交通站点智能搜索
- **路线规划**: 多种出行方式（步行、驾车、公交）最优路线计算
- **周边探索**: 基于位置的周边服务发现和推荐
- **距离计算**: 精确的距离和时间估算


#### 🚄 **12306火车票MCP**
```
🌟 核心能力: 中国铁路官方数据，最准确的火车票信息
```
- **列车时刻表查询**: 实时列车班次、时间、价格信息
- **余票实时查询**: 各车次座位余票情况动态监控
- **中转搜索**: 智能中转方案推荐和优化
- **过站信息**: 列车途经站点详细信息
- **车次筛选**: 根据时间、价格、车型智能筛选


#### 📱 **小红书社交内容MCP**
```
🌟 核心能力: 最丰富的用户原创旅游内容和真实体验分享
```
- **旅游笔记搜索**: 基于目的地的用户旅游经验和攻略
- **热门景点发现**: 社交平台热门打卡地和网红景点
- **用户评价分析**: 真实用户体验和评价数据挖掘
- **旅游趋势洞察**: 最新旅游趋势和热门目的地发现
- **内容筛选**: 高质量旅游内容智能筛选和推荐


#### 🔍 **Serper网络搜索MCP**
```
🌟 核心能力: 实时网络信息搜索和数据聚合
```
- **实时信息搜索**: 最新的旅游资讯、政策、天气等信息
- **价格信息聚合**: 机票、酒店、门票价格对比
- **新闻资讯获取**: 目的地最新动态和重要信息
- **多源信息整合**: 整合多个信息源的综合搜索结果

#### 📁 **文件系统管理MCP**
```
🌟 核心能力: 旅游规划结果的持久化存储和管理
```
- **行程文档保存**: 自动保存生成的旅游规划文档
- **多格式支持**: 支持JSON、Markdown等多种格式
- **版本管理**: 旅游计划的版本控制和历史记录
- **文件共享**: 生成可分享的旅游计划链接

#### 🌐 **HTTP请求服务 (Fetch MCP)**
```
🌟 核心能力: 灵活的HTTP请求能力，支持各种API调用
```
- **API集成**: 与第三方旅游服务API无缝集成
- **数据获取**: 从各种在线服务获取实时数据
- **内容抓取**: 智能网页内容提取和分析

### 🎨 **工具协作示例**

以下是各个专业工具如何协作完成复杂旅游规划任务的示例：

```python
# 用户询问: "帮我规划一次北京到上海的3天商务旅行"
# 
# 智能体协作流程:
# 1. 任务分析智能体 - 理解需求: 商务旅行、3天、北京到上海
# 2. 任务分解智能体 - 分解任务: 交通、住宿、行程、预算
# 3. 规划智能体 - 制定计划: 调用多个MCP服务
#    - 百度地图: 查询北京/上海重要商务区位置
#    - 12306: 查询北京到上海的高铁班次
#    - 小红书: 搜索上海商务酒店推荐
#    - 网络搜索: 查询上海天气和商务活动信息
# 4. 执行智能体 - 并行执行: 同时调用各个MCP服务
# 5. 观察智能体 - 监控质量: 确保信息完整性和准确性
# 6. 总结智能体 - 生成方案: 整合所有信息生成完整旅行计划
```


## 📁 项目结构

```
SuperTravelAgent/
├── 📁 agents/                  # 智能体核心模块
│   ├── 📁 agent/              # 智能体实现
│   │   ├── agent_controller.py    # 智能体控制器
│   │   ├── agent_base.py          # 智能体基类
│   │   ├── task_analysis_agent/   # 任务分析智能体
│   │   ├── task_decompose_agent/  # 任务分解智能体
│   │   ├── planning_agent/        # 规划智能体
│   │   ├── executor_agent/        # 执行智能体
│   │   ├── observation_agent/     # 观察智能体
│   │   └── task_summary_agent/    # 总结智能体
│   ├── 📁 tool/               # 工具系统
│   │   ├── tool_manager.py        # 工具管理器
│   │   └── tool_base.py          # 工具基类
│   ├── 📁 config/             # 配置管理
│   └── 📁 utils/              # 工具函数
├── 📁 backend/                # FastAPI后端
│   ├── main.py                # 主服务器文件
│   ├── config.yaml           # 后端配置
│   └── config_loader.py      # 配置加载器
├── 📁 frontend/               # React前端
│   ├── 📁 src/
│   │   ├── App.tsx           # 主应用组件
│   │   ├── 📁 components/    # UI组件
│   │   ├── 📁 hooks/         # React Hooks
│   │   └── 📁 utils/         # 前端工具
│   ├── package.json          # 前端依赖
│   └── vite.config.ts        # Vite配置
├── 📁 mcp_servers/            # MCP服务器配置
│   ├── mcp_setting.json      # MCP服务器配置文件
│   ├── 📁 search/            # 搜索MCP服务器
│   └── 📁 xhs-mcp/           # 小红书MCP服务器
├── 📁 outputs/                # 输出结果目录
└── requirements.txt           # Python依赖
```



### REST API
启动后端后，访问 `http://localhost:8000/docs` 查看完整的API文档。




## 🙏 致谢

感谢以下项目和服务为SuperTravelAgent提供的支持：
- **百度地图** 提供权威的地理位置服务
- **12306** 提供官方火车票数据支持
- **小红书** 提供丰富的旅游社交内容
- **OpenAI & DeepSeek** 提供强大的AI模型支持
- **FastAPI & React** 提供现代化的技术框架
- **Model Context Protocol** 提供标准化的工具集成协议
- **Sage** - 提供智能体协作框架支持 [GitHub](https://github.com/ZHangZHengEric/Sage)
- **PowerPaint** - 提供强大的图像处理能力 [GitHub](https://github.com/open-mmlab/PowerPaint)
---

**SuperTravelAgent** - 强大的智能旅游规划专家 ✈️🌍
