# OpenSupportAI 施工文档

本文档是 OpenSupportAI v0.1 的工程施工手册，供开发团队和 Codex 使用。目标是将设计落地为一个可运行、可测试、可发布的开源项目。

---

## 一、施工目标

v0.1 只追求一条完整端到端闭环：

```text
Demo App 嵌入 Widget
→ 用户发消息
→ API 保存会话和消息
→ RAG 检索知识库
→ LLM 流式回答
→ 记录 ai_run
→ 用户请求人工
→ Chatwoot 收到会话
→ Chatwoot 坐席回复
→ Widget 收到人工消息
```

任何不服务于这条闭环的需求，都不进入 v0.1。

---

## 二、硬性工程约束

1. **TypeScript monorepo 优先**：v0.1 不引入 Python 服务，除非必要。
2. **API-first**：所有 UI 功能必须有对应 API。
3. **Adapter-first**：Chatwoot 只通过 adapter 接入，不污染核心模型。
4. **SSE 优先**：AI 流式回复和人工消息推送先用 SSE。
5. **PostgreSQL + pgvector 起步**：不在 v0.1 引入复杂向量数据库。
6. **前端不接触 LLM Key**：所有模型调用只在后端完成。
7. **不复制第三方项目源码**：只用 API/Webhook 集成。
8. **所有多租户查询必须带 project_id**。
9. **AI 不确定时不编造**。
10. **Docker Compose 必须能跑完整 demo**。

---

## 三、推荐技术栈

```text
pnpm + Turborepo
TypeScript
Node.js + Fastify 或 NestJS
Next.js Admin Console
Lit/Preact Widget
PostgreSQL + pgvector
Redis + BullMQ
MinIO
Prisma 或 Drizzle
OpenAI-compatible API
Docker Compose
Vitest
Playwright
```

建议选择：

```text
Backend: Fastify
ORM: Prisma
Widget: Preact
Admin: Next.js
Tests: Vitest + Playwright
```

原因：实现速度快，类型系统完整，生态成熟，Codex 生成代码时也更容易保持一致。

---

## 四、仓库初始化

### 目标目录

```text
opensupportai/
  apps/
    admin-console/
    demo-app/
  services/
    api/
    worker/
  packages/
    protocol/
    sdk-js/
    widget/
    ui/
    llm/
    rag/
    adapters/
      chatwoot/
  prisma/
  deploy/
    docker-compose/
  docs/
  examples/
    html-widget/
    react-app/
```

### 初始化命令建议

```bash
pnpm init
pnpm add -D turbo typescript eslint prettier vitest
pnpm add -D @types/node tsx
```

根目录 `package.json` 目标：

```json
{
  "name": "opensupportai",
  "private": true,
  "packageManager": "pnpm@latest",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "typecheck": "turbo typecheck",
    "db:migrate": "pnpm --filter @opensupportai/api db:migrate",
    "db:seed": "pnpm --filter @opensupportai/api db:seed"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "latest",
    "eslint": "latest",
    "prettier": "latest",
    "vitest": "latest"
  }
}
```

---

## 五、环境变量

创建 `deploy/docker-compose/.env.example`：

```env
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000

DATABASE_URL=postgresql://opensupportai:opensupportai@localhost:5432/opensupportai
REDIS_URL=redis://localhost:6379

S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=opensupportai
S3_FORCE_PATH_STYLE=true

LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=replace_me
LLM_DEFAULT_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small

JWT_SECRET=replace_with_local_secret
ENCRYPTION_KEY=replace_with_32_byte_key

CHATWOOT_BASE_URL=http://localhost:3008
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_INBOX_ID=1
CHATWOOT_API_ACCESS_TOKEN=replace_me
CHATWOOT_WEBHOOK_SECRET=replace_me
```

---

## 六、数据库施工

v0.1 需要以下表：

```text
organizations
projects
inboxes
contacts
conversations
messages
knowledge_sources
knowledge_documents
knowledge_chunks
llm_providers
ai_runs
handoff_sessions
integration_configs
webhook_events
api_keys
```

### 关键索引

```text
projects.organization_id
inboxes.project_id
contacts.project_id + external_user_id
conversations.project_id + contact_id
messages.conversation_id + created_at
knowledge_documents.project_id + status
knowledge_chunks.project_id
handoff_sessions.conversation_id
handoff_sessions.provider + external_conversation_id
integration_configs.project_id + provider
webhook_events.provider + external_event_id
api_keys.project_id + key_hash
```

### 多租户规则

所有查询必须满足：

```text
organization_id 或 project_id 从鉴权上下文获得
数据库查询强制加 project_id 条件
任何外部 ID 不可直接作为唯一查询条件
```

错误示例：

```ts
await db.conversation.findUnique({ where: { id: conversationId } });
```

正确示例：

```ts
await db.conversation.findFirst({
  where: {
    id: conversationId,
    projectId: auth.projectId
  }
});
```

---

## 七、协议包施工

`packages/protocol` 是所有服务共享的类型源。

必须包含：

```text
src/auth.ts
src/conversation.ts
src/message.ts
src/events.ts
src/knowledge.ts
src/ai.ts
src/handoff.ts
src/api.ts
```

### Message 类型

```ts
export type MessageRole = "end_user" | "ai_agent" | "human_agent" | "system" | "tool";

export type MessageVisibility = "public" | "internal_note" | "debug_trace";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  visibility: MessageVisibility;
  contentType: "text" | "rich_text" | "file" | "event";
  content: unknown;
  sourceRefs?: SourceReference[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

### SSE Event 类型

```ts
export type SupportEvent =
  | { type: "message.created"; message: Message }
  | { type: "ai.delta"; conversationId: string; text: string }
  | { type: "ai.message.completed"; message: Message }
  | { type: "handoff.requested"; conversationId: string; reason: string }
  | { type: "human.message.created"; message: Message }
  | { type: "conversation.status_changed"; conversationId: string; status: string }
  | { type: "error"; code: string; message: string };
```

---

## 八、API 施工顺序

### PR-003 必须实现的 Client API

```http
POST /v1/client/conversations
GET  /v1/client/conversations/:conversationId/messages
POST /v1/client/conversations/:conversationId/messages
GET  /v1/client/conversations/:conversationId/events
POST /v1/client/conversations/:conversationId/handoff
```

### PR-010 必须实现的 Admin API

```http
POST /v1/admin/projects
GET  /v1/admin/projects
POST /v1/admin/projects/:projectId/llm-providers
GET  /v1/admin/projects/:projectId/llm-providers
POST /v1/admin/projects/:projectId/knowledge/documents
GET  /v1/admin/projects/:projectId/knowledge/documents
POST /v1/admin/projects/:projectId/integrations/chatwoot
GET  /v1/admin/projects/:projectId/conversations
GET  /v1/admin/projects/:projectId/conversations/:conversationId
```

### Webhook API

```http
POST /v1/webhooks/chatwoot/:projectId
```

所有 webhook 先写入 `webhook_events`，然后异步处理。

---

## 九、Conversation Service 施工

### 职责

- 创建 contact。
- 创建 conversation。
- 写入 messages。
- 广播 SSE events。
- 更新 conversation 状态。
- 触发 AI Orchestrator。
- 触发 handoff。

### 状态机

```text
open
→ pending_ai
→ open
→ handoff_requested
→ handed_off
→ closed
```

含义：

```text
open: 用户和 AI 正常对话
pending_ai: AI 正在生成回复
handoff_requested: 已请求人工，正在创建外部会话
handed_off: 由人工客服接管
closed: 会话关闭
```

### 写消息规则

- 用户消息：`role=end_user, visibility=public`
- AI 回复：`role=ai_agent, visibility=public`
- 坐席回复：`role=human_agent, visibility=public`
- 系统事件：`role=system, visibility=internal_note 或 public`
- 调试信息：`visibility=debug_trace`，默认不对 end user 展示

---

## 十、SSE 施工

### 目标

Widget 和 SDK 可以订阅会话事件。

```http
GET /v1/client/conversations/:id/events
Accept: text/event-stream
```

### 事件格式

```text
event: ai.delta
data: {"conversationId":"conv_123","text":"你可以在"}

```

### 实现建议

- API 实例内维护 subscription registry。
- Redis Pub/Sub 用于多实例广播。
- v0.1 单实例可以先内存实现，但接口设计要便于替换。
- 连接断开时清理 subscriber。
- 心跳事件每隔固定周期发送。

### 必须支持事件

```text
message.created
ai.delta
ai.message.completed
handoff.requested
human.message.created
conversation.status_changed
error
```

---

## 十一、LLM Adapter 施工

### 接口

```ts
export interface ChatModel {
  generate(input: ChatRequest): Promise<ChatResponse>;
  stream(input: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface EmbeddingModel {
  embed(texts: string[]): Promise<number[][]>;
}
```

### OpenAI-compatible Chat Completion

首版支持：

```text
POST {baseUrl}/chat/completions
stream: true
model
messages
temperature
max_tokens
```

### OpenAI-compatible Embedding

首版支持：

```text
POST {baseUrl}/embeddings
model
input
```

### 错误处理

必须处理：

```text
401 invalid key
429 rate limit
500 provider error
timeout
stream broken
malformed chunk
```

### ai_runs 记录

每次生成结束后写：

```text
project_id
conversation_id
message_id
model
provider
prompt_version
input_tokens
output_tokens
latency_ms
retrieved_chunk_ids
confidence
status
error
```

---

## 十二、RAG 施工

### 文档 ingestion

v0.1 支持：

```text
markdown
text
url
pdf
```

建议第一步先完成 markdown/text，URL/PDF 可随后补齐。

### 流程

```text
create knowledge_document(status=pending)
→ parse content
→ chunk
→ insert knowledge_chunks
→ trigger maintain lexical search_text
→ set document status=indexed
```

### chunk 策略

```text
worker chunk_size: 900 characters
同步 API chunk_size: 1200 characters
保留 title/source_uri/heading_path
```

### 检索

```text
project_id + indexed document filter
→ PostgreSQL FTS / CJK n-gram / trigram candidate search
→ bounded candidate set
→ deterministic score >= 0.34
→ stable top_k (normal answer path: 6)
```

`knowledge_chunks.embedding` 保留为后续 hybrid retrieval 预留字段，当前 ingestion 不调用 embedding provider，在线 retrieval 不执行 vector search。

### source_refs

每个 AI 回答保存：

```json
[
  {
    "document_id": "doc_123",
    "chunk_id": "chunk_456",
    "title": "取消订阅说明",
    "source_uri": "https://docs.example.com/billing",
    "score": 0.87
  }
]
```

---

## 十三、AI Orchestrator 施工

### v0.1 管线

```text
用户消息
→ 保存 message
→ 判断是否请求人工
→ 检索知识库
→ 判断是否有足够上下文
→ 构造 prompt
→ LLM 流式生成
→ SSE 推送 ai.delta
→ 保存 AI message
→ 保存 ai_run
→ 根据结果更新 conversation 状态
```

### Handoff intent

先用规则实现：

```text
转人工
人工客服
真人
投诉
退款
账单错误
我要找人
我要客服
```

### 低置信度策略

```text
无 chunk → 不回答，建议转人工
最高分低于阈值 → 不回答，建议转人工
敏感意图 → 简短说明并转人工
```

### 系统提示词

```text
你是一个客服助手。你必须遵守以下规则：
1. 只能根据提供的知识库内容回答。
2. 如果知识库中没有答案，明确说明暂时无法确认，并建议转人工。
3. 不要编造政策、价格、退款承诺、法律或医疗建议。
4. 涉及账号、账单、退款、身份、隐私数据时，必要时转人工。
5. 回答要简洁、友好、可操作。
6. 如果引用了知识库内容，返回 source_refs。
```

---

## 十四、Chatwoot Adapter 施工

### 转人工流程

```text
requestHandoff
→ 读取 Chatwoot integration config
→ create/update contact
→ create conversation
→ push transcript summary
→ push latest user message
→ 保存 handoff_session
→ conversation.status = handed_off
→ SSE: handoff.requested
```

### Webhook 回流

```text
Chatwoot webhook
→ 校验 webhook secret
→ 写 webhook_events
→ 解析 external_conversation_id
→ 找 handoff_session
→ 坐席公开消息写入 messages
→ Redis/SSE 广播 human.message.created
```

### 幂等要求

- `webhook_events(provider, external_event_id)` 唯一。
- `handoff_sessions(provider, external_conversation_id)` 唯一。
- 同一条外部消息不能重复写入本地 messages。

---

## 十五、SDK 施工

`@opensupportai/sdk-js` 必须提供：

```ts
const client = new OpenSupportAIClient({
  projectId,
  publicKey,
  userToken
});

await client.createConversation();
await client.sendMessage({ conversationId, text });
await client.listMessages(conversationId);
client.subscribe(conversationId, (event) => {});
await client.requestHandoff({ conversationId, reason });
```

### SDK 要求

- 浏览器可用。
- Node 测试环境可用。
- 不依赖 React。
- 类型完整。
- 错误类型明确。
- 自动处理 SSE reconnect。

---

## 十六、Widget 施工

Widget v0.1 功能：

```text
chat bubble
message panel
message list
input box
send button
streaming AI answer
handoff button
loading/error state
conversation persistence
```

### 初始化

```js
OpenSupportAI.init({
  projectId: "proj_123",
  publicKey: "pk_live_xxx",
  user: {
    id: "user_123",
    name: "张三",
    email: "zhangsan@example.com"
  },
  locale: "zh-CN"
});
```

### 非目标

- 不做复杂主题编辑器。
- 不做富媒体卡片。
- 不做复杂表单。
- 不做多语言 UI 管理后台。

---

## 十七、Admin Console 施工

v0.1 页面：

```text
/login
/projects
/projects/:id/settings
/projects/:id/llm
/projects/:id/knowledge
/projects/:id/integrations/chatwoot
/projects/:id/conversations
/projects/:id/conversations/:conversationId
```

### 简版权限

v0.1 可先用单管理员或种子账号，后续补组织成员权限。

### 页面要求

- 可以创建 project。
- 可以配置 LLM Provider。
- 可以上传知识文档。
- 可以配置 Chatwoot。
- 可以查看会话消息和 ai_runs。

---

## 十八、Docker Compose 施工

必须包含：

```text
postgres + pgvector
redis
minio
api
worker
admin-console
demo-app
```

Chatwoot 可以作为 optional profile：

```bash
docker compose --profile chatwoot up
```

### 验收命令

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

---

## 十九、测试策略

### Unit tests

```text
protocol schema
LLM adapter parsing
RAG chunker
handoff intent detector
source_refs builder
```

### API tests

```text
create conversation
send message
list messages
request handoff
chatwoot webhook
```

### Integration tests

```text
user message → AI reply saved
user message → low confidence → handoff
chatwoot webhook → human message visible
```

### E2E tests

```text
demo app opens widget
user sends message
AI stream appears
handoff button works
```

### Security tests

```text
cross-project conversation access denied
cross-project knowledge retrieval denied
invalid webhook secret denied
frontend cannot access secret config
```

---

## 二十、CI 要求

GitHub Actions：

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

后续增加：

```text
docker build
playwright e2e
container scan
secret scan
```

---

## 二十一、发布流程

### v0.1-alpha

满足：

```text
Docker Compose 可运行
Demo App 可演示完整闭环
README 快速开始可复现
核心测试通过
```

### v0.1-beta

满足：

```text
Admin Console 可配置 LLM/知识库/Chatwoot
SDK 和 Widget API 基本稳定
文档完整
```

### v0.1.0

满足：

```text
API 文档冻结
核心表结构迁移稳定
安全测试通过
Chatwoot Adapter 可用
开源治理文件完整
```

---

## 二十二、PR 施工顺序

```text
PR-001 仓库初始化
PR-002 数据库与基础模型
PR-003 Client Conversation API
PR-004 Headless SDK
PR-005 Widget MVP
PR-006 LLM Adapter
PR-007 Knowledge Service v0.1
PR-008 AI Orchestrator
PR-009 Chatwoot Adapter
PR-010 Admin Console 简版
PR-011 Docker Compose 一键演示
PR-012 测试与文档
```

每个 PR 必须有：

```text
目的
改动范围
测试方式
验收标准
文档更新
```

---

## 二十三、v0.1 Definition of Done

```text
1. 宿主网页可以通过 script 嵌入 Widget。
2. end user 可以创建会话并发送消息。
3. AI 可以基于知识库流式回答。
4. AI 回答不会在无知识命中时强行编造。
5. AI 回复保存到 messages。
6. 每次 AI 回复有 ai_run 记录。
7. 用户可以请求转人工。
8. Chatwoot 可以收到转人工会话。
9. Chatwoot 坐席回复可以回到 Widget。
10. 管理员可以上传知识文档。
11. 管理员可以配置 LLM provider。
12. Docker Compose 可以启动完整 demo。
13. README 可以让新用户完成本地部署。
```

---

## 二十四、施工红线

以下行为不允许进入 v0.1：

```text
把 LLM Key 放到前端
跨 project 查询没有 project_id 条件
无知识库命中仍让 AI 自由发挥
直接把 Chatwoot 模型作为核心数据库模型
把 Dify/Chatwoot/Tiledesk 源码复制进仓库
在核心逻辑里写死某一家 LLM Provider
不记录 ai_run
不校验 webhook secret
```

---

## 二十五、第一版演示脚本

演示用例：

```text
1. 打开 Admin Console。
2. 创建 project。
3. 配置 LLM Provider。
4. 上传“取消订阅说明”Markdown 文档。
5. 配置 Chatwoot。
6. 打开 Demo App。
7. Widget 自动出现。
8. 用户问：“我怎么取消订阅？”
9. AI 流式回答并给出来源。
10. 用户说：“我要找人工。”
11. Chatwoot 收到会话和摘要。
12. 坐席在 Chatwoot 回复：“您好，我来帮您处理。”
13. Widget 显示人工消息。
14. Admin Console 中可以看到会话和 ai_run。
```
