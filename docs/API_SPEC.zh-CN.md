# OpenSupportAI API 规范 v1.0.0

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

## 运行状态

进程存活：

```http
GET /health/live
```

只检查 API 进程是否响应，成功返回 HTTP `200`。

组件就绪：

```http
GET /health/ready
```

检查数据库连接、预期 migration，以及至少一个未过期且同时监听 `answer.generate`、`knowledge.index` 的 worker。关键项失败时返回 HTTP `503` 与稳定 `reasons` code；队列年龄过高只把 queue check 标记为 `degraded`。

兼容端点 `GET /health` 与 `GET /v1/health` 继续表示进程存活。

---

## 鉴权

### Client API

Client API 面向 end user 的 Widget/SDK。

创建会话时使用项目 public key：

```http
X-OpenSupportAI-Public-Key: pk_live_xxx
```

创建成功后，API 返回绑定到 `project_id + conversation_id` 的 conversation capability。读取消息、发送消息、请求人工转接和换取 stream token 时必须使用：

```http
Authorization: Bearer <conversation_token>
```

项目 public key 不能读取或操作已有会话。

### Admin API

Admin API 使用管理员 session 或 admin API key。

```http
Authorization: Bearer <admin_token>
```

项目 API key 使用显式 scope。当前 scope 包括 `admin:project`、`admin:ops`、`admin:conversations`、`admin:knowledge`、`admin:llm`、`admin:integrations`、`admin:channels`、`admin:keys`、`admin:audit`、`admin:tools`、`admin:assist`、`admin:jobs`、`admin:webhooks`。Root admin token 不受 scope 限制。

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

Slack channel webhook 使用项目 public key 加 Slack request signature 双重校验。

```http
X-Slack-Request-Timestamp: 1710000000
X-Slack-Signature: v0=...
```

---

## Client API

### 创建会话

```http
POST /v1/client/conversations
Content-Type: application/json
Idempotency-Key: <stable-request-key>
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
  "status": "open",
  "conversation_token": "osa_v1...",
  "conversation_token_expires_at": "2026-07-28T12:00:00.000Z",
  "idempotent": false
}
```

`Idempotency-Key` 可选，建议由客户端为一次逻辑创建操作生成并在网络重试时复用。相同 key 与相同请求体返回原会话并设置 `idempotent=true`；相同 key 搭配不同请求体返回 `409 invalid_request`。

---

### 获取消息列表

```http
GET /v1/client/conversations/{conversation_id}/messages?limit=50&after={message_id}
Authorization: Bearer <conversation_token>
```

`limit` 默认 `50`、最大 `100`。`after` 是上一页返回的 `next_cursor`；消息按持久化 sequence 稳定排序。

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
  ],
  "next_cursor": "msg_1"
}
```

仅当还有下一页时返回 `next_cursor`。

---

### 发送消息

```http
POST /v1/client/conversations/{conversation_id}/messages
Authorization: Bearer <conversation_token>
Content-Type: application/json
Idempotency-Key: <stable-request-key>
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
  "status": "accepted",
  "idempotent": false
}
```

消息幂等语义与创建会话一致。重复请求不会再次保存消息或创建回答任务；key 冲突返回 `409 invalid_request`。`status: accepted` 表示消息和后续处理请求已持久化，不表示 AI 回答已经完成。

发送消息后，后端应：

```text
在同一事务中保存用户消息并创建 answer.generate job
由 Worker 执行 AI Orchestrator；显式 handoff 请求保持同步处理
通过消息列表或 SSE 返回持久化的后续事件
```

---

### 换取 Stream Token

```http
POST /v1/client/conversations/{conversation_id}/stream-token
Authorization: Bearer <conversation_token>
```

响应：

```json
{
  "stream_token": "osa_v1...",
  "expires_at": "2026-07-21T12:01:00.000Z"
}
```

Stream token 默认 60 秒过期，只能用于对应会话的 SSE endpoint，不能读取消息或发送消息。

---

### 订阅事件流

```http
GET /v1/client/conversations/{conversation_id}/events?stream_token=osa_v1...
Accept: text/event-stream
```

浏览器 EventSource URL 只携带短期 stream token，不携带 project public key 或 conversation token。服务端发送 heartbeat 和 event id，并按持久化消息游标补拉 worker 写入的结果；SDK/Widget 断流时回退到认证轮询，并换取新 token 重连。

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
Authorization: Bearer <conversation_token>
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

### Slack 入站消息

```http
POST /v1/channel-webhooks/slack?public_key=pk_live_xxx
Content-Type: application/json
X-Slack-Request-Timestamp: 1710000000
X-Slack-Signature: v0=...
```

Slack URL verification payload 会在签名校验通过后回显 challenge：

```json
{
  "type": "url_verification",
  "challenge": "challenge_123"
}
```

响应：

```json
{
  "challenge": "challenge_123"
}
```

Slack Events API message callback 示例：

```json
{
  "type": "event_callback",
  "team_id": "T123",
  "event_id": "Ev123",
  "event": {
    "type": "message",
    "channel": "C123",
    "user": "U123",
    "text": "我怎么取消订阅？",
    "ts": "1710000000.000100",
    "thread_ts": "1710000000.000100"
  }
}
```

响应：

```json
{
  "status": "processed",
  "provider": "slack",
  "webhook_event_id": "webhook_123",
  "conversation_id": "conv_123",
  "message_id": "msg_123"
}
```

处理语义：

- 必须先通过管理端配置 Slack channel `signing_secret`。
- 请求必须带 `X-Slack-Request-Timestamp` 和 `X-Slack-Signature`，签名使用 Slack `v0:{timestamp}:{rawBody}` HMAC-SHA256 规则。
- `type=url_verification` 只回显 challenge，不创建 conversation/message。
- `event.type=message` 会归一化为 OpenSupportAI end-user message。
- 外部 conversation id 为 `team_id:channel:thread_ts`；没有 `thread_ts` 时使用 event `ts`。
- `event_id` 会用于 webhook event 幂等；重复投递已处理事件时不会重复写入 end-user message。
- 从 v0.8 起支持 Slack 入站消息，不包含 Slack 出站回复。

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

### 全局 Runtime Metrics

```http
GET /v1/admin/ops/metrics
Authorization: Bearer <root_admin_token>
```

只允许 root admin token。响应包含组件 readiness snapshot、API uptime、resident memory、heap 使用量、queue 数量/年龄和 worker 新鲜度；不包含租户消息、provider config 或 secret。

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
      "status": "available",
      "capabilities": ["receive_message", "verify_webhook", "test_connection"],
      "configurationKeys": ["signing_secret", "default_channel_id", "default_inbox_id"]
    },
    {
      "provider": "email",
      "name": "Email",
      "status": "stub",
      "capabilities": ["receive_message", "send_message", "test_connection"],
      "configurationKeys": ["imap_host", "smtp_host", "username"]
    }
  ]
}
```

`slack` 从 v0.8 起支持签名后的 Events API 入站消息。`email`、`telegram` 仍是契约 stub，表示协议、能力和配置项已固定，但尚未连接真实 provider API。

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

未配置 Slack signing secret 时 Slack adapter test 会返回 `ok=false`、`status=failed`。Stub provider 会返回 `ok=false`、`status=stub`，不会访问真实第三方平台。

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

### 获取 Slack Channel 配置

```http
GET /v1/admin/projects/{project_id}/channels/slack
```

响应不会返回 signing secret 明文：

```json
{
  "channel": {
    "id": "integration_123",
    "provider": "slack",
    "status": "active",
    "configured": true,
    "metadata": {
      "signing_secret_configured": true,
      "default_channel_id": "C123",
      "default_inbox_id": "inbox_default"
    }
  }
}
```

尚未配置时 `channel` 为 `null`。未配置时 Slack webhook 会返回 forbidden；配置后会校验 Slack request signature。

---

### 配置 Slack Channel

```http
POST /v1/admin/projects/{project_id}/channels/slack
Content-Type: application/json
```

请求：

```json
{
  "signing_secret": "slack_signing_secret_xxx",
  "default_channel_id": "C123",
  "default_inbox_id": "inbox_default",
  "status": "active"
}
```

响应：

```json
{
  "channel": {
    "provider": "slack",
    "status": "active",
    "configured": true,
    "metadata": {
      "signing_secret_configured": true,
      "default_channel_id": "C123",
      "default_inbox_id": "inbox_default"
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
      },
      "metadata": {
        "intent": {
          "keywords": ["订单"],
          "extract": {
            "field": "order_id",
            "pattern": "ORD-\\d{4}-\\d{4}"
          }
        }
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
    "type": "object",
    "required": ["customer_id"],
    "properties": {
      "customer_id": {
        "type": "string"
      }
    }
  },
  "output_schema": {
    "type": "object"
  },
  "metadata": {
    "allowed_hosts": ["api.example.com"],
    "timeout_ms": 3000,
    "max_response_bytes": 65536,
    "intent": {
      "keywords": ["客户"],
      "extract": {
        "field": "customer_id",
        "pattern": "CUS-\\d+"
      }
    },
    "response_path": "data.customer",
    "answer_template": "客户 {customer_id} 当前套餐为 {plan}，状态为 {status}。",
    "auth": {
      "type": "bearer_env",
      "env": "CUSTOMER_API_TOKEN"
    }
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

### OpenAPI 工具执行契约

v0.9 起，`kind=openapi` 且 `status=active` 的工具可以由 orchestrator 自动执行。执行前必须通过用户消息意图匹配和工具安全配置。

支持的字段：

- `method`: 默认 `GET`。非 `GET` 方法必须同时设置 `metadata.allow_mutation=true` 与 `metadata.mutation_approval: { "status": "approved", "approved_by": "...", "approved_at": "ISO-8601" }`。
- `path`: 可以是绝对 URL，也可以是相对路径。相对路径需要 `metadata.base_url`。
- `input_schema.required`: 当前执行器会检查 required 字段是否已从用户消息或 `metadata.default_input` 中取得。
- `metadata.intent.keywords`: 可选字符串数组。存在时，用户消息必须命中至少一个关键词。
- `metadata.intent.extract`: 可选正则抽取配置，形如 `{ "field": "order_id", "pattern": "EXT-\\d{4}-\\d{4}", "flags": "i" }`。若正则有捕获组，使用第一组；否则使用完整匹配。
- `metadata.default_input`: 可选默认输入，会与抽取结果合并，抽取结果优先。
- `metadata.allowed_hosts`: 必填 host allowlist。最终 URL 的 `host` 必须在列表中。
- `metadata.timeout_ms`: 可选请求超时时间，默认 `3000`。
- `metadata.max_response_bytes`: 可选最大响应字节数，默认 `65536`。
- `metadata.response_path`: 可选点号路径，用于从 JSON object 响应中选择子对象。
- `metadata.answer_template`: 可选回复模板，支持 `{field}` 或 `{nested.field}` 占位符，字段来自输入和输出合并对象。
- `metadata.auth`: 可选认证配置。当前支持 `{ "type": "bearer_env", "env": "ENV_NAME" }`，运行时从环境变量读取 token 并注入 `Authorization: Bearer ...`。

所有出站请求只允许 HTTP(S)，拒绝 URL 内嵌凭据、生产环境的私网/保留地址和跨源重定向；DNS 解析结果也会执行地址检查。

执行失败时，API 会记录 `status=failed` 的 tool call 和错误信息，并向用户返回安全失败提示。执行成功时，API 会记录 `status=completed`、输入、输出和耗时。

本地端到端 smoke test：

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
API_URL=http://localhost:4000 pnpm smoke:tools
```

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
      "error": null,
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
  "document": {
    "id": "doc_123",
    "projectId": "proj_123",
    "title": "取消订阅说明",
    "sourceType": "markdown",
    "status": "indexed",
    "contentHash": "sha256_hex",
    "metadata": {
      "locale": "zh-CN",
      "tags": ["billing", "subscription"],
      "chunk_count": 1
    },
    "createdAt": "2026-06-18T10:00:00.000Z",
    "updatedAt": "2026-06-18T10:00:00.000Z"
  }
}
```

---

### 重建知识文档索引

```http
POST /v1/admin/projects/{project_id}/knowledge/documents/{document_id}/reindex
Content-Type: application/json
```

请求：

```json
{
  "run_at": "2026-06-18T10:10:00.000Z"
}
```

`run_at` 可选；省略时立即入队。

响应：

```json
{
  "document": {
    "id": "doc_123",
    "status": "pending",
    "metadata": {
      "last_index_job_id": "job_123",
      "index_requested_at": "2026-06-18T10:00:00.000Z"
    }
  },
  "job": {
    "id": "job_123",
    "type": "knowledge.index",
    "status": "queued",
    "payload": {
      "project_id": "proj_123",
      "document_id": "doc_123"
    }
  }
}
```

Worker 处理 `knowledge.index` 后会将文档标记为 `indexing`，重建全部 chunks，然后标记为 `indexed`；如果原文为空或处理失败，会标记为 `failed` 并写入 `error`。

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
      "sourceType": "markdown",
      "sourceUri": "https://example.com/billing",
      "status": "indexed",
      "contentHash": "sha256_hex",
      "metadata": {
        "chunk_count": 3,
        "indexed_at": "2026-06-18T10:00:00.000Z"
      },
      "createdAt": "2026-06-17T10:00:00.000Z",
      "updatedAt": "2026-06-18T10:00:00.000Z"
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
| `type`   | 可选。当前可执行任务类型为 `knowledge.index`。                  |
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

| 参数       | 说明                                                               |
| ---------- | ------------------------------------------------------------------ |
| `provider` | 可选。例如 `chatwoot`。                                            |
| `status`   | 可选。`received`、`processing`、`processed`、`failed`、`ignored`。 |
| `limit`    | 可选。默认 `50`，最大 `100`。                                      |

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
      "attempts": 1,
      "error": "No local conversation reference",
      "createdAt": "2026-06-18T00:00:00.000Z"
    }
  ]
}
```

---

### Webhook Event Replay 保留接口

```http
POST /v1/admin/projects/{project_id}/webhooks/events/{event_id}/retry
Authorization: Bearer <admin-token-or-api-key>
```

当前响应：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Webhook replay is unavailable until provider-specific replay handlers are implemented",
    "requestId": "req_123"
  }
}
```

状态码为 `501`。该接口在 provider-specific replay handler 和共享处理管线完成前不会创建 async job，避免把 placeholder job 误报为成功重放。失败事件仍可通过列表接口查看。

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
  | { type: "support.error"; code: string; message: string };
```

---

## 治理评测与进化 API

以下 endpoint 需要 root admin token，或具有 `admin:evolution` scope 的项目 API key：

```http
GET    /v1/admin/projects/{project_id}/evaluations/suites
POST   /v1/admin/projects/{project_id}/evaluations/suites
GET    /v1/admin/projects/{project_id}/evaluations/runs
GET    /v1/admin/projects/{project_id}/evaluations/runs/{run_id}
POST   /v1/admin/projects/{project_id}/evaluations/runs
GET    /v1/admin/projects/{project_id}/evolution/proposals
POST   /v1/admin/projects/{project_id}/evolution/proposals
POST   /v1/admin/projects/{project_id}/evolution/proposals/{proposal_id}/transitions
```

创建 suite 时必须提交唯一的 `slug + version`、`evaluator_version=osa-deterministic-v1`、阈值和至少一个 scenario。运行创建接口要求每个 scenario 恰好有一条可信 observation；服务端使用版本化确定性评测器生成断言、总分、通过率和 critical failures。

Run 列表接口只返回 score、pass rate、critical failures 等摘要，不加载 observations；只有单 run 详情接口返回完整 results 和 assertions。

提案只允许从失败 run 创建，`kind` 支持 `knowledge`、`prompt`、`tool`。状态机支持：

```text
draft -> approved -> regression_passed -> canary -> promoted
draft -> rejected
canary -> rolled_back
promoted -> rolled_back
```

`record_regression` 必须引用批准后新建、相同 suite/version 且通过的 run。`start_canary` 必须提交包含 `deployment_ref` 与 `scope` 的 `canary_evidence` 和非空 `rollback_target`。`promote` 要求 `canary_evidence.outcome=passed`。`rollback` 必须提交非空 `rollback_evidence`。

状态冲突、过期 expected-status、复用源运行或不满足门禁时返回 `409`。创建和每次 transition 都会写入 audit log；artifact 正文不会写入审计 metadata。当前 API 只治理证据和状态，不会自动修改生产知识库、提示词或工具。

完整契约和限制见 [GOVERNED_EVOLUTION.zh-CN.md](./GOVERNED_EVOLUTION.zh-CN.md)。

---

## 版本策略

- `/v1` 从 v1.0.0 起进入稳定公共契约。
- Patch/minor 版本不得删除或重命名现有公开响应字段。
- 新字段、endpoint 和事件必须以向后兼容方式添加。
- SDK 每次破坏性改动必须同步更新 protocol 类型。
- Widget 不应依赖未公开的内部 API。
- 破坏性变更必须进入下一个 major 版本，并提供迁移说明。
