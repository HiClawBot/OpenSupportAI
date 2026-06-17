# OpenSupportAI API 规范 v0.1

## 通用约定

Base URL：

```text
http://localhost:4000
```

API Version：

```text
/v1
```

错误格式：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human readable message",
    "request_id": "req_123"
  }
}
```

---

## 鉴权

### Client API

Client API 面向 end user 的 Widget/SDK。

支持两种模式：

```text
publicKey + anonymous/session identity
signed_user_token
```

Header：

```http
Authorization: Bearer <signed_user_token>
```

或者：

```http
X-OpenSupportAI-Public-Key: pk_live_xxx
```

### Admin API

Admin API 使用管理员 session 或 admin API key。

```http
Authorization: Bearer <admin_token>
```

### Webhook API

Webhook 使用 provider secret 校验。

```http
X-OpenSupportAI-Signature: <signature>
```

---

## Client API

### 创建会话

```http
POST /v1/client/conversations
Content-Type: application/json
```

请求：

```json
{
  "project_id": "proj_123",
  "inbox_id": "inbox_default",
  "contact": {
    "external_user_id": "user_123",
    "name": "张三",
    "email": "zhangsan@example.com"
  },
  "metadata": {
    "page_url": "https://app.example.com/billing",
    "app_version": "1.0.0"
  }
}
```

响应：

```json
{
  "conversation_id": "conv_123",
  "status": "open"
}
```

---

### 获取消息列表

```http
GET /v1/client/conversations/{conversation_id}/messages
```

响应：

```json
{
  "messages": [
    {
      "id": "msg_1",
      "conversation_id": "conv_123",
      "role": "end_user",
      "visibility": "public",
      "content_type": "text",
      "content": {
        "text": "我怎么取消订阅？"
      },
      "created_at": "2026-06-17T10:00:00.000Z"
    }
  ]
}
```

---

### 发送消息

```http
POST /v1/client/conversations/{conversation_id}/messages
Content-Type: application/json
```

请求：

```json
{
  "type": "text",
  "text": "我怎么取消订阅？"
}
```

响应：

```json
{
  "message_id": "msg_123",
  "conversation_id": "conv_123",
  "status": "accepted"
}
```

发送消息后，后端应：

```text
保存用户消息
触发 AI Orchestrator 或 handoff
通过 SSE 返回后续事件
```

---

### 订阅事件流

```http
GET /v1/client/conversations/{conversation_id}/events
Accept: text/event-stream
```

事件示例：

```text
event: message.created
data: {"message":{"id":"msg_user_1","role":"end_user"}}

```

```text
event: ai.delta
data: {"conversationId":"conv_123","text":"你可以在"}

```

```text
event: ai.message.completed
data: {"message":{"id":"msg_ai_1","role":"ai_agent"}}

```

```text
event: handoff.requested
data: {"conversationId":"conv_123","reason":"user_requested"}

```

```text
event: human.message.created
data: {"message":{"id":"msg_human_1","role":"human_agent"}}

```

---

### 请求人工

```http
POST /v1/client/conversations/{conversation_id}/handoff
Content-Type: application/json
```

请求：

```json
{
  "reason": "user_requested",
  "note": "用户要求人工处理退款"
}
```

响应：

```json
{
  "conversation_id": "conv_123",
  "status": "handoff_requested"
}
```

---

## Admin API

### 创建 Project

```http
POST /v1/admin/projects
Content-Type: application/json
```

请求：

```json
{
  "name": "Demo Project",
  "default_locale": "zh-CN"
}
```

响应：

```json
{
  "project_id": "proj_123",
  "public_key": "pk_live_xxx"
}
```

---

### 配置 LLM Provider

```http
POST /v1/admin/projects/{project_id}/llm-providers
Content-Type: application/json
```

请求：

```json
{
  "provider": "openai_compatible",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4.1-mini",
  "embedding_model": "text-embedding-3-small",
  "api_key": "sk_xxx"
}
```

响应：

```json
{
  "id": "llm_provider_123",
  "provider": "openai_compatible",
  "model": "gpt-4.1-mini",
  "status": "active"
}
```

API Key 必须加密存储，不可在 GET 响应中返回明文。

---

### 创建知识文档

```http
POST /v1/admin/projects/{project_id}/knowledge/documents
Content-Type: application/json
```

请求：

```json
{
  "source_type": "markdown",
  "title": "取消订阅说明",
  "content": "# 取消订阅\n用户可以进入账单设置页面取消订阅。",
  "metadata": {
    "locale": "zh-CN",
    "tags": ["billing", "subscription"]
  }
}
```

响应：

```json
{
  "document_id": "doc_123",
  "status": "pending"
}
```

---

### 获取知识文档

```http
GET /v1/admin/projects/{project_id}/knowledge/documents
```

响应：

```json
{
  "documents": [
    {
      "id": "doc_123",
      "title": "取消订阅说明",
      "source_type": "markdown",
      "status": "indexed",
      "created_at": "2026-06-17T10:00:00.000Z"
    }
  ]
}
```

---

### 配置 Chatwoot

```http
POST /v1/admin/projects/{project_id}/integrations/chatwoot
Content-Type: application/json
```

请求：

```json
{
  "base_url": "https://chatwoot.example.com",
  "account_id": "1",
  "inbox_id": "2",
  "api_access_token": "token_xxx",
  "webhook_secret": "secret_xxx"
}
```

响应：

```json
{
  "provider": "chatwoot",
  "status": "active"
}
```

---

### 测试 Chatwoot 连接

```http
POST /v1/admin/projects/{project_id}/integrations/chatwoot/test
```

响应：

```json
{
  "ok": true,
  "result": {
    "accountId": "1",
    "inboxId": "2",
    "inboxName": "Support"
  },
  "integration": {
    "provider": "chatwoot",
    "status": "active",
    "metadata": {
      "last_tested_at": "2026-06-17T10:00:00.000Z",
      "last_test_ok": true,
      "last_test_inbox_name": "Support"
    }
  }
}
```

失败时返回 200 且 `ok=false`，错误会写入 `integration.metadata.last_test_error`。

---

### 重试 Chatwoot Handoff

```http
POST /v1/admin/projects/{project_id}/handoffs/{handoff_id}/retry
```

响应：

```json
{
  "handoff_session": {
    "id": "handoff_123",
    "provider": "chatwoot",
    "status": "active",
    "externalConversationId": "91"
  },
  "status": "handed_off"
}
```

仅支持重试 `provider=chatwoot` 且尚未 `active/closed` 的 handoff session。

---

### 获取会话列表

```http
GET /v1/admin/projects/{project_id}/conversations
```

响应：

```json
{
  "conversations": [
    {
      "id": "conv_123",
      "status": "open",
      "assignee_type": "ai",
      "contact": {
        "name": "张三",
        "email": "zhangsan@example.com"
      },
      "last_message_at": "2026-06-17T10:00:00.000Z"
    }
  ]
}
```

---

### 获取会话详情

```http
GET /v1/admin/projects/{project_id}/conversations/{conversation_id}
```

响应：

```json
{
  "conversation": {
    "id": "conv_123",
    "status": "open"
  },
  "messages": [],
  "ai_runs": [],
  "handoff_sessions": [
    {
      "id": "handoff_123",
      "provider": "chatwoot",
      "status": "active",
      "externalConversationId": "91",
      "metadata": {
        "external_contact_source_id": "source_42"
      }
    }
  ]
}
```

---

## Webhook API

### Chatwoot Webhook

```http
POST /v1/webhooks/chatwoot/{project_id}
Content-Type: application/json
X-OpenSupportAI-Signature: <signature>
```

处理规则：

```text
1. 校验 signature 或 webhook_secret。
2. 写入 webhook_events。
3. 根据 external_conversation_id 查找 handoff_session。
4. 如果是坐席公开回复，写入 human_agent message。
5. 如果是 conversation_status_changed，更新 conversation 和 handoff_session 状态。
6. 广播 human.message.created 或 conversation.status_changed。
7. 幂等处理重复 webhook。
```

---

## SSE Event Schema

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

## 版本策略

- `/v1` 在 v1.0 前允许小幅调整。
- SDK 每次破坏性改动必须同步更新 protocol 类型。
- Widget 不应依赖未公开的内部 API。
- 后续 v1.0 后遵循语义化版本。
