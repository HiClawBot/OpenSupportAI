# OpenSupportAI

<p align="center">
  <img src="./docs/assets/opensupportai.png" alt="OpenSupportAI logo" width="560" />
</p>

<p align="center">
  <strong>Open-source, embeddable, LLM-native AI support runtime.</strong><br />
  <strong>开源、可嵌入、LLM-native 的 AI 智能客服运行时。</strong>
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

---

## English

OpenSupportAI gives SaaS products, internal tools, apps, and websites a project-scoped AI support layer with a chat widget, headless SDK, conversation API, knowledge-grounded answers, human handoff, and admin workflows.

The v1.0 release is intentionally focused: it is not a full CRM or ticketing suite, and it does not copy Chatwoot, Tiledesk, or Zammad. Instead, OpenSupportAI provides the AI support runtime that can receive messages from channels, index support knowledge, run allowlisted business tools, generate knowledge-grounded answers, and hand conversations to those systems.

### What Works in v1.0

- Fastify API with health, client conversation, message, SSE events, handoff, admin, knowledge, LLM config, Chatwoot config, and webhook endpoints.
- Prisma schema and migrations for PostgreSQL with stored knowledge document content, content hashes, status/error metadata, and pgvector-ready knowledge chunks.
- In-memory demo storage for instant local development without Docker or a database.
- Seeded demo project: `proj_demo`, public key `pk_demo`, default inbox `inbox_default`, admin token `admin_demo_key`.
- LLM-backed grounded answer generation through configured OpenAI-compatible providers, with deterministic fallback for demo/no-provider/error paths and a no-hit no-hallucination refusal.
- OpenAI-compatible LLM and embedding client package.
- Headless JavaScript SDK.
- Embeddable browser widget with Shadow DOM UI, SSE updates, conversation persistence, source references, and handoff action.
- React admin console for projects, conversation operations, knowledge documents and reindexing, LLM settings, Chatwoot settings, channel operations, admin API keys, audit logs, async jobs, webhook events, and tool-call logs.
- Admin conversation operations: status/search filters, summary metrics, contact labels, recent-message previews, message counts, and latest handoff status.
- React demo app showing a SaaS billing page with the widget embedded.
- Chatwoot handoff integration: creates contacts/conversations, pushes handoff summaries and transcript messages, stores external IDs, maps public agent replies back into local `human_agent` messages, tests connectivity, retries failed handoffs, and syncs Chatwoot resolved/open status.
- Configurable in-process API rate limiting with standard `rate_limited` errors and `x-ratelimit-*` headers.
- Lease-backed async jobs with atomic PostgreSQL claims, heartbeats, stale-job recovery, owner fencing, graceful worker drain, and real `answer.generate` and `knowledge.index` handlers.
- Production foundation APIs and admin console views for project-scoped admin API keys, audit logs, ops health, async jobs, and webhook event inspection.
- Persisted conversation/message idempotency keys, stable cursor pagination, tenant-safe relational constraints, per-project answer concurrency limits, and bounded LLM requests.
- Business tool execution with allowlisted tool definitions, tool-call logs, deterministic demo order/subscription lookup tools, and OpenAPI-style HTTP tool execution with host allowlists, timeouts, response shaping, answer templates, environment-backed bearer auth, and mutation guards.
- Agent-assist foundation with deterministic conversation summaries, suggested replies, tags, and handoff analytics.
- Multi-channel adapter foundation with a tested generic webhook inbound adapter, a signed Slack Events API inbound adapter, admin adapter catalog/test/config APIs, and email/Telegram contract stubs.
- Stable v1.0 public contracts for the REST API, JavaScript SDK, Widget initialization API, Chatwoot handoff adapter, generic/Slack inbound channel adapters, and OpenAPI-style business tool executor.
- Production deployment, upgrade, security, and release validation documentation for self-hosted operators.
- GitHub Actions CI and a live Chatwoot smoke-test script for release validation.
- Docker Compose stack for PostgreSQL/pgvector, Redis, MinIO, API, worker, admin console, demo app, and optional Chatwoot.

### Repository Layout

```text
apps/
  site/                   Public GitHub Pages website and Scenario Lab
  admin-console/          React admin console
  demo-app/               Example host app with the widget embedded
services/
  api/                    Fastify API service
  worker/                 Async job worker runtime
packages/
  protocol/               Shared TypeScript protocol types
  sdk-js/                 Headless browser/client SDK
  widget/                 Embeddable support widget
  llm/                    OpenAI-compatible LLM and embedding client
  rag/                    Text chunking and retrieval helpers
  adapters/channels/      Generic webhook, Slack inbound, and channel adapter contracts
  adapters/chatwoot/      Chatwoot adapter package
prisma/
  schema.prisma
  migrations/
deploy/docker-compose/
  docker-compose.yml
  .env.example
docs/
  Architecture, API, public contracts, production deployment, security, RAG, roadmap, and release docs
```

### Website and Scenario Lab

The public website is a static React/Vite app in `apps/site`, designed for GitHub Pages:

```text
English: https://hiclawbot.github.io/OpenSupportAI/?lang=en
Chinese: https://hiclawbot.github.io/OpenSupportAI/?lang=zh
Source:  apps/site
Deploy:  .github/workflows/pages.yml
```

It includes an interactive Scenario Lab for demonstrating how OpenSupportAI can model support scripts, simulate retrieval/tool/handoff paths, score weak spots, and draft the next knowledge or tool patch. The default lab runs fully in the browser without a backend. Optional OpenAI-compatible LLM mode can be enabled from the page; provider settings are stored only in the current browser and should preferably point to your own proxy endpoint when CORS or key-management policies require it.

Local development:

```bash
pnpm --filter @opensupportai/site dev
pnpm --filter @opensupportai/site build
```

### Quick Start: No Database

This path runs the full API/admin/demo experience against in-memory seeded data.

```bash
pnpm install
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
```

In two other terminals:

```bash
VITE_API_URL=http://localhost:4000 pnpm --filter @opensupportai/admin-console dev
VITE_API_URL=http://localhost:4000 pnpm --filter @opensupportai/demo-app dev
```

Open:

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API Health:    http://localhost:4000/health
```

Demo credentials:

```text
Admin token: admin_demo_key
Project ID:  proj_demo
Public key:  pk_demo
Inbox ID:    inbox_default
```

Try these prompts in the demo widget:

```text
Please look up order ORD-2026-1001
What is my subscription status?
I need a human agent
```

### Quick Start: Docker Compose

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d --build
pnpm db:migrate
pnpm db:seed
```

Open:

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API Health:    http://localhost:4000/health
MinIO Console: http://localhost:9001
```

Optional Chatwoot profile:

```bash
docker compose -f deploy/docker-compose/docker-compose.yml --profile chatwoot up -d
```

### Stable Contracts and Production Deployment

v1.0 freezes the public REST API, SDK, Widget initialization, and adapter/tool execution boundaries documented in [docs/PUBLIC_CONTRACTS.zh-CN.md](./docs/PUBLIC_CONTRACTS.zh-CN.md). Upgrade steps are in [docs/UPGRADE_TO_V1.zh-CN.md](./docs/UPGRADE_TO_V1.zh-CN.md), and production deployment guidance is in [docs/PRODUCTION_DEPLOYMENT.zh-CN.md](./docs/PRODUCTION_DEPLOYMENT.zh-CN.md).

### Chatwoot Handoff

Configure Chatwoot from the admin console with `base_url`, `account_id`, `inbox_id`, `api_access_token`, and `webhook_secret`. The console can test the configured Chatwoot account/inbox before traffic is sent. When a user requests human handoff, OpenSupportAI creates or updates the Chatwoot contact, creates a Chatwoot conversation with OpenSupportAI custom attributes, pushes a private handoff summary plus recent public transcript messages, marks the local conversation `handed_off`, and accepts public Chatwoot agent replies through `/v1/webhooks/chatwoot/{project_id}`. Failed handoff sessions are visible in the admin conversation view and can be retried. Chatwoot `conversation_status_changed` webhooks sync `resolved` to local `closed` and `open`/`pending`/`snoozed` to `handed_off`.

For a live local smoke test after the API and Chatwoot are running, set the `CHATWOOT_*` variables from `deploy/docker-compose/.env.example` and run:

```bash
pnpm smoke:chatwoot
```

### LLM-Backed Grounded Answers

Configure an OpenAI-compatible provider from the admin console or `POST /v1/admin/projects/{project_id}/llm`. When a user question retrieves matching knowledge chunks, v0.6 sends the question and snippets to the configured provider and records provider/model/prompt/token metadata in `ai_runs`.

If no provider is configured, the provider is `demo://local`, the model request fails, or the model returns an empty answer, OpenSupportAI falls back to the deterministic grounded answer path. If retrieval finds no relevant chunks, the assistant still refuses to invent an answer and suggests human handoff.

With Prisma storage, normal inbound messages and an `answer.generate` job are committed in one PostgreSQL transaction. The API returns the existing `status: accepted` response without waiting for LLM or tool execution, and the worker writes one idempotent final answer. SSE connections poll persisted message cursors so worker results remain visible without a shared in-process event bus. Memory mode stays inline for the no-database quick start. Explicit human-handoff requests remain inline so Chatwoot handoff semantics are preserved.

### Knowledge Indexing Pipeline

v0.7 stores the original knowledge document content, content hash, index status, index errors, and chunk-count metadata. Admins can reindex a document from the console or by calling `POST /v1/admin/projects/{project_id}/knowledge/documents/{document_id}/reindex`.

Reindexing creates a `knowledge.index` async job. The worker marks the document `indexing`, rebuilds all chunks from stored content, then marks it `indexed` or `failed` with an error message. The current retrieval path still uses deterministic keyword scoring, while the schema remains pgvector-ready for a future embedding/vector retrieval pass.

### Multi-Channel Adapters

v0.5 adds a generic inbound webhook adapter for external channels that can send JSON. The adapter accepts flat or nested payloads, normalizes contact/message/conversation fields, records webhook events, creates or reuses conversations by external `conversation_id`, stores the inbound user message, and lets the orchestrator answer through the existing AI flow. v0.5.1 adds optional generic webhook secret configuration, project-scoped event idempotency, and channel metadata in admin conversation responses. v0.5.2 exposes channel adapter diagnostics and generic webhook configuration in the admin console Operations area. v0.6 lets those inbound channel messages use the same LLM-backed grounded answer path when an active non-demo LLM provider is configured.

v0.8 adds the first real provider channel: a Slack inbound MVP for Slack Events API callbacks. Admins can configure the Slack signing secret, default Slack channel ID, default inbox, and channel status from the Operations area or API. The API verifies Slack request timestamps/signatures, answers Slack URL verification challenges, normalizes `event_callback` message events into OpenSupportAI conversations, records webhook events, and keeps repeated Slack `event_id` deliveries idempotent. The local `pnpm smoke:channels` script now covers both generic webhooks and signed Slack callbacks without requiring a live Slack workspace.

Admin APIs expose the adapter catalog and test results:

```text
GET  /v1/admin/projects/{project_id}/channels/adapters
POST /v1/admin/projects/{project_id}/channels/adapters/{provider}/test
GET  /v1/admin/projects/{project_id}/channels/generic-webhook
POST /v1/admin/projects/{project_id}/channels/generic-webhook
GET  /v1/admin/projects/{project_id}/channels/slack
POST /v1/admin/projects/{project_id}/channels/slack
```

Generic inbound messages can be sent with the project public key:

```text
POST /v1/channel-webhooks/generic?public_key=pk_demo
POST /v1/channel-webhooks/slack?public_key=pk_demo
```

When a generic webhook secret is configured, inbound requests must include the configured secret header, `X-OpenSupportAI-Webhook-Secret`, `X-Webhook-Secret`, or `Authorization: Bearer <secret>`. Repeated processed `event_id` values are idempotent and do not create duplicate end-user messages.

Slack inbound is available for signed Events API message callbacks. Slack outbound replies, email, and Telegram are still future adapter work.

### Admin Conversation Operations

The admin conversation list supports `status`, `assignee_type`, `q`, `limit`, and `offset` query parameters. Responses include `summary` and `pagination` objects plus enriched conversation items with contact labels, `messageCount`, `lastMessage`, and latest `handoff` status. The admin console uses this to provide status filters, search, refresh, high-level queue metrics, recent-message previews, and failed-handoff visibility.

### Production Foundation APIs

Project-scoped admin API keys can now be created, listed, revoked, and used as bearer tokens for their own project. The API stores only key hashes, returns the plaintext key only once on creation, and records `lastUsedAt` on authenticated use. Root admin token access is still required to create new projects. v0.5.2 adds admin console Operations views for API keys, audit logs, async jobs, webhook events, tool-call logs, ops health, and channel diagnostics.

The API also exposes production operation surfaces:

```text
GET    /v1/admin/projects/{project_id}/ops/health
GET    /v1/admin/projects/{project_id}/audit-log
GET    /v1/admin/projects/{project_id}/jobs
POST   /v1/admin/projects/{project_id}/jobs
GET    /v1/admin/projects/{project_id}/webhooks/events
POST   /v1/admin/projects/{project_id}/webhooks/events/{event_id}/retry
GET    /v1/admin/projects/{project_id}/tool-calls
```

Webhook replay is intentionally unavailable until provider-specific replay handlers exist. The reserved retry endpoint returns `501` and never creates a placeholder job; failed events remain visible for diagnosis.

### Business Tools

OpenSupportAI has a project-scoped tool definition and tool-call log model. Tools are allowlisted through `status=active|disabled`; disabled tools are not executed by the orchestrator.

The demo project seeds two read-only tools:

```text
demo.order_lookup
demo.subscription_lookup
```

The orchestrator still uses these demo tools for explicit order/subscription-status questions before falling back to knowledge retrieval.

Active `kind=openapi` tools can match a user message through `metadata.intent.keywords` and `metadata.intent.extract`, call an allowlisted HTTP endpoint, store a completed or failed tool-call log, and return an answer rendered from `metadata.answer_template`, `output.answer`, `output.summary`, or the raw JSON result. Relative paths use `metadata.base_url`; every final host must be present in `metadata.allowed_hosts`. Non-`GET` methods additionally require `metadata.allow_mutation=true` and a persisted `metadata.mutation_approval` record containing `status=approved`, `approved_by`, and `approved_at`. All LLM, Chatwoot, and business-tool requests reject non-HTTP protocols, URL credentials, private/reserved destinations in production, and cross-origin redirects. Optional tool metadata includes `timeout_ms`, `max_response_bytes`, `response_path`, and `auth: { "type": "bearer_env", "env": "ENV_NAME" }`.

Durable answer workers reject non-`GET` tools even when an approval record exists because a worker crash after the remote side effect could otherwise repeat the mutation. Production Beta deployments should use read-only tools and human workflows for mutations until an end-to-end tool idempotency contract is available.

Admin APIs can list/upsert tools, enable or disable a tool, and inspect tool-call logs. A local end-to-end OpenAPI tool smoke test is available:

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
API_URL=http://localhost:4000 pnpm smoke:tools
```

### Agent Assist

Admin APIs can generate and read conversation insights:

```text
GET  /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
POST /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
GET  /v1/admin/projects/{project_id}/analytics/handoffs
```

Insights include a deterministic summary, suggested replies, tags, and metadata derived from messages, handoff sessions, and tool calls. Handoff analytics aggregate project-level handoffs by status, reason, and provider.

### Development Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://... pnpm smoke:postgres-answer
pnpm --filter @opensupportai/site dev
pnpm exec prisma validate
pnpm db:generate
pnpm smoke:memory
pnpm smoke:chatwoot
pnpm smoke:channels
pnpm smoke:tools
```

Database commands:

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

### Widget Usage

Build the widget first:

```bash
pnpm --filter @opensupportai/widget build
```

Then serve `packages/widget/dist/opensupportai-widget.js` as an ES module:

```html
<script type="module">
  import { OpenSupportAI } from "/opensupportai-widget.js";

  OpenSupportAI.init({
    apiUrl: "http://localhost:4000",
    projectId: "proj_demo",
    publicKey: "pk_demo",
    inboxId: "inbox_default",
    user: {
      id: "user_123",
      name: "Demo User",
      email: "demo@example.com"
    },
    locale: "zh-CN"
  });
</script>
```

The current v0.1 widget build is ESM-first. A CDN/UMD global build can be added later if the project needs a legacy `<script src="...">` integration.

### SDK Usage

```ts
import { OpenSupportAIClient } from "@opensupportai/sdk-js";

const client = new OpenSupportAIClient({
  apiUrl: "http://localhost:4000",
  projectId: "proj_demo",
  publicKey: "pk_demo"
});

const conversation = await client.createConversation({
  inboxId: "inbox_default",
  idempotencyKey: crypto.randomUUID(),
  contact: {
    externalUserId: "user_123",
    name: "Demo User",
    email: "demo@example.com"
  }
});

const unsubscribe = client.subscribe(conversation.conversationId, (event) => {
  console.log("support event", event);
});

await client.sendMessage({
  conversationId: conversation.conversationId,
  text: "How do I cancel my subscription?",
  idempotencyKey: crypto.randomUUID()
});

const page = await client.listMessages(conversation.conversationId, {
  limit: 50,
  after: undefined
});

unsubscribe();
```

### Environment

Important local variables:

```text
OPENSUPPORTAI_STORAGE=memory | prisma
ANSWER_EXECUTION_MODE=inline | worker
ADMIN_API_TOKEN=admin_demo_key
DATABASE_URL=postgresql://opensupportai:opensupportai@localhost:5432/opensupportai
ENCRYPTION_KEY=replace_with_32_byte_key
CLIENT_TOKEN_SECRET=replace_with_32_byte_client_token_secret
CORS_ORIGIN=*
CONVERSATION_TOKEN_TTL_SECONDS=604800
STREAM_TOKEN_TTL_SECONDS=60
SSE_HEARTBEAT_MS=15000
SSE_DATABASE_POLL_MS=1000
ALLOW_PRIVATE_OUTBOUND=true
MAX_CONCURRENT_ANSWERS_PER_PROJECT=4
LLM_TIMEOUT_MS=45000
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=replace_me
LLM_DEFAULT_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
WORKER_JOB_TYPES=answer.generate,knowledge.index
```

Do not put LLM provider keys in frontend code. Configure provider credentials through the admin API or admin console so they stay server-side.

### Security Baseline

- Client public keys only create conversations and authenticate channel webhooks. Conversation reads, writes, handoff, and stream-token exchange require the returned conversation capability.
- Browser SSE URLs contain only a short-lived stream token. The SDK and Widget fall back to authenticated polling and reconnect with a fresh stream token.
- Admin endpoints require `Authorization: Bearer <token>`.
- API keys are stored as hashes.
- Project-scoped API keys can only authenticate against their own project; project creation requires the root admin token.
- Key production operations are written to the audit log.
- Integration and LLM credentials are stored encrypted.
- All repository paths are project-scoped.
- Knowledge no-hit responses refuse to fabricate an answer and suggest handoff.
- Chatwoot webhooks require a configured secret/signature.
- Slack channel webhooks require a configured signing secret and Slack-style request signatures.
- API rate limiting can be enabled with `RATE_LIMIT_ENABLED=true`.

See [SECURITY.md](./SECURITY.md) and [docs/SECURITY.zh-CN.md](./docs/SECURITY.zh-CN.md).

### Release Checklist

Before publishing a release:

```bash
pnpm install
pnpm exec prisma validate
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://... pnpm smoke:postgres-answer
```

See [docs/RELEASE_CHECKLIST.zh-CN.md](./docs/RELEASE_CHECKLIST.zh-CN.md) for the full checklist and local verification notes.

---

## 中文

OpenSupportAI 是一套开源、可嵌入、LLM-native 的 AI 智能客服运行时。它为 SaaS 产品、内部工具、App 和网站提供按项目隔离的 AI 客服层，包含聊天 Widget、Headless SDK、会话 API、基于知识库的回答、人工转接和管理台工作流。

v1.0 版本仍然保持聚焦：不做完整 CRM，不做复杂工单系统，也不复制 Chatwoot、Tiledesk 或 Zammad。OpenSupportAI 专注于 AI 客服运行时，可以从不同渠道接收消息，索引客服知识库，执行 allowlist 业务工具，生成基于知识库的回答，并把会话转交给这些客服系统。

### v1.0 已实现能力

- Fastify API：健康检查、客户端会话、消息、SSE 事件、人工转接、管理端、知识库、LLM 配置、Chatwoot 配置和 webhook。
- Prisma schema 与 migrations，支持保存 knowledge document 原文、content hash、索引状态/错误 metadata，以及 pgvector-ready 的知识块模型。
- 内存模式 demo，无需 Docker 或数据库即可本地跑通。
- 内置 demo 项目：`proj_demo`，public key `pk_demo`，默认 inbox `inbox_default`，admin token `admin_demo_key`。
- 通过已配置的 OpenAI-compatible provider 生成基于知识库的回答；demo、未配置 provider 或模型失败时会回退到确定性回答；无知识命中时仍拒绝编造并建议转人工。
- OpenAI-compatible LLM 与 embedding 客户端包。
- Headless JavaScript SDK。
- 可嵌入浏览器 Widget：Shadow DOM UI、SSE 更新、会话持久化、source references 和人工转接。
- React Admin Console：项目、会话运营、知识库与 reindex 操作、LLM 设置、Chatwoot 设置、渠道运维、admin API key、审计日志、异步任务、webhook event 和 tool-call 日志。
- 管理台会话运营：状态/搜索筛选、摘要指标、联系人标签、最近消息预览、消息数和最新 handoff 状态。
- React Demo App：展示一个嵌入 Widget 的 SaaS 账单页。
- Chatwoot 人工转接集成：创建 contact/conversation，推送转接摘要和历史消息，保存 external IDs，把公开坐席回复回流为本地 `human_agent` 消息，支持连接测试、失败重试和 Chatwoot resolved/open 状态同步。
- 可配置的进程内 API 限流，提供标准 `rate_limited` 错误和 `x-ratelimit-*` 响应头。
- 基于租约的异步任务，支持 PostgreSQL 原子领取、heartbeat、过期任务恢复、owner fencing、worker 优雅排空，以及真实的 `answer.generate` 与 `knowledge.index` handler。
- 生产基础 API 和管理台视图：项目级 admin API key、审计日志、ops health、async jobs 和 webhook event 检查。
- 会话/消息持久化幂等键、稳定游标分页、租户关系约束、项目级回答并发限制和有界 LLM 请求。
- 业务工具执行：allowlist 工具定义、tool-call 日志、确定性的 demo 订单/订阅查询工具，以及 OpenAPI-style HTTP 工具执行，包含 host allowlist、timeout、response shaping、answer template、环境变量 bearer auth 和 mutation guard。
- 坐席辅助基础：确定性的会话摘要、建议回复、标签和 handoff analytics。
- 多渠道 adapter 基础：可测试的 generic webhook 入站 adapter、已验证签名的 Slack Events API 入站 adapter、管理端 adapter catalog/test/config API，以及 Email/Telegram 契约 stub。
- v1.0 稳定公共契约：REST API、JavaScript SDK、Widget 初始化 API、Chatwoot handoff adapter、generic/Slack 入站 channel adapter 和 OpenAPI-style business tool executor。
- 面向自托管 operator 的生产部署、升级、安全和发布验证文档。
- GitHub Actions CI 与真实 Chatwoot smoke-test 脚本，用于发布校验。
- Docker Compose：PostgreSQL/pgvector、Redis、MinIO、API、worker、admin console、demo app，以及可选 Chatwoot。

### 仓库结构

```text
apps/
  site/                   GitHub Pages 官网与 Scenario Lab
  admin-console/          React 管理台
  demo-app/               嵌入 Widget 的示例宿主应用
services/
  api/                    Fastify API 服务
  worker/                 异步任务 worker runtime
packages/
  protocol/               共享 TypeScript 协议类型
  sdk-js/                 Headless 浏览器/客户端 SDK
  widget/                 可嵌入客服 Widget
  llm/                    OpenAI-compatible LLM 与 embedding 客户端
  rag/                    文本切块与检索工具
  adapters/channels/      Generic webhook、Slack 入站与 channel adapter 契约
  adapters/chatwoot/      Chatwoot adapter 包
prisma/
  schema.prisma
  migrations/
deploy/docker-compose/
  docker-compose.yml
  .env.example
docs/
  架构、API、公共契约、生产部署、安全、RAG、路线图和发布文档
```

### 官网与场景实验室

公开官网是位于 `apps/site` 的静态 React/Vite 应用，面向 GitHub Pages 发布：

```text
英文版: https://hiclawbot.github.io/OpenSupportAI/?lang=en
中文版: https://hiclawbot.github.io/OpenSupportAI/?lang=zh
源码:   apps/site
部署:   .github/workflows/pages.yml
```

站点内置可交互的 Scenario Lab，用于展示 OpenSupportAI 如何建模客服脚本、模拟知识库检索/工具调用/人工转接路径、评分薄弱点，并生成下一轮知识库或工具配置补丁。默认模式完全在浏览器本地运行，不依赖后端。页面也支持可选的 OpenAI-compatible LLM 模式；Provider 设置只保存在当前浏览器中。如果涉及 CORS、审计或密钥管理，建议接入你自己的代理 endpoint，而不是把密钥硬编码到仓库或前端代码里。

本地开发：

```bash
pnpm --filter @opensupportai/site dev
pnpm --filter @opensupportai/site build
```

### 快速开始：无需数据库

这个方式使用内存模式和内置种子数据，能完整跑通 API、管理台和 Demo。

```bash
pnpm install
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
```

另外打开两个终端：

```bash
VITE_API_URL=http://localhost:4000 pnpm --filter @opensupportai/admin-console dev
VITE_API_URL=http://localhost:4000 pnpm --filter @opensupportai/demo-app dev
```

访问：

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API Health:    http://localhost:4000/health
```

Demo 凭据：

```text
Admin token: admin_demo_key
Project ID:  proj_demo
Public key:  pk_demo
Inbox ID:    inbox_default
```

可以在 demo widget 中尝试：

```text
请帮我查订单 ORD-2026-1001
我的订阅状态是什么？
我要转人工
```

### 快速开始：Docker Compose

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d --build
pnpm db:migrate
pnpm db:seed
```

访问：

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API Health:    http://localhost:4000/health
MinIO Console: http://localhost:9001
```

可选启动 Chatwoot：

```bash
docker compose -f deploy/docker-compose/docker-compose.yml --profile chatwoot up -d
```

### 稳定契约与生产部署

v1.0 冻结 REST API、SDK、Widget 初始化参数、adapter 和 tool execution 边界，详见 [docs/PUBLIC_CONTRACTS.zh-CN.md](./docs/PUBLIC_CONTRACTS.zh-CN.md)。升级步骤见 [docs/UPGRADE_TO_V1.zh-CN.md](./docs/UPGRADE_TO_V1.zh-CN.md)，生产部署指南见 [docs/PRODUCTION_DEPLOYMENT.zh-CN.md](./docs/PRODUCTION_DEPLOYMENT.zh-CN.md)。

### Chatwoot 人工转接

在 Admin Console 中配置 Chatwoot 的 `base_url`、`account_id`、`inbox_id`、`api_access_token` 和 `webhook_secret`。管理台可以先测试 Chatwoot account/inbox 是否可用。用户请求转人工时，OpenSupportAI 会创建或更新 Chatwoot contact，创建带 OpenSupportAI custom attributes 的 Chatwoot conversation，推送一条私有转接摘要和最近公开会话记录，把本地会话标记为 `handed_off`，并通过 `/v1/webhooks/chatwoot/{project_id}` 接收公开坐席回复。失败的 handoff session 会显示在管理台会话详情中，并可手动 retry。Chatwoot `conversation_status_changed` webhook 会把 `resolved` 同步为本地 `closed`，把 `open`/`pending`/`snoozed` 同步为 `handed_off`。

API 和 Chatwoot 都启动后，可以设置 `deploy/docker-compose/.env.example` 中的 `CHATWOOT_*` 变量并执行真实 smoke test：

```bash
pnpm smoke:chatwoot
```

### LLM 支撑的知识库回答

可以在 Admin Console 或 `POST /v1/admin/projects/{project_id}/llm` 配置 OpenAI-compatible provider。当用户问题检索到匹配的知识块时，v0.6 会把问题和知识片段发送给已配置的 provider，并在 `ai_runs` 中记录 provider、model、prompt、token 等元数据。

如果未配置 provider、provider 是 `demo://local`、模型请求失败，或模型返回空内容，OpenSupportAI 会回退到确定性的知识库回答路径。如果检索没有找到相关知识块，助手仍会拒绝编造答案并建议转人工。

使用 Prisma 存储时，普通入站消息与 `answer.generate` 任务会在同一个 PostgreSQL 事务中提交。API 不等待 LLM 或工具执行，仍返回现有的 `status: accepted` 响应；worker 负责写入唯一且幂等的最终回答。SSE 会按持久化消息游标补拉，因此即使 API 与 worker 不共享进程内事件总线，客户端仍能收到结果。无需数据库的 memory 快速体验继续使用同步回答；显式人工转接请求也保持同步，以保留 Chatwoot 交接语义。

### 知识库索引管线

v0.7 会保存 knowledge document 的原始内容、content hash、索引状态、索引错误和 chunk count metadata。管理员可以在 Admin Console 中重建索引，也可以调用 `POST /v1/admin/projects/{project_id}/knowledge/documents/{document_id}/reindex`。

Reindex 会创建 `knowledge.index` async job。Worker 会把文档标记为 `indexing`，用已保存的原文重建全部 chunks，然后将文档标记为 `indexed` 或带错误信息的 `failed`。当前 retrieval 仍使用确定性的 keyword scoring；schema 继续保留 pgvector-ready 字段，供后续 embedding/vector retrieval 迭代使用。

### 多渠道 Adapter

v0.5 新增 generic inbound webhook adapter，适合能发送 JSON 的外部渠道。它支持扁平或嵌套 payload，会归一化 contact/message/conversation 字段，记录 webhook event，按外部 `conversation_id` 创建或复用会话，写入 end-user message，并复用现有 orchestrator 生成 AI 回复。v0.5.1 新增 generic webhook secret 配置、项目级 event 幂等，以及管理端会话响应中的 channel metadata。v0.5.2 在 Admin Console Operations 区域暴露 channel adapter diagnostics 和 generic webhook 配置。v0.6 在配置 active 且非 demo 的 LLM provider 后，可让这些入站渠道消息复用同一条 LLM-backed grounded answer 路径。

v0.8 新增第一条真实 provider channel：Slack 入站 MVP，面向 Slack Events API callback。管理员可以在 Operations 区域或 API 中配置 Slack signing secret、默认 Slack channel ID、默认 inbox 和 channel 状态。API 会校验 Slack request timestamp/signature，响应 Slack URL verification challenge，把 `event_callback` message event 归一化为 OpenSupportAI 会话，记录 webhook event，并对重复 Slack `event_id` 保持幂等。`pnpm smoke:channels` 现在会同时覆盖 generic webhook 和已签名的 Slack callback，不需要真实 Slack workspace。

管理端 API 可查看 adapter catalog 并测试 adapter：

```text
GET  /v1/admin/projects/{project_id}/channels/adapters
POST /v1/admin/projects/{project_id}/channels/adapters/{provider}/test
GET  /v1/admin/projects/{project_id}/channels/generic-webhook
POST /v1/admin/projects/{project_id}/channels/generic-webhook
GET  /v1/admin/projects/{project_id}/channels/slack
POST /v1/admin/projects/{project_id}/channels/slack
```

Generic 入站消息可使用项目 public key 调用：

```text
POST /v1/channel-webhooks/generic?public_key=pk_demo
POST /v1/channel-webhooks/slack?public_key=pk_demo
```

配置 generic webhook secret 后，入站请求必须携带配置的 secret header、`X-OpenSupportAI-Webhook-Secret`、`X-Webhook-Secret`，或 `Authorization: Bearer <secret>`。已处理过的重复 `event_id` 会走幂等返回，不会重复创建 end-user message。

Slack 入站已可用于签名后的 Events API message callback。Slack 出站回复、Email 和 Telegram 仍是后续 adapter 工作。

### 管理台会话运营

管理端会话列表支持 `status`、`assignee_type`、`q`、`limit`、`offset` 查询参数。响应会返回 `summary` 和 `pagination`，并在会话项中补充联系人标签、`messageCount`、`lastMessage` 和最新 `handoff` 状态。Admin Console 基于这些数据提供状态筛选、搜索、刷新、队列指标、最近消息预览和失败 handoff 可见性。

### 生产基础 API

项目级 admin API key 现在支持创建、列表、撤销，并可作为 bearer token 访问自己的项目。API 只保存 key hash，只在创建时返回一次明文 key，并会在认证使用时更新 `lastUsedAt`。创建新项目仍然只允许 root admin token。v0.5.2 在 Admin Console Operations 区域新增 API keys、audit logs、async jobs、webhook events、tool-call logs、ops health 和 channel diagnostics 视图。

API 也提供生产运维接口：

```text
GET    /v1/admin/projects/{project_id}/ops/health
GET    /v1/admin/projects/{project_id}/audit-log
GET    /v1/admin/projects/{project_id}/jobs
POST   /v1/admin/projects/{project_id}/jobs
GET    /v1/admin/projects/{project_id}/webhooks/events
POST   /v1/admin/projects/{project_id}/webhooks/events/{event_id}/retry
GET    /v1/admin/projects/{project_id}/tool-calls
```

在 provider-specific replay handler 实现之前，Webhook replay 明确不可用。保留的 retry endpoint 返回 `501`，且不会创建 placeholder job；失败事件仍可用于排障。

### 业务工具

OpenSupportAI 现在有项目级 tool definition 和 tool-call log 模型。工具通过 `status=active|disabled` 进入 allowlist 控制；disabled 的工具不会被 orchestrator 执行。

demo 项目内置两个只读工具：

```text
demo.order_lookup
demo.subscription_lookup
```

当用户明确询问订单或订阅状态时，orchestrator 仍会先使用这些 demo 工具，再进入知识库检索 fallback。

Active 的 `kind=openapi` 工具可以通过 `metadata.intent.keywords` 和 `metadata.intent.extract` 匹配用户消息，调用 allowlist 保护的 HTTP endpoint，写入 completed 或 failed tool-call log，并通过 `metadata.answer_template`、`output.answer`、`output.summary` 或原始 JSON 生成回复。相对路径使用 `metadata.base_url`，最终 host 必须在 `metadata.allowed_hosts` 中。非 `GET` 方法还必须配置 `metadata.allow_mutation=true`，并持久化包含 `status=approved`、`approved_by`、`approved_at` 的 `metadata.mutation_approval`。LLM、Chatwoot 和业务工具的全部出站请求都会拒绝非 HTTP 协议、URL 内嵌凭据、生产环境的私网/保留地址以及跨源重定向。可选 metadata 包含 `timeout_ms`、`max_response_bytes`、`response_path` 和 `auth: { "type": "bearer_env", "env": "ENV_NAME" }`。

Durable answer worker 即使看到完整审批记录，也会拒绝非 `GET` 工具，因为 worker 在远端副作用完成后崩溃会导致重试重复执行。生产 Beta 应只使用只读工具；mutation 在端到端工具幂等契约完成前继续走人工流程。

管理端 API 可以列出/upsert 工具、启停工具，并查看 tool-call 日志。本地可执行端到端 OpenAPI 工具 smoke test：

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
API_URL=http://localhost:4000 pnpm smoke:tools
```

### 坐席辅助

管理端 API 可以生成和读取会话 insight：

```text
GET  /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
POST /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
GET  /v1/admin/projects/{project_id}/analytics/handoffs
```

Insight 包含从消息、handoff session 和 tool call 推导出的确定性摘要、建议回复、标签和 metadata。Handoff analytics 会按 status、reason、provider 汇总项目级人工转接情况。

### 开发命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @opensupportai/site dev
pnpm exec prisma validate
pnpm db:generate
pnpm smoke:memory
pnpm smoke:chatwoot
pnpm smoke:channels
pnpm smoke:tools
```

数据库命令：

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

### Widget 接入

先构建 Widget：

```bash
pnpm --filter @opensupportai/widget build
```

然后把 `packages/widget/dist/opensupportai-widget.js` 作为 ES module 提供给页面：

```html
<script type="module">
  import { OpenSupportAI } from "/opensupportai-widget.js";

  OpenSupportAI.init({
    apiUrl: "http://localhost:4000",
    projectId: "proj_demo",
    publicKey: "pk_demo",
    inboxId: "inbox_default",
    user: {
      id: "user_123",
      name: "Demo User",
      email: "demo@example.com"
    },
    locale: "zh-CN"
  });
</script>
```

当前 v0.1 Widget 是 ESM-first 产物。后续如果需要兼容传统 `<script src="...">` 全局变量接入，可以再补 CDN/UMD 构建。

### SDK 接入

```ts
import { OpenSupportAIClient } from "@opensupportai/sdk-js";

const client = new OpenSupportAIClient({
  apiUrl: "http://localhost:4000",
  projectId: "proj_demo",
  publicKey: "pk_demo"
});

const conversation = await client.createConversation({
  inboxId: "inbox_default",
  idempotencyKey: crypto.randomUUID(),
  contact: {
    externalUserId: "user_123",
    name: "Demo User",
    email: "demo@example.com"
  }
});

const unsubscribe = client.subscribe(conversation.conversationId, (event) => {
  console.log("support event", event);
});

await client.sendMessage({
  conversationId: conversation.conversationId,
  text: "怎么取消订阅？",
  idempotencyKey: crypto.randomUUID()
});

const page = await client.listMessages(conversation.conversationId, {
  limit: 50,
  after: undefined
});

unsubscribe();
```

### 环境变量

主要本地变量：

```text
OPENSUPPORTAI_STORAGE=memory | prisma
ANSWER_EXECUTION_MODE=inline | worker
ADMIN_API_TOKEN=admin_demo_key
DATABASE_URL=postgresql://opensupportai:opensupportai@localhost:5432/opensupportai
ENCRYPTION_KEY=replace_with_32_byte_key
CLIENT_TOKEN_SECRET=replace_with_32_byte_client_token_secret
CORS_ORIGIN=*
CONVERSATION_TOKEN_TTL_SECONDS=604800
STREAM_TOKEN_TTL_SECONDS=60
SSE_HEARTBEAT_MS=15000
SSE_DATABASE_POLL_MS=1000
ALLOW_PRIVATE_OUTBOUND=true
MAX_CONCURRENT_ANSWERS_PER_PROJECT=4
LLM_TIMEOUT_MS=45000
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=replace_me
LLM_DEFAULT_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
WORKER_JOB_TYPES=answer.generate,knowledge.index
```

不要把 LLM Provider API Key 放进前端代码。请通过 Admin API 或 Admin Console 配置 Provider 凭据，确保密钥只留在服务端。

### 安全基线

- Client public key 只用于创建会话和校验 channel webhook。读取/发送会话消息、请求人工转接和换取 stream token 都必须使用创建会话时返回的 conversation capability。
- 浏览器 SSE URL 只携带短期 stream token；SDK 与 Widget 在断流时会使用已认证轮询，并用新 stream token 重连。
- Admin API 必须使用 `Authorization: Bearer <token>`。
- API key 只保存 hash。
- 项目级 API key 只能认证访问自己的项目；创建项目需要 root admin token。
- 关键生产操作会写入审计日志。
- Integration 和 LLM 凭据加密存储。
- 所有 repository 数据访问都按 project scope 隔离。
- 知识库无命中时不会编造答案，而是建议转人工。
- Chatwoot webhook 需要配置并校验 secret/signature。
- 可以通过 `RATE_LIMIT_ENABLED=true` 启用 API 限流。

更多内容见 [SECURITY.md](./SECURITY.md) 和 [docs/SECURITY.zh-CN.md](./docs/SECURITY.zh-CN.md)。

### 发布检查

发布前执行：

```bash
pnpm install
pnpm exec prisma validate
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

完整清单和本地验证限制见 [docs/RELEASE_CHECKLIST.zh-CN.md](./docs/RELEASE_CHECKLIST.zh-CN.md)。

---

## License / 许可证

Apache-2.0. See [LICENSE](./LICENSE) and [LICENSE_NOTES.md](./LICENSE_NOTES.md).

Apache-2.0。详见 [LICENSE](./LICENSE) 与 [LICENSE_NOTES.md](./LICENSE_NOTES.md)。
