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

The first public release is a v0.1 MVP. It is intentionally small: it is not a full CRM or ticketing suite, and it does not copy Chatwoot, Tiledesk, or Zammad. Instead, OpenSupportAI provides the AI support runtime that can hand conversations to those systems.

### What Works in v0.1

- Fastify API with health, client conversation, message, SSE events, handoff, admin, knowledge, LLM config, Chatwoot config, and webhook endpoints.
- Prisma schema and migration for PostgreSQL with pgvector-backed knowledge chunks.
- In-memory demo storage for instant local development without Docker or a database.
- Seeded demo project: `proj_demo`, public key `pk_demo`, default inbox `inbox_default`, admin token `admin_demo_key`.
- Deterministic RAG-style demo orchestration with a no-hit no-hallucination fallback.
- OpenAI-compatible LLM and embedding client package.
- Headless JavaScript SDK.
- Embeddable browser widget with Shadow DOM UI, SSE updates, conversation persistence, source references, and handoff action.
- React admin console for projects, conversations, knowledge documents, LLM settings, and Chatwoot settings.
- React demo app showing a SaaS billing page with the widget embedded.
- Chatwoot handoff integration: creates contacts/conversations, pushes handoff summaries and transcript messages, stores external IDs, maps public agent replies back into local `human_agent` messages, tests connectivity, retries failed handoffs, and syncs Chatwoot resolved/open status.
- GitHub Actions CI and a live Chatwoot smoke-test script for release validation.
- Docker Compose stack for PostgreSQL/pgvector, Redis, MinIO, API, worker, admin console, demo app, and optional Chatwoot.

### Repository Layout

```text
apps/
  admin-console/          React admin console
  demo-app/               Example host app with the widget embedded
services/
  api/                    Fastify API service
  worker/                 Placeholder worker process for async jobs
packages/
  protocol/               Shared TypeScript protocol types
  sdk-js/                 Headless browser/client SDK
  widget/                 Embeddable support widget
  llm/                    OpenAI-compatible LLM and embedding client
  rag/                    Text chunking and retrieval helpers
  adapters/chatwoot/      Chatwoot adapter package
prisma/
  schema.prisma
  migrations/
deploy/docker-compose/
  docker-compose.yml
  .env.example
docs/
  Architecture, API, security, RAG, roadmap, and release docs
```

### Quick Start: No Database

This path runs the full API/admin/demo experience against in-memory seeded data.

```bash
pnpm install
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
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
怎么取消订阅？
我要转人工
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

### Chatwoot Handoff

Configure Chatwoot from the admin console with `base_url`, `account_id`, `inbox_id`, `api_access_token`, and `webhook_secret`. The console can test the configured Chatwoot account/inbox before traffic is sent. When a user requests human handoff, OpenSupportAI creates or updates the Chatwoot contact, creates a Chatwoot conversation with OpenSupportAI custom attributes, pushes a private handoff summary plus recent public transcript messages, marks the local conversation `handed_off`, and accepts public Chatwoot agent replies through `/v1/webhooks/chatwoot/{project_id}`. Failed handoff sessions are visible in the admin conversation view and can be retried. Chatwoot `conversation_status_changed` webhooks sync `resolved` to local `closed` and `open`/`pending`/`snoozed` to `handed_off`.

For a live local smoke test after the API and Chatwoot are running, set the `CHATWOOT_*` variables from `deploy/docker-compose/.env.example` and run:

```bash
pnpm smoke:chatwoot
```

### Development Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec prisma validate
pnpm db:generate
pnpm smoke:chatwoot
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
  text: "怎么取消订阅？"
});

unsubscribe();
```

### Environment

Important local variables:

```text
OPENSUPPORTAI_STORAGE=memory | prisma
ADMIN_API_TOKEN=admin_demo_key
DATABASE_URL=postgresql://opensupportai:opensupportai@localhost:5432/opensupportai
ENCRYPTION_KEY=replace_with_32_byte_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=replace_me
LLM_DEFAULT_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
```

Do not put LLM provider keys in frontend code. Configure provider credentials through the admin API or admin console so they stay server-side.

### Security Baseline

- Client public keys only identify a project. They are not admin secrets.
- Admin endpoints require `Authorization: Bearer <token>`.
- API keys are stored as hashes.
- Integration and LLM credentials are stored encrypted.
- All repository paths are project-scoped.
- Knowledge no-hit responses refuse to fabricate an answer and suggest handoff.
- Chatwoot webhooks require a configured secret/signature.

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
```

See [docs/RELEASE_CHECKLIST.zh-CN.md](./docs/RELEASE_CHECKLIST.zh-CN.md) for the full checklist and local verification notes.

---

## 中文

OpenSupportAI 是一套开源、可嵌入、LLM-native 的 AI 智能客服运行时。它为 SaaS 产品、内部工具、App 和网站提供按项目隔离的 AI 客服层，包含聊天 Widget、Headless SDK、会话 API、基于知识库的回答、人工转接和管理台工作流。

首个公开版本是 v0.1 MVP。它有意保持小而清晰：不做完整 CRM，不做复杂工单系统，也不复制 Chatwoot、Tiledesk 或 Zammad。OpenSupportAI 专注于 AI 客服运行时，并可以把会话转交给这些客服系统。

### v0.1 已实现能力

- Fastify API：健康检查、客户端会话、消息、SSE 事件、人工转接、管理端、知识库、LLM 配置、Chatwoot 配置和 webhook。
- Prisma schema 与 migration，支持 PostgreSQL + pgvector 知识块模型。
- 内存模式 demo，无需 Docker 或数据库即可本地跑通。
- 内置 demo 项目：`proj_demo`，public key `pk_demo`，默认 inbox `inbox_default`，admin token `admin_demo_key`。
- 确定性的 RAG demo 编排：有知识命中则回答，无命中则拒绝编造并建议转人工。
- OpenAI-compatible LLM 与 embedding 客户端包。
- Headless JavaScript SDK。
- 可嵌入浏览器 Widget：Shadow DOM UI、SSE 更新、会话持久化、source references 和人工转接。
- React Admin Console：项目、会话、知识库、LLM 设置、Chatwoot 设置。
- React Demo App：展示一个嵌入 Widget 的 SaaS 账单页。
- Chatwoot 人工转接集成：创建 contact/conversation，推送转接摘要和历史消息，保存 external IDs，把公开坐席回复回流为本地 `human_agent` 消息，支持连接测试、失败重试和 Chatwoot resolved/open 状态同步。
- GitHub Actions CI 与真实 Chatwoot smoke-test 脚本，用于发布校验。
- Docker Compose：PostgreSQL/pgvector、Redis、MinIO、API、worker、admin console、demo app，以及可选 Chatwoot。

### 仓库结构

```text
apps/
  admin-console/          React 管理台
  demo-app/               嵌入 Widget 的示例宿主应用
services/
  api/                    Fastify API 服务
  worker/                 后续异步任务 worker 占位进程
packages/
  protocol/               共享 TypeScript 协议类型
  sdk-js/                 Headless 浏览器/客户端 SDK
  widget/                 可嵌入客服 Widget
  llm/                    OpenAI-compatible LLM 与 embedding 客户端
  rag/                    文本切块与检索工具
  adapters/chatwoot/      Chatwoot adapter 包
prisma/
  schema.prisma
  migrations/
deploy/docker-compose/
  docker-compose.yml
  .env.example
docs/
  架构、API、安全、RAG、路线图和发布文档
```

### 快速开始：无需数据库

这个方式使用内存模式和内置种子数据，能完整跑通 API、管理台和 Demo。

```bash
pnpm install
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
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
怎么取消订阅？
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

### Chatwoot 人工转接

在 Admin Console 中配置 Chatwoot 的 `base_url`、`account_id`、`inbox_id`、`api_access_token` 和 `webhook_secret`。管理台可以先测试 Chatwoot account/inbox 是否可用。用户请求转人工时，OpenSupportAI 会创建或更新 Chatwoot contact，创建带 OpenSupportAI custom attributes 的 Chatwoot conversation，推送一条私有转接摘要和最近公开会话记录，把本地会话标记为 `handed_off`，并通过 `/v1/webhooks/chatwoot/{project_id}` 接收公开坐席回复。失败的 handoff session 会显示在管理台会话详情中，并可手动 retry。Chatwoot `conversation_status_changed` webhook 会把 `resolved` 同步为本地 `closed`，把 `open`/`pending`/`snoozed` 同步为 `handed_off`。

API 和 Chatwoot 都启动后，可以设置 `deploy/docker-compose/.env.example` 中的 `CHATWOOT_*` 变量并执行真实 smoke test：

```bash
pnpm smoke:chatwoot
```

### 开发命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec prisma validate
pnpm db:generate
pnpm smoke:chatwoot
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
  text: "怎么取消订阅？"
});

unsubscribe();
```

### 环境变量

主要本地变量：

```text
OPENSUPPORTAI_STORAGE=memory | prisma
ADMIN_API_TOKEN=admin_demo_key
DATABASE_URL=postgresql://opensupportai:opensupportai@localhost:5432/opensupportai
ENCRYPTION_KEY=replace_with_32_byte_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=replace_me
LLM_DEFAULT_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
```

不要把 LLM Provider API Key 放进前端代码。请通过 Admin API 或 Admin Console 配置 Provider 凭据，确保密钥只留在服务端。

### 安全基线

- Client public key 只用于识别项目，不是 admin secret。
- Admin API 必须使用 `Authorization: Bearer <token>`。
- API key 只保存 hash。
- Integration 和 LLM 凭据加密存储。
- 所有 repository 数据访问都按 project scope 隔离。
- 知识库无命中时不会编造答案，而是建议转人工。
- Chatwoot webhook 需要配置并校验 secret/signature。

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
