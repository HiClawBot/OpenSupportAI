# OpenSupportAI 数据模型 v1.0

## 设计目标

数据模型要支持：

```text
多租户
项目级配置
客服会话
AI 消息
人工转接
知识库 RAG
LLM 调用日志
外部集成
Webhook 幂等
多渠道入站消息
```

---

## 实体关系

```text
Organization
  └── Project
        ├── Inbox
        ├── Contact
        │     └── Conversation
        │             ├── Message
        │             ├── AIRun
        │             └── HandoffSession
        ├── KnowledgeSource
        │     └── KnowledgeDocument
        │             └── KnowledgeChunk
        ├── LLMProvider
        ├── IntegrationConfig
        ├── WebhookEvent
        ├── APIKey
        ├── AsyncJob
        ├── AuditLog
        ├── ToolDefinition
        ├── ToolCall
        └── ConversationInsight
```

---

## organizations

```text
id              string primary key
name            string
created_at      timestamp
updated_at      timestamp
```

---

## projects

```text
id              string primary key
organization_id string references organizations(id)
name            string
public_key      string unique
default_locale  string default 'zh-CN'
created_at      timestamp
updated_at      timestamp
```

索引：

```text
organization_id
public_key unique
```

---

## inboxes

```text
id              string primary key
project_id      string references projects(id)
name            string
handoff_provider string nullable
created_at      timestamp
updated_at      timestamp
```

索引：

```text
project_id
```

---

## contacts

```text
id                string primary key
project_id        string references projects(id)
external_user_id  string nullable
name              string nullable
email             string nullable
avatar_url        string nullable
metadata          jsonb
created_at        timestamp
updated_at        timestamp
```

同一项目内 `external_user_id` 与规范化 email 分别保持唯一；migration 会在增加约束前合并历史重复 contact，并更新 conversation 引用。

索引：

```text
project_id
project_id + external_user_id
project_id + email
```

---

## conversations

```text
id                string primary key
project_id        string references projects(id)
inbox_id          string references inboxes(id)
contact_id        string references contacts(id)
idempotency_key   string nullable
idempotency_hash  string nullable
status            string      -- open / pending_ai / handoff_requested / handed_off / closed
assignee_type     string      -- ai / human / none
last_message_at   timestamp nullable
metadata          jsonb
created_at        timestamp
updated_at        timestamp
```

索引：

```text
project_id
project_id + contact_id
project_id + status
project_id + last_message_at
project_id + idempotency_key unique
```

v0.5 的 generic channel webhook 不新增单独的 channel conversation 表；它在 `conversations.metadata.channel` 中保存，并在 v0.5.1 的管理端 conversation list/detail 响应中直接暴露摘要字段：

```json
{
  "provider": "generic_webhook",
  "externalConversationId": "external_thread_123",
  "externalEventId": "evt_123",
  "externalUserId": "external_user_123",
  "inboxId": "inbox_default",
  "receivedAt": "2026-06-18T00:00:00.000Z"
}
```

后续相同 `provider + externalConversationId` 的 webhook 会复用该 conversation。

---

## messages

```text
id                string primary key
sequence          bigint unique, database generated
conversation_id   string references conversations(id)
project_id        string references projects(id)
idempotency_key   string nullable
idempotency_hash  string nullable
role              string      -- end_user / ai_agent / human_agent / system / tool
visibility        string      -- public / internal_note / debug_trace
content_type      string      -- text / rich_text / file / event
content           jsonb
source_refs       jsonb nullable
metadata          jsonb
created_at        timestamp
```

索引：

```text
project_id
conversation_id + sequence
conversation_id + idempotency_key unique
project_id + created_at
```

注意：`messages` 冗余 `project_id`，用于快速过滤和防跨租户查询。

---

## knowledge_sources

```text
id                string primary key
project_id        string references projects(id)
type              string      -- manual / url / sitemap / upload
name              string
config            jsonb
created_at        timestamp
updated_at        timestamp
```

索引：

```text
project_id
```

---

## knowledge_documents

```text
id                string primary key
project_id        string references projects(id)
source_id         string nullable references knowledge_sources(id)
title             string
source_type       string      -- markdown / text / url / pdf
source_uri        string nullable
content           text        -- v0.7 起保存原文，用于 worker reindex
status            string      -- pending / indexing / indexed / failed
content_hash      string nullable
metadata          jsonb
error             text nullable
created_at        timestamp
updated_at        timestamp
```

索引：

```text
project_id + status
project_id + content_hash
source_id
```

---

## knowledge_chunks

```text
id                string primary key
project_id        string references projects(id)
document_id       string references knowledge_documents(id)
chunk_index       integer
content           text
embedding         vector
 token_count       integer nullable
metadata          jsonb
created_at        timestamp
```

索引：

```text
project_id
document_id
project_id + document_id
vector index on embedding
```

注意：向量维度取决于 embedding model。实现时应将维度作为配置或 migration 决策。

---

## llm_providers

```text
id                string primary key
project_id        string references projects(id)
provider          string      -- openai_compatible
base_url          string
model             string
embedding_model   string nullable
api_key_encrypted text
status            string      -- active / disabled
metadata          jsonb
created_at        timestamp
updated_at        timestamp
```

索引：

```text
project_id
project_id + status
```

---

## ai_runs

```text
id                  string primary key
project_id          string references projects(id)
conversation_id     string references conversations(id)
message_id          string nullable references messages(id)
provider            string
model               string
prompt_version      string
input_tokens        integer nullable
output_tokens       integer nullable
latency_ms          integer nullable
retrieved_chunk_ids jsonb
confidence          float nullable
status              string      -- success / failed / skipped / handoff
error               text nullable
metadata            jsonb
created_at          timestamp
```

索引：

```text
project_id + created_at
conversation_id + created_at
message_id
status
```

---

## handoff_sessions

```text
id                        string primary key
project_id                string references projects(id)
conversation_id           string references conversations(id)
provider                  string      -- chatwoot / tiledesk / zammad / webhook
external_contact_id       string nullable
external_conversation_id  string nullable
status                    string      -- requested / active / closed / failed
reason                    string nullable
metadata                  jsonb
created_at                timestamp
updated_at                timestamp
```

索引：

```text
project_id
conversation_id
project_id + provider + external_conversation_id unique
```

---

## integration_configs

```text
id                string primary key
project_id        string references projects(id)
provider          string      -- chatwoot 等需要持久配置的 provider
status            string      -- active / disabled
config_encrypted  text
metadata          jsonb
created_at        timestamp
updated_at        timestamp
```

索引：

```text
project_id + provider unique
```

---

## webhook_events

```text
id                 string primary key
project_id         string references projects(id)
provider           string
external_event_id  string nullable
payload            jsonb
status             string      -- received / processing / processed / failed / ignored
processing_started_at timestamp nullable
attempts           integer default 0
error              text nullable
created_at         timestamp
processed_at       timestamp nullable
```

v0.5 generic channel webhook 使用 `provider=generic_webhook` 记录入站事件。v0.5.1 将幂等键收敛为项目级 `project_id + provider + external_event_id`，避免不同项目间的外部事件 ID 冲突。v0.8 起 Slack Events API 入站消息使用 `provider=slack` 记录 webhook event。Email/Telegram 当前仍是 adapter 契约 stub。

索引：

```text
project_id + provider
project_id + provider + external_event_id unique
status + created_at
```

---

## async_jobs

```text
id                 string primary key
project_id         string references projects(id)
type               string
deduplication_key  string nullable
status             string      -- queued / running / completed / failed / cancelled
payload            jsonb
result             jsonb nullable
attempts           integer default 0
max_attempts       integer default 3
run_at              timestamp
locked_by          string nullable
locked_at          timestamp nullable
lease_expires_at   timestamp nullable
error              text nullable
created_at         timestamp
updated_at         timestamp
```

Worker 通过 `FOR UPDATE SKIP LOCKED` 原子领取任务。运行中的任务必须由当前 `locked_by` owner 续租、完成或失败；过期租约可被重新领取，已耗尽最大尝试次数的任务会进入 `failed`。

`answer.generate` 使用 `message:{source_message_id}` 作为去重键。用户消息、canonical job payload 与任务记录在同一个事务中提交；最终 AI message 使用源消息派生的幂等键，保证任务重试不会重复回答。

索引：

```text
project_id + status
status + run_at
type + status
project_id + type + deduplication_key unique
```

---

## worker_heartbeats

```text
worker_id       string primary key
status          string      -- ready / draining / stopped
job_types       jsonb
current_job_id  string nullable
started_at      timestamp
last_seen_at    timestamp
metadata        jsonb
```

`worker_id` 是部署实例的稳定标识。生产 readiness 要求至少一个未过期的 `ready` worker，并且其 `job_types` 同时包含 `answer.generate` 与 `knowledge.index`。`current_job_id` 只用于日志与运行关联，不建立外键；该表不保存消息正文、provider 配置或 secret。

索引：

```text
status + last_seen_at
```

---

## tool_definitions

```text
id              string primary key
project_id      string references projects(id)
slug            string
name            string
description     string
kind            string      -- demo / openapi
status          string      -- active / disabled
method          string nullable
path            string nullable
input_schema    jsonb
output_schema   jsonb
metadata        jsonb
created_at      timestamp
updated_at      timestamp
```

v1.0 中 `kind=openapi` tool 的 `metadata` 支持：

```text
base_url
allowed_hosts
timeout_ms
max_response_bytes
intent.keywords
intent.extract
default_input
response_path
answer_template
auth.type=bearer_env
auth.env
allow_mutation
```

生产环境中，tool token 应通过 `auth.env` 指向环境变量，不应明文写入 `metadata`。

索引：

```text
project_id + slug unique
project_id + status
```

---

## tool_calls

```text
id                string primary key
project_id        string references projects(id)
conversation_id   string nullable references conversations(id)
message_id        string nullable references messages(id)
tool_id           string nullable references tool_definitions(id)
tool_slug         string
status            string      -- completed / failed / skipped
input             jsonb
output            jsonb nullable
error             text nullable
latency_ms        int nullable
created_at        timestamp
```

索引：

```text
project_id + created_at
conversation_id + created_at
tool_slug + created_at
```

---

## conversation_insights

```text
id                 string primary key
project_id         string references projects(id)
conversation_id    string unique references conversations(id)
summary            text
suggested_replies  jsonb
tags               jsonb
metadata           jsonb
created_at         timestamp
updated_at         timestamp
```

索引：

```text
conversation_id unique
project_id + updated_at
```

---

## api_keys

```text
id                string primary key
project_id        string nullable references projects(id)
organization_id   string nullable references organizations(id)
name              string
key_hash          string unique
scopes            jsonb
last_used_at      timestamp nullable
created_at        timestamp
revoked_at        timestamp nullable
```

索引：

```text
key_hash unique
project_id
organization_id
```

---

## 治理评测模型

### evaluation_suites

保存按项目隔离、版本不可变的评测定义。`project_id + slug + version` 唯一；`thresholds` 保存最低分、最低通过率和关键场景必须通过开关；`evaluator_version` 固定评测语义。

### evaluation_scenarios

保存 suite 内有序场景，包括 `category`、`critical`、`input` 与 `expectations`。`suite_id + slug` 唯一，且 suite 关系同时使用 `project_id` 约束，防止跨租户关联。

### evaluation_runs

保存一次完整运行的 suite version、evaluator version、阈值快照、状态、总分、通过率、通过/失败数量、关键失败和 summary。Run 创建后作为发布证据使用，不提供更新接口。

### evaluation_results

保存每个 scenario 的确定性结果，包括 `status`、`score`、`outcome`、`assertions`、`observed` 和可选 `error`。`run_id + scenario_slug` 唯一。

### evolution_proposals

保存从失败 run 创建的 `knowledge|prompt|tool` 提案。主要字段：

```text
project_id
source_run_id
regression_run_id nullable
kind
status
title
rationale
artifact
artifact_hash
baseline
canary_evidence nullable
rollback_target nullable
review_note nullable
created_by / reviewed_by
reviewed_at / promoted_at / rolled_back_at
created_at / updated_at
```

`artifact_hash` 是规范化 artifact 的 SHA-256，用于不可变证据识别。状态更新使用当前状态 fencing；`source_run` 与 `regression_run` 都通过 `project_id` 复合关系约束。提案记录本身不会修改知识库、LLM 配置或 tool definition。

---

## 枚举建议

### ConversationStatus

```text
open
pending_ai
handoff_requested
handed_off
closed
```

### MessageRole

```text
end_user
ai_agent
human_agent
system
tool
```

### MessageVisibility

```text
public
internal_note
debug_trace
```

### DocumentStatus

```text
pending
indexing
indexed
failed
```

### HandoffStatus

```text
requested
active
closed
failed
```

---

## 安全注意事项

- Conversation 的 inbox/contact 必须与 conversation 属于同一 project。
- Message 和 handoff session 的 `project_id` 必须与其 conversation 一致。
- 外部 handoff conversation ID 仅在 `project_id + provider` 范围内唯一。

1. `project_id` 应冗余写入消息、chunk、ai_runs、handoff_sessions，减少跨表查询时的安全漏洞。
2. 外部集成配置必须加密存储。
3. API key 只保存 hash，不保存明文。
4. LLM 调用日志不能默认保存完整 prompt，除非管理员显式开启 debug。
5. debug_trace 不应返回给 end user。
