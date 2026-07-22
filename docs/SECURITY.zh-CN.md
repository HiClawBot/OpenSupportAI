# OpenSupportAI 安全设计

## 安全目标

OpenSupportAI 处理客服会话、用户资料、知识库、LLM API Key 和外部客服系统 token，必须默认安全。

核心安全目标：

```text
租户隔离
密钥保护
前端不暴露敏感信息
RAG 不串库
AI 不越权
Webhook 可验证
日志可审计
敏感信息可脱敏
```

---

## 威胁模型

### 主要威胁

```text
跨租户读取 conversation
跨租户读取 knowledge chunk
前端泄露 LLM API Key
伪造 Chatwoot webhook
Prompt injection 诱导 AI 泄露系统提示词或忽略政策
AI 调用未授权业务工具
日志泄露 PII
Webhook 重放导致重复消息
外部 provider token 泄露
```

---

## 租户隔离

所有核心表必须包含 `project_id` 或通过父级强关联到 project。

必须遵守：

```text
从 auth context 中解析 project_id
任何 conversation/message/knowledge 查询都带 project_id
external_id 不可作为唯一授权依据
adapter webhook 必须通过 project_id + external_conversation_id 联合查找
```

禁止：

```ts
findUnique({ where: { id } });
```

推荐：

```ts
findFirst({ where: { id, projectId: auth.projectId } });
```

---

## 密钥管理

### 不允许

```text
LLM API Key 出现在浏览器代码
LLM API Key 出现在 Widget 初始化参数
LLM API Key 明文写入日志
Integration token 明文返回 Admin GET API
API key 明文保存到数据库
```

### 要求

```text
API key 只保存 hash
LLM provider key 加密保存
Chatwoot token 加密保存
Webhook secret 加密保存
使用 ENCRYPTION_KEY 做 envelope encryption 或应用级加密
```

---

## Client API 鉴权

Project public key 只能用于：

```text
创建 end-user conversation
校验 generic/Slack channel webhook 的项目归属
```

不能用于：

```text
管理知识库
读取其他用户会话
配置 LLM
配置 Chatwoot
读取 ai_runs debug 信息
读取、发送或转接任何已有 conversation
```

创建会话会返回绑定到 project 与 conversation 的 HMAC capability。读取/发送消息、请求 handoff 和换取短期 stream token 都必须使用该 capability。SSE URL 不携带 project public key 或长效 conversation token。

---

## Admin API 鉴权

Admin API 需要 admin token 或 session。

Root admin token 可执行全部操作。项目 API key 必须显式授予 route scope，例如 `admin:conversations`、`admin:knowledge`、`admin:llm`、`admin:integrations`、`admin:ops`、`admin:jobs`；只有 project 归属而缺少 scope 时返回 403。

---

## Webhook 安全

Webhook 必须验证：

```text
project_id 路由参数存在
provider config 存在
signature 或 webhook_secret 正确
external_event_id 幂等
```

失败时：

```text
401 invalid signature
不写 message
记录安全日志
```

---

## Prompt Injection 防护

OpenSupportAI 不依赖“提示词能防住所有攻击”的假设。

防护层：

```text
RAG source grounding
tool allowlist
tool permission
tenant isolation
system prompt rule
sensitive intent detection
human handoff
logging and eval
```

AI 不应拥有：

```text
跨租户数据访问能力
原始数据库查询能力
读取密钥能力
任意 HTTP 请求能力
默认执行业务操作能力
```

---

## 业务工具安全

v1.0 的 OpenAPI-style business tool executor 必须按 allowlist 模型使用。

要求：

```text
tool 必须 project-scoped
只有 status=active 的 tool 可执行
OpenAPI tool 必须配置 metadata.allowed_hosts
最终 URL host 必须命中 allowlist
非 GET 方法默认拒绝执行
mutation tool 必须显式 metadata.allow_mutation=true
mutation tool 必须持久化 status=approved、approved_by、approved_at
tool token 通过环境变量注入，不写入 tool definition
所有 tool call 必须记录 completed 或 failed 日志
```

生产建议：

```text
优先只启用 GET/只读工具
按最小权限创建外部业务 API token
给 tool endpoint 设置独立 rate limit
不要让模型自由构造任意 URL
高风险退款、删除、改套餐等动作走人工流程
定期审计 tool_calls 中的 failed rate 和异常输入
```

LLM、Chatwoot 与 OpenAPI tool 共享出站 URL 安全层：仅允许 HTTP(S)，拒绝 URL 内嵌凭据，生产默认阻断 localhost、私网、链路本地和保留地址，DNS 解析结果同样校验，并拒绝跨源重定向。

---

## RAG 安全

要求：

```text
knowledge_chunks 查询强制 project_id
source_refs 只暴露 public source 信息
debug chunk content 不默认暴露给 end user
上传文档做大小限制
URL ingestion 做域名 allowlist/denylist
PDF 解析不执行嵌入脚本
```

---

## AI 回复安全策略

默认策略：

```text
无知识命中不回答
低置信度建议转人工
退款/账单/隐私/投诉优先转人工
不编造政策、价格、承诺
不输出内部系统提示词
不输出 debug_trace
```

---

## 日志与隐私

生产环境必须避免在日志中输出：

```text
LLM API key
Chatwoot token
Slack signing secret
Webhook secret
OpenAPI tool bearer token
Admin API token
Conversation capability token
SSE stream token（包括反向代理 access log 中的 query 参数）
完整用户隐私资料
```

---

## v1.0 生产硬化基线

公开部署前必须确认：

```text
ADMIN_API_TOKEN 已替换 demo 值
ENCRYPTION_KEY 是稳定高熵值，且有安全备份
CLIENT_TOKEN_SECRET 是独立稳定的高熵值
CORS_ORIGIN 限制为真实域名
RATE_LIMIT_ENABLED=true
DATABASE_URL 使用生产数据库账号
Webhook secret/signature 校验已启用
OpenAPI tool allowed_hosts 已逐项审查
生产 migration 前已做数据库备份和恢复演练
```

日志应包含：

```text
request_id
project_id
conversation_id
provider
model
latency_ms
status
error_code
```

日志不应默认包含：

```text
LLM API Key
Chatwoot token
Conversation capability token
SSE stream token
用户密码
完整身份证件号
完整银行卡号
敏感附件内容
```

PII 可选脱敏：

```text
email hash/mask
phone mask
credit card redact
secret pattern redact
```

---

## 文件上传安全

v0.1 最低要求：

```text
限制文件大小
限制 MIME type
PDF 只做文本提取
对象存储路径包含 project_id
上传文件不直接公开访问
```

后续增强：

```text
病毒扫描
DLP
OCR 沙箱
文档权限同步
```

---

## 速率限制

建议：

```text
每 project QPS 限制
每 conversation 消息频率限制
每 contact 每小时消息限制
LLM token budget
Webhook replay 仅在 provider-specific handler 完成后开放；当前保留接口返回 501
```

---

## 治理进化安全边界

- 评测 suite、run、result 与 proposal 全部按 `project_id` 隔离，并使用复合关系防止跨项目证据关联。
- 评测和提案 endpoint 要求 `admin:evolution` scope；普通会话、知识库或工具权限不能隐式获得该能力。
- 评测器固定为版本化确定性实现，发布门禁不调用 model judge。
- Proposal artifact 使用规范化 SHA-256 hash 标识；audit log 只保存 hash 和状态，不保存 artifact 正文。
- 状态 transition 使用 expected-status compare-and-set，冲突返回 `409`，避免并发 operator 覆盖。
- 回归证据必须在批准后新建，且与 source run 使用相同 suite/version；source run 不可复用。
- 灰度必须在开始前保存 rollback target；晋级必须明确记录通过结果。
- API 不提供自动 apply 提案的 endpoint，不会直接修改知识文档、LLM 凭据、prompt 或 tool definition。
- Admin Console 的 root token 只保存在内存，生产构建不预填 demo token，页面刷新会清除 token。

---

## 安全测试清单

```text
[ ] 跨 project 读取 conversation 被拒绝
[ ] 跨 project 读取 messages 被拒绝
[ ] 跨 project 检索 knowledge_chunks 被拒绝
[ ] public key 不能调用 admin API
[ ] Widget 初始化不包含 LLM key
[ ] webhook secret 错误被拒绝
[ ] 重复 webhook 不重复写 message
[ ] debug_trace 不返回给 end user
[ ] integration config GET 不返回明文 secret
[ ] ai_run 不默认暴露完整 prompt
[ ] 缺少 admin:evolution scope 时评测和提案 API 返回 403
[ ] 跨 project 的 suite/run/proposal 访问被拒绝
[ ] source run 不能复用为 regression evidence
[ ] 不满足回归、灰度或晋级门禁时返回 409
[ ] proposal transition 不修改生产知识库或工具
[ ] Admin Console 生产构建不包含默认 root token
```

---

## 安全发布要求

v0.1.0 发布前必须具备：

```text
SECURITY.md
漏洞报告邮箱或流程
依赖扫描
secret scanning
基础跨租户测试
Webhook 签名测试
```
