# OpenSupportAI API 规范 v0.6.0

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

限流响应头：

```http
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 119
X-RateLimit-Reset-Ms: 60000
```

超过限流时返回：

```http
HTTP/1.1 429 Too Many Requests
```

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded. Try again in 60 seconds.",
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

Webhook 按入口使用 provider secret 或项目 public key 校验。Generic channel webhook 使用项目 public key：

```http
X-OpenSupportAI-Public-Key: pk_live_xxx
```

或：

```http
POST /v1/channel-webhooks/generic?public_key=pk_live_xxx
```

Chatwoot webhook 使用 provider secret 校验。

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

## Channel Webhook API

### Generic Webhook 入站消息

```http
POST /v1/channel-webhooks/generic?public_key=pk_live_xxx
Content-Type: application/json
```

请求支持扁平或嵌套 JSON。示例：

```json
{
  "project_id": "proj_123",
  "inbox_id": "inbox_default",
  "event_id": "evt_123",
  "conversation_id": "external_thread_123",
  "text": "我怎么取消订阅？",
  "contact": {
    "id": "external_user_123",
    "name": "张三",
    "email": "zhangsan@example.com"
  },
  "metadata": {
    "source_url": "https://example.com/account"
  }
}
```

也支持：

```json
{
  "project_id": "proj_123",
  "message": {
    "id": "msg_external_123",
    "content": "我还想了解退款"
  },
  "conversation": {
    "id": "external_thread_123"
  },
  "user": {
    "external_user_id": "external_user_123"
  }
}
```

响应：

```json
{
  "status": "processed",
  "provider": "generic_webhook",
  "webhook_event_id": "webhook_123",
  "conversation_id": "conv_123",
  "message_id": "msg_123"
}
```

重复投递已处理过的 `event_id` 时会走幂等返回，不会再次写入 end-user message：

```json
{
  "status": "processed",
  "provider": "generic_webhook",
  "webhook_event_id": "webhook_123",
  "idempotent": true
}
```

处理语义：

- `event_id` / `message.id` 会写入 `webhook_events.external_event_id`。
- 幂等键为 `project_id + provider + external_event_id`。
- 相同外部 `conversation_id` 会复用同一个本地 conversation。
- 如果传入 `local_conversation_id` 或 `opensupportai_conversation_id`，会优先写入该本地 conversation。
- 成功处理后写入 end-user message，并复用现有 orchestrator 生成 AI 回复；v0.6 在配置 active 且非 demo 的 LLM provider 后，会对有知识命中的问题调用 OpenAI-compatible grounded answer path。
- 如果管理端配置了 generic webhook secret，请求必须携带配置的 secret header、`X-OpenSupportAI-Webhook-Secret`、`X-Webhook-Secret`，或 `Authorization: Bearer <secret>`。

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
POST /v1/admin/projects/{project_id}/llm
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

v0.6 生成语义：

- 当用户问题检索到知识块，且项目存在 active、非 `demo://local` 的 OpenAI-compatible provider 时，orchestrator 会调用该 provider 生成 grounded answer。
- Prompt 会包含用户问题和检索到的知识片段，并要求模型只基于片段回答；如果片段不足以回答，应说明无法根据当前知识库确认并建议转人工。
- `ai_runs` 会记录 provider、model、prompt version、token usage、latency、retrieved chunk ids 和 generation metadata。
- 未配置 provider、使用 `demo://local`、模型请求失败或模型返回空内容时，会回退到确定性 grounded answer；失败回退会在 `ai_runs.metadata.llm_fallback` 和 `llm_error` 中记录原因。
- 无知识命中时仍走 no-hit refusal，不调用 LLM，也不会编造答案。

---

### 创建 Admin API Key

```http
POST /v1/admin/projects/{project_id}/api-keys
Content-Type: application/json
```

请求：

```json
{
  "name": "Production automation",
  "scopes": ["admin:project"]
}
```

响应：

```json
{
  "api_key": {
    "id": "key_123",
    "projectId": "proj_123",
    "organizationId": "org_123",
    "name": "Production automation",
    "scopes": ["admin:project"],
    "createdAt": "2026-06-18T00:00:00.000Z"
  },
  "key": "osa_sk_xxx"
}
```

`key` 明文只在创建时返回一次；服务端只保存 hash。项目级 API key 只能访问自己的项目。

---

### 获取 Admin API Key 列表

```http
GET /v1/admin/projects/{project_id}/api-keys?include_revoked=false
```

响应不会包含 `keyHash` 或明文 key：

```json
{
  "api_keys": [
    {
      "id": "key_123",
      "name": "Production automation",
      "scopes": ["admin:project"],
      "lastUsedAt": "2026-06-18T00:05:00.000Z",
      "createdAt": "2026-06-18T00:00:00.000Z"
    }
  ]
}
```

---

### 撤销 Admin API Key

```http
DELETE /v1/admin/projects/{project_id}/api-keys/{key_id}
```

响应：

```json
{
  "api_key": {
    "id": "key_123",
    "name": "Production automation",
    "revokedAt": "2026-06-18T00:10:00.000Z"
  }
}
```

---

### Ops Health

```http
GET /v1/admin/projects/{project_id}/ops/health
```

响应：

```json
{
  "status": "ok",
  "generated_at": "2026-06-18T00:00:00.000Z",
  "project": {
    "id": "proj_123",
    "name": "Demo Project",
    "defaultLocale": "zh-CN"
  },
  "storage": {
    "mode": "prisma"
  },
  "checks": {
    "repository": "ok",
    "llm_provider_configured": true,
    "chatwoot": {
      "configured": true,
      "status": "active"
    }
  },
  "counts": {
    "conversations": {
      "open": 8
    },
    "recent_async_jobs": {
      "queued": 2
    },
    "recent_webhook_events": {
      "received": 1,
      "failed": 1
    }
  }
}
```

---

### 获取 Channel Adapter Catalog

```http
GET /v1/admin/projects/{project_id}/channels/adapters
```

需要 `admin:channels` scope。

响应：

```json
{
  "adapters": [
    {
      "provider": "generic_webhook",
      "name": "Generic Webhook",
      "status": "available",
      "capabilities": ["receive_message", "verify_webhook", "test_connection"],
      "configurationKeys": ["public_key", "webhook_secret"]
    },
    {
      "provider": "slack",
      "name": "Slack",
      "status": "stub",
      "capabilities": ["receive_message", "send_message", "verify_webhook", "test_connection"],
      "configurationKeys": ["bot_token", "signing_secret", "default_channel_id"]
    }
  ]
}
```

`slack`、`email`、`telegram` 在 v0.6 仍是契约 stub，表示协议、能力和配置项已固定，但尚未连接真实 provider API。

---

### 测试 Channel Adapter

```http
POST /v1/admin/projects/{project_id}/channels/adapters/{provider}/test
```

响应：

```json
{
  "result": {
    "provider": "generic_webhook",
    "ok": true,
    "status": "ok",
    "message": "Generic webhook adapter is available."
  }
}
```

Stub provider 会返回 `ok=false`、`status=stub`，不会访问真实第三方平台。

---

### 获取 Generic Webhook Channel 配置

```http
GET /v1/admin/projects/{project_id}/channels/generic-webhook
```

响应不会返回 secret 明文：

```json
{
  "channel": {
    "id": "integration_123",
    "provider": "generic_webhook",
    "status": "active",
    "configured": true,
    "metadata": {
      "secret_configured": true,
      "secret_header": "x-opensupportai-webhook-secret"
    }
  }
}
```

尚未配置时 `channel` 为 `null`。未配置时 generic webhook 仍可仅使用项目 public key；配置后必须校验 secret。

---

### 配置 Generic Webhook Channel

```http
POST /v1/admin/projects/{project_id}/channels/generic-webhook
Content-Type: application/json
```

请求：

```json
{
  "webhook_secret": "secret_xxx",
  "secret_header": "x-opensupportai-webhook-secret",
  "status": "active"
}
```

响应：

```json
{
  "channel": {
    "provider": "generic_webhook",
    "status": "active",
    "configured": true,
    "metadata": {
      "secret_configured": true,
      "secret_header": "x-opensupportai-webhook-secret"
    }
  }
}
```

---

### 获取审计日志

```http
GET /v1/admin/projects/{project_id}/audit-log?action=api_key.created&limit=100
```

响应：

```json
{
  "audit_logs": [
    {
      "id": "audit_123",
      "projectId": "proj_123",
      "actorType": "root_admin",
      "action": "api_key.created",
      "targetType": "api_key",
      "targetId": "key_123",
      "metadata": {
        "name": "Production automation"
      },
      "requestId": "req_123",
      "createdAt": "2026-06-18T00:00:00.000Z"
    }
  ]
}
```

---

### 获取工具列表

```http
GET /v1/admin/projects/{project_id}/tools?status=active&limit=100
```

响应：

```json
{
  "tools": [
    {
      "id": "tool_demo_order_lookup",
      "projectId": "proj_demo",
      "slug": "demo.order_lookup",
      "name": "Demo order lookup",
      "description": "Looks up a demo billing order by order_id.",
      "kind": "demo",
      "status": "active",
      "method": "GET",
      "path": "demo://orders/{order_id}",
      "inputSchema": {
        "type": "object"
      },
      "outputSchema": {
        "type": "object"
      }
    }
  ]
}
```

---

### Upsert 工具定义

```http
POST /v1/admin/projects/{project_id}/tools
Content-Type: application/json
```

请求：

```json
{
  "slug": "openapi.customer_lookup",
  "name": "Customer lookup",
  "description": "Looks up customer data from an allowlisted business API.",
  "kind": "openapi",
  "status": "disabled",
  "method": "GET",
  "path": "https://api.example.com/customers/{customer_id}",
  "input_schema": {
    "type": "object"
  },
  "output_schema": {
    "type": "object"
  }
}
```

响应：

```json
{
  "tool": {
    "id": "tool_123",
    "slug": "openapi.customer_lookup",
    "kind": "openapi",
    "status": "disabled"
  }
}
```

---

### 启停工具 Allowlist

```http
PATCH /v1/admin/projects/{project_id}/tools/{tool_id}
Content-Type: application/json
```

请求：

```json
{
  "status": "active"
}
```

`status=disabled` 的工具不会被 orchestrator 执行。

---

### 获取 Tool Call 日志

```http
GET /v1/admin/projects/{project_id}/tool-calls?conversation_id=conv_123&limit=100
```

响应：

```json
{
  "tool_calls": [
    {
      "id": "toolcall_123",
      "projectId": "proj_demo",
      "conversationId": "conv_123",
      "toolSlug": "demo.order_lookup",
      "status": "completed",
      "input": {
        "order_id": "ORD-2026-1001"
      },
      "output": {
        "found": true,
        "status": "paid"
      },
      "latencyMs": 1,
      "createdAt": "2026-06-18T00:00:00.000Z"
    }
  ]
}
```

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
GET /v1/admin/projects/{project_id}/conversations?status=open&q=zhang&limit=50&offset=0
```

查询参数：

| 参数            | 说明                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `status`        | 可选。`open`、`pending_ai`、`handoff_requested`、`handed_off`、`closed`。              |
| `assignee_type` | 可选。`ai`、`human`、`none`。                                                          |
| `q`             | 可选。按 conversation id、联系人、最近消息、handoff provider/status/external id 搜索。 |
| `limit`         | 可选。默认 `50`，最大 `100`。                                                          |
| `offset`        | 可选。默认 `0`。                                                                       |

响应：

```json
{
  "conversations": [
    {
      "id": "conv_123",
      "status": "open",
      "assigneeType": "ai",
      "contact": {
        "id": "contact_123",
        "name": "张三",
        "email": "zhangsan@example.com",
        "externalUserId": "user_123"
      },
      "messageCount": 4,
      "lastMessage": {
        "id": "msg_123",
        "role": "ai_agent",
        "text": "根据知识库，你可以在账单设置页面取消订阅。",
        "createdAt": "2026-06-17T10:01:00.000Z"
      },
      "handoff": {
        "id": "handoff_123",
        "provider": "chatwoot",
        "status": "active",
        "externalConversationId": "91",
        "updatedAt": "2026-06-17T10:02:00.000Z"
      },
      "lastMessageAt": "2026-06-17T10:01:00.000Z",
      "createdAt": "2026-06-17T10:00:00.000Z",
      "updatedAt": "2026-06-17T10:01:00.000Z"
    }
  ],
  "summary": {
    "total": 12,
    "filtered": 1,
    "byStatus": {
      "open": 8,
      "pending_ai": 0,
      "handoff_requested": 1,
      "handed_off": 2,
      "closed": 1
    },
    "byAssigneeType": {
      "ai": 8,
      "human": 3,
      "none": 1
    },
    "handoffStatus": {
      "requested": 1,
      "active": 2,
      "closed": 1,
      "failed": 0
    }
  },
  "pagination": {
    "limit": 50,
    "offset": 0,
    "returned": 1,
    "hasMore": false
  }
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
  "tool_calls": [],
  "insight": {
    "summary": "Conversation conv_123 is handed_off with human assignee.",
    "tags": ["billing.order", "handoff.active"],
    "suggestedReplies": ["我已经接入，会继续基于前面的对话记录处理。"]
  },
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

### 获取会话 Assist Insight

```http
GET /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
```

响应：

```json
{
  "insight": {
    "id": "insight_123",
    "projectId": "proj_123",
    "conversationId": "conv_123",
    "summary": "Conversation conv_123 is handed_off with human assignee.",
    "suggestedReplies": ["我已经接入，会继续基于前面的对话记录处理。"],
    "tags": ["billing.order", "handoff.active", "tool.used"],
    "metadata": {
      "message_count": 4,
      "tool_call_count": 1,
      "latest_handoff_status": "active"
    },
    "createdAt": "2026-06-18T00:00:00.000Z",
    "updatedAt": "2026-06-18T00:00:00.000Z"
  }
}
```

尚未生成时 `insight` 为 `null`。

---

### 生成会话 Assist Insight

```http
POST /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist
```

生成逻辑是确定性的，会基于 messages、handoff sessions 和 tool calls 生成 summary、tags 和 suggested replies。

---

### Handoff Analytics

```http
GET /v1/admin/projects/{project_id}/analytics/handoffs
```

响应：

```json
{
  "analytics": {
    "generatedAt": "2026-06-18T00:00:00.000Z",
    "total": 12,
    "byStatus": {
      "requested": 3,
      "active": 7,
      "closed": 2
    },
    "byReason": {
      "user_requested": 10,
      "low_confidence": 2
    },
    "byProvider": {
      "chatwoot": 12
    }
  }
}
```

---

### 创建异步任务

```http
POST /v1/admin/projects/{project_id}/jobs
Content-Type: application/json
```

请求：

```json
{
  "type": "knowledge.index",
  "payload": {
    "document_id": "doc_123"
  },
  "run_at": "2026-06-18T00:00:00.000Z",
  "max_attempts": 3
}
```

响应：

```json
{
  "job": {
    "id": "job_123",
    "projectId": "proj_123",
    "type": "knowledge.index",
    "status": "queued",
    "payload": {
      "document_id": "doc_123"
    },
    "attempts": 0,
    "maxAttempts": 3,
    "runAt": "2026-06-18T00:00:00.000Z",
    "createdAt": "2026-06-18T00:00:00.000Z",
    "updatedAt": "2026-06-18T00:00:00.000Z"
  }
}
```

---

### 获取异步任务列表

```http
GET /v1/admin/projects/{project_id}/jobs?status=queued&type=knowledge.index&limit=50
```

查询参数：

| 参数     | 说明                                                            |
| -------- | --------------------------------------------------------------- |
| `status` | 可选。`queued`、`running`、`completed`、`failed`、`cancelled`。 |
| `type`   | 可选。任务类型，例如 `knowledge.index`、`webhook.retry`。       |
| `limit`  | 可选。默认 `50`，最大 `100`。                                   |

响应：

```json
{
  "jobs": [
    {
      "id": "job_123",
      "type": "knowledge.index",
      "status": "queued",
      "attempts": 0,
      "maxAttempts": 3
    }
  ]
}
```

---

### 获取 Webhook Event 列表

```http
GET /v1/admin/projects/{project_id}/webhooks/events?provider=chatwoot&status=failed&limit=50
```

查询参数：

| 参数       | 说明                                                 |
| ---------- | ---------------------------------------------------- |
| `provider` | 可选。例如 `chatwoot`。                              |
| `status`   | 可选。`received`、`processed`、`failed`、`ignored`。 |
| `limit`    | 可选。默认 `50`，最大 `100`。                        |

响应：

```json
{
  "webhook_events": [
    {
      "id": "webhook_123",
      "projectId": "proj_123",
      "provider": "chatwoot",
      "externalEventId": "cw_123",
      "status": "failed",
      "error": "No local conversation reference",
      "createdAt": "2026-06-18T00:00:00.000Z"
    }
  ]
}
```

---

### 调度 Webhook Event Retry

```http
POST /v1/admin/projects/{project_id}/webhooks/events/{event_id}/retry
Content-Type: application/json
```

请求：

```json
{
  "run_at": "2026-06-18T00:05:00.000Z"
}
```

响应：

```json
{
  "webhook_event": {
    "id": "webhook_123",
    "status": "received"
  },
  "job": {
    "id": "job_123",
    "type": "webhook.retry",
    "status": "queued",
    "payload": {
      "webhook_event_id": "webhook_123",
      "provider": "chatwoot"
    }
  }
}
```

已 `processed` 的 webhook event 不需要 retry，会返回 `invalid_request`。

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
