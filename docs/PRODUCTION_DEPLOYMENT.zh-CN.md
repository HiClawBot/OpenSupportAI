# OpenSupportAI v1.0 生产部署指南

本文给出 v1.0 自托管生产部署基线。Docker Compose 适合本地演示和小规模验证；真正生产环境建议使用托管 PostgreSQL、独立反向代理、独立日志/监控和可恢复备份。

## 推荐拓扑

```text
Browser / Widget / Admin Console
        ↓ HTTPS
Reverse Proxy / Load Balancer
        ↓
OpenSupportAI API
        ↕
PostgreSQL + pgvector ← Worker

External:
LLM Provider
Chatwoot
Slack Events API
OpenAPI business tool endpoints
```

## 必需环境变量

API：

```env
NODE_ENV=production
PORT=4000
OPENSUPPORTAI_STORAGE=prisma
ANSWER_EXECUTION_MODE=worker
DATABASE_URL=postgresql://...
ADMIN_API_TOKEN=replace_with_high_entropy_secret
ENCRYPTION_KEY=replace_with_stable_high_entropy_key
CLIENT_TOKEN_SECRET=replace_with_independent_high_entropy_secret
CORS_ORIGIN=https://support-admin.example.com
CONVERSATION_TOKEN_TTL_SECONDS=604800
STREAM_TOKEN_TTL_SECONDS=60
SSE_HEARTBEAT_MS=15000
SSE_DATABASE_POLL_MS=1000
ALLOW_PRIVATE_OUTBOUND=false
MAX_CONCURRENT_ANSWERS_PER_PROJECT=4
LLM_TIMEOUT_MS=45000
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

Worker：

```env
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=replace_with_stable_high_entropy_key
ALLOW_PRIVATE_OUTBOUND=false
MAX_CONCURRENT_ANSWERS_PER_PROJECT=4
LLM_TIMEOUT_MS=45000
WORKER_ID=worker-production-1
WORKER_POLL_INTERVAL_MS=5000
WORKER_RETRY_DELAY_MS=30000
WORKER_LEASE_MS=60000
WORKER_JOB_TYPES=answer.generate,knowledge.index
```

普通入站消息与 `answer.generate` job 在同一个 PostgreSQL 事务中提交。API 返回 `status=accepted` 后，worker 执行 RAG、工具和 LLM 编排，并用源消息派生的幂等键写入唯一最终回答。API 的 SSE 连接按 `SSE_DATABASE_POLL_MS` 补拉持久化消息，因此 API 与 worker 不需要共享进程内事件总线。

`WORKER_LEASE_MS` 必须大于常规 job handler 的 heartbeat 间隔；worker 每约三分之一租约周期续租。`MAX_CONCURRENT_ANSWERS_PER_PROJECT` 用于限制单个 worker 进程中同一项目的回答生成槽位。需要跨多个 worker 实例的全局并发配额时，应在上线前增加数据库级配额控制；当前 Beta 基线建议单 worker 实例。

Admin Console / Demo App：

```env
VITE_API_URL=https://api.example.com
```

可选集成：

```env
CHATWOOT_BASE_URL=https://chatwoot.example.com
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_INBOX_ID=1
CHATWOOT_API_ACCESS_TOKEN=replace_me
CHATWOOT_WEBHOOK_SECRET=replace_me
```

OpenAPI business tool token 不应写入 tool definition。使用 `metadata.auth = { "type": "bearer_env", "env": "ENV_NAME" }`，并在 API 运行环境注入对应环境变量。

## 部署步骤

1. 准备 PostgreSQL，并启用 pgvector 扩展能力。
2. 设置生产 `.env`，尤其是 `DATABASE_URL`、`ADMIN_API_TOKEN`、`ENCRYPTION_KEY`、`CLIENT_TOKEN_SECRET`、`CORS_ORIGIN`。
3. 安装依赖并生成 Prisma client：

```bash
pnpm install
pnpm exec prisma validate
pnpm db:generate
```

4. 执行数据库 migration：

```bash
pnpm db:migrate
```

5. 构建服务：

```bash
pnpm build
```

6. 启动 API、worker、admin console；确认 worker 同时监听 `answer.generate` 与 `knowledge.index`。
7. 通过反向代理暴露 API 和 Admin Console，强制 HTTPS。
8. 运行发布验证脚本和关键业务路径验证。

## 反向代理要求

- 强制 HTTPS。
- 只允许可信域名访问 Admin Console。
- 对 `/v1/client/*` 和 `/v1/channel-webhooks/*` 保留请求 body。
- 对 Slack webhook 保留原始 JSON body 语义；当前实现覆盖标准 JSON callback，本地 smoke 已验证签名路径。
- 设置合理 body size limit，避免大 payload 冲击 API。
- 透传 `x-forwarded-for`、`x-forwarded-proto` 等常规代理头。

## 数据库与备份

最低要求：

- 每日全量备份。
- 高频 WAL 或增量备份，视 SLA 调整。
- 定期恢复演练。
- migration 前创建快照。
- 监控连接数、慢查询、磁盘空间和 autovacuum。

升级前必须先在 staging 环境恢复生产备份并执行 `pnpm db:migrate`。

## 安全硬化

- `ADMIN_API_TOKEN` 使用高熵随机值，不复用 demo token。
- `ENCRYPTION_KEY` 使用稳定高熵值，部署后不得随意更换。
- `CLIENT_TOKEN_SECRET` 使用独立、至少 32 字符的高熵值，不与 admin 或 encryption key 复用。
- `CORS_ORIGIN` 限制为真实前端域名。
- 反向代理和 APM 必须从 access log、trace URL 与 error report 中过滤 `stream_token` query 参数；API 自身日志已做脱敏。
- `RATE_LIMIT_ENABLED=true`。
- LLM API key、Chatwoot token、Slack signing secret 和 tool token 只存在服务端。
- 项目级 admin API key 定期轮换，撤销不再使用的 key。
- Webhook secret/signature 校验必须开启。
- `ALLOW_PRIVATE_OUTBOUND=false`，除非 Chatwoot 或内部工具确实部署在受控私网中并完成风险评审。
- OpenAPI tools 必须配置 `allowed_hosts`；mutation 工具还必须有持久化 operator approval 记录。
- `answer.generate` worker 当前只允许 `GET` 工具。即使已有 operator approval，非 `GET` 工具也会安全失败，避免租约重试重复远端副作用；生产 Beta 的 mutation 应走人工流程。
- 高风险退款、删除或改套餐操作仍应通过人工流程处理。

## 观测与运维

v1.0 提供基础运维 API：

```text
GET /v1/admin/projects/{project_id}/ops/health
GET /v1/admin/projects/{project_id}/audit-log
GET /v1/admin/projects/{project_id}/jobs
GET /v1/admin/projects/{project_id}/webhooks/events
GET /v1/admin/projects/{project_id}/tool-calls
```

建议接入：

- API access log。
- Worker job success/failure metrics。
- `answer.generate` queue age、attempts 和端到端回答延迟。
- Webhook failed event alert。
- Handoff failed session alert。
- LLM provider error/latency alert。
- Tool-call failed rate alert。

## 发布验证

每次生产发布前至少执行：

```bash
pnpm exec prisma validate
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:memory -- --help
pnpm smoke:chatwoot -- --help
pnpm smoke:channels -- --help
pnpm smoke:tools -- --help
```

在 staging 内存模式或临时环境执行：

```bash
API_URL=http://localhost:4000 pnpm smoke:memory
API_URL=http://localhost:4000 pnpm smoke:channels
API_URL=http://localhost:4000 pnpm smoke:tools
```

真实 Chatwoot 环境准备好后执行：

```bash
pnpm smoke:chatwoot
```

## 不建议的生产做法

- 使用 `admin_demo_key`。
- 在浏览器或 Widget 初始化参数中放 LLM/API/tool secret。
- 关闭 webhook signature/secret 校验。
- 给 OpenAPI tool 配置宽泛 host allowlist。
- 直接在生产启用未经审核的非 `GET` tool。
- 没有备份和恢复演练就执行 migration。
