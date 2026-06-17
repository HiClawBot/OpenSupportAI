# OpenSupportAI 白皮书

## 摘要

OpenSupportAI 是一套面向开发者和 SaaS 团队的开源 AI 智能客服组件。它的核心目标是让任意网站、App、SaaS、插件或内部系统可以快速集成 AI 客服能力，并使用自己的 LLM API、知识库、客服系统和业务工具，为自己的 end users 提供可控、可追踪、可转人工的客服服务。

OpenSupportAI 不试图替代所有客服平台，而是提供一个轻量、开放、可组合的 AI 客服运行时：

```text
Widget / SDK
→ Conversation API
→ AI Orchestrator
→ RAG Knowledge Service
→ LLM Gateway
→ Human Handoff Adapter
→ Observability / Evaluation
```

它的设计原则是：

- **可嵌入**：集成方只需要一段 script 或 SDK。
- **LLM-neutral**：不绑定某一家模型厂商。
- **RAG-first**：客服回答优先基于企业知识库，而不是凭空生成。
- **HITL-first**：人机协作优先，AI 不确定时转人工。
- **Adapter-first**：人工客服台、RAG 引擎、LLM Provider、业务系统都通过适配器接入。
- **Observability-first**：每次 AI 回复都可审计、可复盘、可评估。

---

## 背景

LLM 让客服自动化有了新的可能：企业可以将帮助中心、产品文档、政策说明、FAQ、订单/订阅信息和业务 API 连接到 AI 助手，让 AI 先回答常见问题，人工客服只处理复杂或高风险问题。

但直接把一个 Chatbot 接到生产客服场景，会遇到几个问题：

1. **集成复杂**：不同产品有不同用户系统、前端框架、鉴权方式和业务 API。
2. **客服语义复杂**：客服不是单轮问答，而是连续会话、上下文、人工转接、标签、状态和闭环。
3. **RAG 不稳定**：知识库命中不足时，LLM 容易自信地编造。
4. **LLM 供应商变化快**：企业不希望被锁死在某一家 API。
5. **已有客服系统不可替换**：很多团队已经在使用 Chatwoot、Zendesk、Intercom、Zammad、Tiledesk 或自研客服后台。
6. **审计和合规要求高**：客服会话涉及用户隐私、账单、退款、投诉和敏感数据。

OpenSupportAI 解决的是中间层问题：它不要求企业抛弃现有系统，而是为宿主应用提供一个统一的 AI 客服接入层。

---

## 产品定位

OpenSupportAI 是：

- AI 客服运行时。
- 可嵌入 Widget。
- Headless SDK。
- Conversation API。
- RAG 问答服务。
- LLM Provider Adapter。
- Human Handoff Adapter。
- AI 观测和评估基础设施。

OpenSupportAI 不是：

- 完整 CRM。
- 营销自动化平台。
- 复杂呼叫中心。
- 全渠道客服台。
- 可视化 Agent Builder 的第一优先级实现。
- 某个特定大模型 API 的封装壳。

---

## 目标用户

### SaaS 创业团队

希望快速为产品加入客服组件，减少基础客服咨询量，同时保留人工兜底。

### 企业内部平台团队

希望把内部知识库、工单系统、IT 支持、HR 政策和业务系统连接到统一 AI 助手。

### 开源/自托管用户

希望自己掌控模型 API、数据、部署环境和客服流程。

### 开发者平台

希望向第三方应用提供可嵌入 AI 支持能力，作为平台能力的一部分。

---

## 核心场景

### 场景一：产品帮助问答

用户在 SaaS 产品中问“如何取消订阅？”，系统从帮助中心检索“订阅取消流程”，生成简洁步骤并附上来源。

### 场景二：低置信度转人工

用户问“我的退款什么时候到账？”，知识库无法确认具体账户状态，AI 说明需要人工处理并发起转接。

### 场景三：人工接管

用户要求“我要找人工”，系统将会话、用户信息、历史消息和 AI 摘要推送到 Chatwoot。坐席在 Chatwoot 回复后，用户在原 Widget 中收到人工消息。

### 场景四：坐席辅助

后续版本中，AI 可以为坐席生成会话摘要、建议回复、标签和优先级。

### 场景五：业务工具调用

后续版本中，AI 在用户授权和策略允许下查询订单、订阅状态、物流、票据状态等业务数据。

---

## 设计原则

### 1. API-first

所有核心能力先通过 API 表达，UI 只是 API 的一种使用方式。这样开发者可以自由构建自己的 Widget、Mobile UI 或内部客服界面。

### 2. Headless-first

Widget 是默认实现，但 SDK 不绑定 UI。宿主应用可以用 React/Vue/Flutter/Swift/Kotlin 自己渲染。

### 3. Adapter-first

客服台、LLM Provider、RAG Engine、业务工具、Webhook 都是适配器。核心系统只维护统一协议和状态。

### 4. Conservative AI

客服 AI 应该保守：不知道就说不知道，没依据就转人工，不编造退款、价格、合同、政策或法律医疗建议。

### 5. Human-in-the-loop

AI 不替代人，而是减少重复问题、增强人工效率，并在高风险场景中主动交给人工。

### 6. Observable by default

每次 AI 回复都必须记录：模型、供应商、prompt version、检索结果、source refs、latency、tokens、confidence、handoff reason。

### 7. Tenant isolation

多租户系统中，任何知识库检索、会话查询、工具调用和日志读取都必须强制 project_id / organization_id 隔离。

---

## 架构总览

```text
End User App / Website
  │
  ├── Widget / SDK / Headless Client
  │
OpenSupportAI API Gateway
  │
  ├── Conversation Service
  │     ├── contacts
  │     ├── conversations
  │     ├── messages
  │     ├── assignments
  │     └── SSE events
  │
  ├── AI Orchestrator
  │     ├── intent detection
  │     ├── handoff detection
  │     ├── retrieval
  │     ├── LLM generation
  │     ├── grounding check
  │     └── fallback policy
  │
  ├── Knowledge Service
  │     ├── ingestion
  │     ├── parsing
  │     ├── chunking
  │     ├── embeddings
  │     └── retrieval
  │
  ├── LLM Gateway
  │     ├── OpenAI-compatible adapter
  │     ├── LiteLLM-compatible mode
  │     └── fallback / budget / logging
  │
  ├── Handoff Adapters
  │     ├── Chatwoot
  │     ├── Tiledesk
  │     ├── Zammad
  │     └── Generic Webhook
  │
  └── Admin Console
        ├── project settings
        ├── LLM provider config
        ├── knowledge management
        ├── integration config
        └── conversation viewer
```

---

## 模块说明

### Web Widget

Widget 是最直接的接入方式。它提供聊天气泡、消息列表、输入框、流式回复、转人工按钮和会话恢复能力。Widget 必须足够轻量，不污染宿主应用的 CSS 和 JavaScript 环境。

### Headless SDK

SDK 封装 Client API，让开发者可以自己构建 UI。它提供：

- createConversation
- sendMessage
- listMessages
- subscribe
- requestHandoff
- identifyUser
- updateMetadata

### Conversation Service

Conversation Service 是核心事实源。所有消息，无论来自 end user、AI、human agent、system 还是 tool，都进入统一消息表。LLM 不能直接改状态，必须通过服务接口。

### AI Orchestrator

AI Orchestrator 是客服决策管线。它决定：

- 是否回答。
- 是否检索知识库。
- 是否转人工。
- 是否追问用户。
- 是否调用业务工具。
- 如何记录 trace。

v0.1 不做复杂 Agent，而做稳定的 RAG 客服问答。

### Knowledge Service

Knowledge Service 管理知识来源、文档、chunk、embedding、source refs 和检索。它的首要目标不是最复杂，而是可靠、可解释、可隔离。

### LLM Gateway

LLM Gateway 抽象不同模型供应商。OpenSupportAI 第一版支持 OpenAI-compatible Chat Completion 和 Embedding API。生产环境可接 LiteLLM 作为统一代理。

### Handoff Adapter

Handoff Adapter 负责和人工客服系统通信。v0.1 首先实现 Chatwoot Adapter。后续增加 Tiledesk、Zammad、Slack、Email 和 Generic Webhook。

### Observability

系统内置 ai_runs 表，记录每次 AI 调用。后续可接 Langfuse、OpenTelemetry 和 Prometheus。

---

## MVP v0.1 范围

v0.1 的唯一核心目标是端到端闭环。验收标准：

1. 宿主网页通过 script 嵌入 Widget。
2. 用户能创建会话并发送消息。
3. AI 能基于知识库流式回答。
4. 无知识命中时 AI 不编造。
5. AI 回复保存到 messages。
6. 每次 AI 回复有 ai_run 记录。
7. 用户可请求人工。
8. Chatwoot 收到转人工会话。
9. Chatwoot 坐席回复回到 Widget。
10. 管理员可上传知识文档。
11. 管理员可配置 LLM Provider。
12. Docker Compose 可启动完整 demo。

---

## 安全与合规

OpenSupportAI 默认采用以下安全策略：

- 前端永远不暴露 LLM API Key。
- API Key 和集成密钥加密存储。
- 每条查询强制 project_id 隔离。
- RAG 检索按租户 namespace 过滤。
- Webhook 必须校验签名或 secret。
- AI 不直接执行高风险业务操作。
- 高风险工具调用需要二次确认。
- 日志支持敏感字段脱敏。
- 管理操作有审计记录。
- prompt injection 不作为单点防线，而通过权限、隔离、工具 allowlist、source grounding 共同防护。

---

## 开源策略

OpenSupportAI 采用宽松开源路线：

- 核心后端建议 Apache-2.0。
- Widget 和 SDK 建议 MIT。
- 文档建议 CC BY 4.0。
- 示例项目建议 MIT。

第三方项目只通过 API 适配，不复制其源码进入核心仓库。这样可以降低许可证风险，也保证 OpenSupportAI 的核心是可复用组件，而不是某个平台的重皮肤。

---

## 生态协作

OpenSupportAI 不和现有生态对立，而是成为连接层：

- Chatwoot：人工客服台。
- Tiledesk：可选客服平台和 AI Agent 平台。
- Zammad：工单系统。
- LiteLLM：模型网关。
- RAGFlow：高级 RAG 引擎。
- Qdrant/OpenSearch/Elasticsearch：检索后端。
- Langfuse：LLM observability。

---

## 成功指标

### 开发者指标

- 本地 demo 启动成功率。
- 从 clone 到嵌入 Widget 的步骤数量。
- SDK API 清晰度。
- adapter 扩展成本。

### 产品指标

- AI 首响率。
- AI 自助解决率。
- 人工转接率。
- 低置信度拦截率。
- 平均响应延迟。
- CSAT。
- 坐席接管后解决率。

### AI 质量指标

- 有来源回答比例。
- 无来源拒答比例。
- 误答率。
- prompt injection 防护测试通过率。
- 回归评测通过率。

---

## 路线图

### v0.1：端到端闭环

Widget、SDK、Conversation API、RAG、LLM Adapter、Chatwoot Adapter、Admin 简版、Docker Compose。

### v0.2：生产化

权限、多租户、安全审计、Langfuse、RAGFlow/Qdrant adapter、Webhook 管理、错误重试。

### v0.3：工具调用

OpenAPI Tool Connector、用户身份透传、工具权限、二次确认、订单查询 demo。

### v0.4：坐席辅助

AI 摘要、建议回复、标签、情绪识别、自动分流。

### v0.5：多渠道适配

Email、Slack、Telegram、Tiledesk、Zammad、Generic Webhook。v0.5.0 已先落地 Generic Webhook 入站 adapter，并把 Slack、Email、Telegram 纳入契约 stub。

### v1.0：稳定发行

稳定 API、稳定 SDK、稳定 Widget、Helm Chart、安全测试、性能压测、插件系统。

---

## 结论

OpenSupportAI 的价值在于：它把 AI 客服从“单个聊天机器人”提升为“可嵌入、可治理、可观测、可转人工的客服运行时”。企业可以使用自己的模型、自己的知识库、自己的客服系统，同时获得统一的 AI 客服体验。

第一版必须保持克制：不追求最完整的平台，而是先跑通最重要的闭环。只要 v0.1 能让开发者在自己的应用中嵌入 Widget、用知识库回答问题、在不确定时转人工，并完整记录 AI 运行过程，它就已经具备实用价值和开源吸引力。
