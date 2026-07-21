# OpenSupportAI v1.0 公共契约

本文定义 OpenSupportAI v1.0 起承诺保持稳定的公共接口。v1.0 的目标是让自托管部署、二次开发和适配器集成有清晰边界，而不是一次性完成完整 CRM、工单系统或全渠道收件箱。

## 版本策略

- `v1.0.0` 起遵循语义化版本。
- Patch 版本只修复缺陷、文档、兼容性问题和安全问题。
- Minor 版本可以新增字段、endpoint、事件和 adapter 能力，但不应破坏现有稳定契约。
- 破坏性变更必须进入下一个 major 版本，并提供迁移说明。

## 稳定 REST API

`/v1` 下列接口在 v1.0 后视为稳定公共 API：

```text
GET  /health

POST /v1/client/conversations
GET  /v1/client/conversations/{conversation_id}/messages
POST /v1/client/conversations/{conversation_id}/messages
POST /v1/client/conversations/{conversation_id}/stream-token
GET  /v1/client/conversations/{conversation_id}/events
POST /v1/client/conversations/{conversation_id}/handoff

GET  /v1/admin/projects
POST /v1/admin/projects
GET  /v1/admin/projects/{project_id}/conversations
GET  /v1/admin/projects/{project_id}/conversations/{conversation_id}
GET  /v1/admin/projects/{project_id}/knowledge/documents
POST /v1/admin/projects/{project_id}/knowledge/documents
POST /v1/admin/projects/{project_id}/knowledge/documents/{document_id}/reindex
GET  /v1/admin/projects/{project_id}/llm
POST /v1/admin/projects/{project_id}/llm
GET  /v1/admin/projects/{project_id}/chatwoot
POST /v1/admin/projects/{project_id}/chatwoot
POST /v1/admin/projects/{project_id}/chatwoot/test
GET  /v1/admin/projects/{project_id}/channels/adapters
POST /v1/admin/projects/{project_id}/channels/adapters/{provider}/test
GET  /v1/admin/projects/{project_id}/channels/generic-webhook
POST /v1/admin/projects/{project_id}/channels/generic-webhook
GET  /v1/admin/projects/{project_id}/channels/slack
POST /v1/admin/projects/{project_id}/channels/slack
GET  /v1/admin/projects/{project_id}/tools
POST /v1/admin/projects/{project_id}/tools
PATCH /v1/admin/projects/{project_id}/tools/{tool_id}
GET  /v1/admin/projects/{project_id}/tool-calls
GET  /v1/admin/projects/{project_id}/api-keys
POST /v1/admin/projects/{project_id}/api-keys
DELETE /v1/admin/projects/{project_id}/api-keys/{key_id}
GET  /v1/admin/projects/{project_id}/audit-log
GET  /v1/admin/projects/{project_id}/jobs
POST /v1/admin/projects/{project_id}/jobs
GET  /v1/admin/projects/{project_id}/webhooks/events
POST /v1/admin/projects/{project_id}/webhooks/events/{event_id}/retry
GET  /v1/admin/projects/{project_id}/ops/health
GET  /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
POST /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
GET  /v1/admin/projects/{project_id}/analytics/handoffs

POST /v1/channel-webhooks/generic
POST /v1/channel-webhooks/slack
POST /v1/webhooks/chatwoot/{project_id}
```

稳定规则：

- 现有成功响应字段不会被删除或重命名。
- 新字段只能以向后兼容方式添加。
- Error response 保持 `{ "error": { "code", "message" } }` 形状。
- `X-OpenSupportAI-Public-Key` 仅用于创建会话和 channel webhook；已有会话操作使用创建响应返回的 conversation capability。
- SSE endpoint 仅接受通过 conversation capability 换取的短期 stream token。
- Admin API 继续支持 `Authorization: Bearer <admin-token-or-api-key>`。
- Webhook endpoint 继续保持 project/public-key scoped 的鉴权边界。

## 稳定 SDK 契约

`@opensupportai/sdk-js` v1.0 稳定以下 API：

```ts
new OpenSupportAIClient({
  apiUrl,
  projectId,
  publicKey,
  conversationToken
});

client.createConversation({ inboxId, contact, metadata });
client.sendMessage({ conversationId, text });
client.listMessages(conversationId);
client.requestHandoff({ conversationId, reason, note });
client.subscribe(conversationId, handler);
```

稳定事件：

```text
message.created
ai.delta
ai.message.completed
handoff.requested
human.message.created
conversation.status_changed
support.error
```

## 稳定 Widget 契约

`@opensupportai/widget` v1.0 稳定以下入口：

```ts
import { OpenSupportAI, init } from "@opensupportai/widget";

const controller = init({
  apiUrl,
  projectId,
  publicKey,
  conversationToken,
  inboxId,
  locale,
  user
});

controller.destroy();
```

`userToken` 作为 `conversationToken` 的兼容别名暂时保留，但已废弃。Widget 将会话 capability 保存在当前标签页的 `sessionStorage`；Widget DOM、Shadow DOM 内部 class name 和内部渲染结构不属于稳定公共契约。

## 稳定 Adapter 契约

v1.0 稳定以下 adapter 边界：

- Chatwoot handoff adapter：连接测试、contact 创建/更新、conversation 创建、消息推送、公开坐席回复 webhook 回流。
- Generic webhook channel adapter：secret 校验、payload 归一化、event id 幂等、本地 conversation 复用。
- Slack inbound channel adapter：Slack Events API timestamp/signature 校验、URL verification、message event 入站归一化、event id 幂等。
- OpenAPI-style business tool executor：active tool allowlist、intent 抽取、host allowlist、timeout、response shaping、answer template、bearer-env auth、mutation guard、completed/failed tool-call 记录。

Email 和 Telegram 当前仍是 adapter catalog stub，不属于 v1.0 已实现 provider API。

## 不稳定或实验边界

以下能力不属于 v1.0 稳定契约：

- 内部 repository 接口和内存存储实现。
- Admin Console 内部组件结构和 CSS class name。
- `webhook.retry` 的真实重放处理器。
- 自动 OpenAPI spec import、模型工具规划器和高风险工具人工审批流。
- Embedding/vector retrieval 的最终生产实现；当前检索仍有确定性 keyword fallback。
- Slack 出站回复、Email provider API、Telegram provider API。

## 兼容性要求

新增功能必须满足：

- 不破坏 `/v1` 已有请求/响应。
- 不改变 SDK 方法签名。
- 不改变 Widget 初始化参数语义。
- 不降低多租户 `project_id` 隔离。
- 不让前端接触 LLM key、integration token、webhook secret 或工具密钥。
- 新 adapter 或 tool executor 必须有本地可复现 smoke 或测试。
