# Codex 开发任务清单

本文档用于指导 Codex 或自动化开发代理把 OpenSupportAI 设计落地为可运行的开源项目。

---

## 总目标

实现 OpenSupportAI v0.1：

```text
一个可嵌入的 AI 智能客服组件，支持 Widget/SDK、Conversation API、RAG 问答、OpenAI-compatible LLM、Chatwoot 人工转接、Admin Console 和 Docker Compose demo。
```

v0.1 端到端验收：

```text
Demo App 嵌入 Widget
→ 用户提问
→ 系统基于知识库用 LLM 流式回答
→ 无知识命中不编造
→ 用户请求人工
→ Chatwoot 收到会话
→ 坐席回复回到 Widget
→ Admin Console 可查看会话和 ai_run
```

---

## Codex 工作原则

1. 不要一次性生成所有功能。按 PR-001 到 PR-012 顺序施工。
2. 每个 PR 保持可运行、可测试、可 review。
3. 先实现最小闭环，不做超出 v0.1 的功能。
4. 所有共享类型放在 `packages/protocol`。
5. API、SDK、Widget、Admin 使用同一套类型定义。
6. 不要把 LLM API Key 放在前端。
7. 所有数据库查询必须校验 project_id 或 organization_id。
8. Chatwoot 只通过 adapter 接入。
9. 无 RAG 命中时不要让 AI 编造回答。
10. 每次 AI 调用必须写 ai_runs。

---

## 推荐初始化 Prompt

把下面这段作为 Codex 的第一条任务：

```text
你是 OpenSupportAI 项目的工程实现代理。请根据 README.md、docs/CONSTRUCTION.zh-CN.md、docs/ARCHITECTURE.zh-CN.md、docs/API_SPEC.zh-CN.md、docs/DATA_MODEL.zh-CN.md 和 docs/CODEX_TASKS.zh-CN.md 实现项目。

硬性要求：
1. 使用 TypeScript monorepo、pnpm、Turborepo。
2. v0.1 只做 Widget/SDK、Conversation API、RAG、LLM Adapter、Chatwoot Adapter、Admin Console 简版和 Docker Compose demo。
3. 不要实现 CRM、营销自动化、全渠道客服、可视化 Agent Builder。
4. 前端不允许接触任何 LLM API Key。
5. 所有多租户数据访问必须通过 project_id 隔离。
6. 每个 PR 都要包含测试和文档更新。
7. 按 docs/CODEX_TASKS.zh-CN.md 的 PR 顺序推进。

现在请执行 PR-001：初始化 monorepo、基础配置、文档和 Docker Compose skeleton。完成后输出改动摘要、测试命令和下一步建议。
```

---

## PR-001：初始化仓库

### 目标

创建基础 monorepo，保证开发环境能跑。

### 文件范围

```text
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
.eslintrc 或 eslint.config.js
.prettierrc
.gitignore
README.md
LICENSE
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SECURITY.md
apps/admin-console/package.json
apps/demo-app/package.json
services/api/package.json
services/worker/package.json
packages/protocol/package.json
packages/sdk-js/package.json
packages/widget/package.json
packages/llm/package.json
packages/rag/package.json
packages/adapters/chatwoot/package.json
deploy/docker-compose/docker-compose.yml
deploy/docker-compose/.env.example
```

### 验收

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Docker skeleton 能启动 Postgres、Redis、MinIO。

---

## PR-002：数据库与基础模型

### 目标

实现数据库 schema 和基础 CRUD seed。

### 表

```text
organizations
projects
inboxes
contacts
conversations
messages
api_keys
```

### 要求

- 使用 Prisma 或 Drizzle。
- 增加 migration。
- 增加 seed：创建 demo organization、project、inbox、admin key。
- 所有主键使用 cuid/uuid。
- 时间字段统一 `created_at`、`updated_at`。

### 验收

```bash
pnpm db:migrate
pnpm db:seed
```

能创建 project/contact/conversation/message。

---

## PR-003：Client Conversation API

### 目标

实现 end user 侧会话 API。

### Endpoint

```http
POST /v1/client/conversations
GET  /v1/client/conversations/:conversationId/messages
POST /v1/client/conversations/:conversationId/messages
GET  /v1/client/conversations/:conversationId/events
POST /v1/client/conversations/:conversationId/handoff
```

### 要求

- 支持 project public key 或 signed user token。
- 写入 contact/conversation/message。
- SSE 可收到 message.created。
- requestHandoff 先只更新状态和发送事件，不接 Chatwoot。

### 验收

API test 覆盖创建会话、发送消息、订阅事件、请求人工。

---

## PR-004：Headless SDK

### 目标

实现 `@opensupportai/sdk-js`。

### API

```ts
new OpenSupportAIClient(options);
client.createConversation(input);
client.sendMessage(input);
client.listMessages(conversationId);
client.subscribe(conversationId, handler);
client.requestHandoff(input);
```

### 要求

- 使用 fetch + EventSource 或 fetch-event-source。
- 自动解析 SSE event。
- 类型来自 `packages/protocol`。
- 浏览器和测试环境可用。

### 验收

examples/html-widget 可以使用 SDK 完成创建会话和发消息。

---

## PR-005：Widget MVP

### 目标

实现可嵌入 Widget。

### 功能

```text
chat bubble
panel
message list
input
send button
streaming answer display
handoff button
error state
local conversation persistence
```

### 初始化 API

```js
OpenSupportAI.init({
  projectId: "proj_123",
  publicKey: "pk_live_xxx",
  user: { id: "user_123", name: "张三", email: "zhangsan@example.com" },
  locale: "zh-CN"
});
```

### 验收

Demo App 嵌入一行 script 后能看到 Widget，并能发消息到 API。

---

## PR-006：LLM Adapter

### 目标

实现 OpenAI-compatible LLM 调用。

### 包

```text
packages/llm
```

### 接口

```ts
ChatModel.generate();
ChatModel.stream();
EmbeddingModel.embed();
```

### 要求

- 支持 base_url、api_key、model。
- 支持 streaming chat completion。
- 支持 embedding。
- 处理 provider error、rate limit、timeout、stream parse error。
- 记录 usage，无法获取 usage 时允许为空。

### 验收

用户消息可以触发 LLM 流式回复，回复保存到 messages。

---

## PR-007：Knowledge Service v0.1

### 目标

实现知识库 ingestion、embedding 和 pgvector retrieval。

### 表

```text
knowledge_sources
knowledge_documents
knowledge_chunks
```

### 功能

```text
POST /v1/admin/projects/:projectId/knowledge/documents
GET  /v1/admin/projects/:projectId/knowledge/documents
```

### 支持格式

先实现：

```text
markdown
text
```

随后补：

```text
url
pdf
```

### 验收

上传 FAQ 后，用户相关问题可检索到 chunk。

---

## PR-008：AI Orchestrator

### 目标

实现客服问答管线。

### 流程

```text
保存用户消息
→ 检测 handoff intent
→ 检索知识库
→ 低置信度 fallback
→ 构造 prompt
→ LLM stream
→ SSE ai.delta
→ 保存 AI message
→ 保存 ai_run
```

### 要求

- 无知识命中时不编造。
- source_refs 写入 AI message。
- 每次生成写 ai_runs。
- 支持 prompt_version。

### 验收

有知识命中时回答，无知识命中时建议转人工，用户说“转人工”时不调用 LLM。

---

## PR-009：Chatwoot Adapter

### 目标

实现 Chatwoot 人工转接。

### 功能

```text
create/update contact
create conversation
push transcript
push user message
receive webhook
map human message back to local conversation
```

### 要求

- integration config 加密保存。
- webhook secret 校验。
- webhook_events 先落库。
- 幂等处理。
- 坐席公开回复写入 messages。
- SSE 推送 human.message.created。

### 验收

用户请求人工后 Chatwoot 出现会话，坐席回复后 Widget 收到消息。

---

## PR-010：Admin Console 简版

### 目标

实现最小管理台。

### 页面

```text
/projects
/projects/:id/settings
/projects/:id/llm
/projects/:id/knowledge
/projects/:id/integrations/chatwoot
/projects/:id/conversations
/projects/:id/conversations/:conversationId
```

### 要求

- 能创建 project。
- 能配置 LLM Provider。
- 能上传知识文档。
- 能配置 Chatwoot。
- 能查看 conversation/messages/ai_runs。

### 验收

无需直接改数据库即可完成 demo 配置。

---

## PR-011：Docker Compose 一键演示

### 目标

实现完整本地 demo。

### 服务

```text
postgres + pgvector
redis
minio
api
worker
admin-console
demo-app
optional chatwoot
```

### 验收

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Demo App 可以跑完整 AI 问答和转人工闭环。

---

## PR-012：测试与文档

### 目标

补齐质量和开源文档。

### 测试

```text
unit tests
api tests
integration tests
e2e smoke tests
security tests
```

### 文档

```text
README
quickstart
integration guide
self-host guide
security guide
adapter guide
API reference
```

### 验收

新开发者按 README 可以本地跑通 demo。

---

## 生成代码时的风格要求

### TypeScript

- 开启 strict mode。
- 不使用 any，确实需要时用 unknown 并做校验。
- 公共输入使用 Zod schema。
- API handler 必须有错误处理。
- 外部接口必须有 timeout。

### 错误格式

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human readable message",
    "request_id": "req_123"
  }
}
```

### 日志

必须记录：

```text
request_id
project_id
conversation_id
provider
latency_ms
error_code
```

不要记录明文 API Key、用户密码、完整敏感 PII。

---

## 禁止事项

Codex 不应实现：

```text
复杂 CRM
营销自动化
多渠道社媒收件箱
完整工单系统
可视化 Agent Builder
私有模型部署管理
未授权外部工具调用
前端直连 LLM Provider
无 project_id 的跨租户查询
```

---

## 最终验收清单

```text
[ ] pnpm install 成功
[ ] pnpm lint 成功
[ ] pnpm typecheck 成功
[ ] pnpm test 成功
[ ] docker compose 启动基础依赖
[ ] db migrate/seed 成功
[ ] Admin Console 可创建 project
[ ] Admin Console 可配置 LLM
[ ] Admin Console 可上传知识文档
[ ] Demo App 可显示 Widget
[ ] Widget 可发送用户消息
[ ] API 可保存消息
[ ] RAG 可检索知识库
[ ] LLM 可流式回答
[ ] AI message 写入 messages
[ ] ai_run 写入 ai_runs
[ ] 无知识命中不编造
[ ] 用户可请求人工
[ ] Chatwoot 可收到会话
[ ] Chatwoot 坐席回复回到 Widget
[ ] README 快速开始可复现
```
