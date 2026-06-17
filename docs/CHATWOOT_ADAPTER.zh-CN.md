# Chatwoot Adapter 设计

## 目标

Chatwoot Adapter 负责在 OpenSupportAI 和 Chatwoot 之间同步人工转接会话。

OpenSupportAI 核心不依赖 Chatwoot 数据模型，只依赖统一 Handoff Adapter 接口。

---

## v0.1 能力

```text
配置 Chatwoot base_url/account_id/inbox_id/token
测试 Chatwoot account/inbox 连接
创建或更新 Chatwoot contact
创建 Chatwoot conversation
推送会话摘要和历史消息
接收 Chatwoot webhook
将坐席回复写回 OpenSupportAI messages
同步 Chatwoot conversation status
失败 handoff 可在管理台重试
通过 SSE 推给 Widget
```

---

## Adapter 接口

```ts
export interface HandoffAdapter {
  provider: string;

  testConnection(): Promise<{
    ok: boolean;
    accountId: string;
    inboxId: string;
    inboxName?: string;
  }>;

  createOrUpdateContact(input: { projectId: string; contactId: string }): Promise<{
    externalContactId: string;
    externalContactSourceId?: string;
  }>;

  createConversation(input: {
    projectId: string;
    conversationId: string;
    externalContactId: string;
    externalContactSourceId?: string;
    summary?: string;
  }): Promise<{
    externalConversationId: string;
  }>;

  pushMessage(input: {
    projectId: string;
    externalConversationId: string;
    message: {
      role: "end_user" | "ai_agent" | "system";
      text: string;
    };
  }): Promise<void>;

  handleWebhook(input: {
    projectId: string;
    headers: Record<string, string>;
    payload: unknown;
  }): Promise<void>;
}
```

---

## 配置模型

`integration_configs` 中保存：

```json
{
  "base_url": "https://chatwoot.example.com",
  "account_id": "1",
  "inbox_id": "2",
  "api_access_token": "encrypted",
  "webhook_secret": "encrypted"
}
```

要求：

```text
api_access_token 加密保存
webhook_secret 加密保存
GET API 不返回明文
```

---

## 转人工流程

```text
1. 用户点击转人工或 AI 低置信度触发。
2. OpenSupportAI 创建 handoff_session(status=requested)。
3. Adapter 读取 Chatwoot 配置。
4. Adapter 创建/更新 Chatwoot contact，并读取 `contact_inboxes[].source_id`。
5. Adapter 用 `source_id` 创建 Chatwoot conversation。
6. Adapter 推送会话摘要、历史消息和当前问题。
7. OpenSupportAI 保存 external_contact_id 和 external_conversation_id。
8. conversation.status = handed_off。
9. SSE 广播 handoff.requested。
```

### 连接测试

管理台调用：

```http
POST /v1/admin/projects/{project_id}/integrations/chatwoot/test
```

服务端使用 Chatwoot Application API：

```http
GET /api/v1/accounts/{account_id}/inboxes
```

测试成功后，`integration_configs.metadata` 会记录：

```json
{
  "last_tested_at": "iso-time",
  "last_test_ok": true,
  "last_test_inbox_name": "Support"
}
```

失败时记录 `last_test_ok=false` 和 `last_test_error`。

---

## 推送到 Chatwoot 的内容

### 系统摘要

```text
OpenSupportAI 转人工摘要

用户：张三 <zhangsan@example.com>
页面：https://app.example.com/billing
转接原因：user_requested

AI 已尝试回答：
- 用户询问如何取消订阅
- AI 根据“取消订阅说明”给出步骤

最近消息：
用户：我要找人工
```

### 历史消息

v0.1 可推送最近 N 条公开消息。

```text
end_user
ai_agent
end_user
```

不要推送 debug_trace。

## Chatwoot API Channel 注意事项

Chatwoot Application API 创建 conversation 时需要 `source_id`、`inbox_id` 和 `contact_id`。

`source_id` 不是 OpenSupportAI 本地 conversation id，而是 Chatwoot contact 在某个 inbox 下的 session identifier。创建 contact 后，Chatwoot 会在响应的 `contact_inboxes[].source_id` 中返回这个值。OpenSupportAI 会优先使用该值创建 Chatwoot conversation；如果旧版响应没有返回 `source_id`，adapter 会回退到本地 conversation id。

---

## Webhook 回流

Chatwoot Webhook 请求到：

```http
POST /v1/webhooks/chatwoot/{project_id}
```

处理步骤：

```text
1. 校验 webhook secret。
2. 获取 external_event_id。
3. 写入 webhook_events。
4. 如果重复事件，直接返回 200。
5. 解析 external_conversation_id。
6. 找到 handoff_session。
7. 判断是否为坐席公开回复。
8. 写入 messages(role=human_agent, visibility=public)。
9. 广播 human.message.created。
```

### 状态同步

OpenSupportAI 处理 Chatwoot `conversation_status_changed` webhook。

映射规则：

```text
Chatwoot resolved -> OpenSupportAI closed
Chatwoot open     -> OpenSupportAI handed_off
Chatwoot pending  -> OpenSupportAI handed_off
Chatwoot snoozed  -> OpenSupportAI handed_off
```

同步成功后：

```text
conversation.status 更新
handoff_session.status 更新为 active 或 closed
handoff_session.metadata.chatwoot_status 记录原始状态
广播 conversation.status_changed
```

---

## 幂等设计

必须有唯一约束：

```text
webhook_events(provider, external_event_id)
handoff_sessions(provider, external_conversation_id)
```

对于没有 external_event_id 的 webhook，可以计算 payload hash。

---

## 错误处理

### Chatwoot API 失败

```text
记录 handoff_session.status=failed
记录错误到 metadata/error
向 Widget 发送 error event
保留 conversation.status=open 或 handoff_requested
```

### Handoff 重试

管理台会显示当前会话的 `handoff_sessions`。当 Chatwoot handoff 为 `failed` 或 `requested` 时，管理员可以调用：

```http
POST /v1/admin/projects/{project_id}/handoffs/{handoff_id}/retry
```

重试会复用已有 handoff session。若失败时已经保存了 `external_contact_id` 或 `external_conversation_id`，重试会优先复用这些外部 ID，避免重复创建 Chatwoot conversation。

### Webhook 校验失败

```text
返回 401
不写 messages
可写安全日志
```

### 找不到 handoff_session

```text
webhook_events.status=ignored
返回 200
```

---

## 测试用例

```text
createOrUpdateContact 成功
testConnection 成功
createConversation 成功
pushMessage 成功
requestHandoff 完整流程成功
failed handoff retry 成功
webhook secret 错误被拒绝
重复 webhook 不重复写 message
坐席公开回复写入 human_agent message
conversation_status_changed 同步 closed/handed_off
非公开 note 不展示给 end user
跨 project external_conversation_id 不能串库
```

---

## 后续增强

```text
同步 Chatwoot assignee
同步 tags
同步 attachments
支持 private note
支持多 inbox route
支持 Chatwoot contact custom attributes
支持 AI suggested reply to agent
```
