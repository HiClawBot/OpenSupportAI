# OpenSupportAI v1.0 升级指南

本文面向已经运行 v0.5.x 至 v0.9.x 的自托管实例。v1.0.0 不引入刻意破坏性变更；它主要冻结公共契约、补齐生产部署文档并升级版本线。

## 推荐升级路径

从任意 v0.5.x 或更高版本升级到 v1.0.0：

```bash
git fetch --tags origin
git checkout v1.0.0
pnpm install
pnpm exec prisma validate
pnpm db:generate
pnpm db:migrate
pnpm build
```

生产环境建议先在 staging 环境恢复一份数据库备份并完成同样流程。

## 升级前检查

- 备份 PostgreSQL 数据库。
- 备份 `.env`、部署 manifest 和反向代理配置。
- 确认 `ENCRYPTION_KEY` 没有丢失或变化；它用于解密 LLM、Chatwoot、webhook secret 等配置。
- 确认 `ADMIN_API_TOKEN` 已替换为高熵随机值。
- 配置独立的高熵 `CLIENT_TOKEN_SECRET`；不要与 admin token 或 encryption key 复用。
- 确认 `CORS_ORIGIN` 已限制为真实前端域名。
- 确认 `RATE_LIMIT_ENABLED=true`，并根据业务流量设置 `RATE_LIMIT_WINDOW_MS` 和 `RATE_LIMIT_MAX`。
- 如果使用 Slack inbound，确认 signing secret 已配置并只在服务端保存。
- 如果使用 OpenAPI business tools，确认每个 active tool 都配置了 `metadata.allowed_hosts`，工具 token 通过环境变量注入。

## 版本差异摘要

### 从 v0.9.x 到 v1.0.0

- 无刻意破坏性 API 变更。
- `/v1` REST API、SDK、Widget 初始化参数和 adapter 契约进入稳定策略。
- 新增公共契约、升级、生产部署和安全硬化文档。
- Workspace package versions 升级到 `1.0.0`。

### 从 v0.8.x 到 v1.0.0

- v0.9.0 新增 OpenAPI-style business tool executor。
- Active `kind=openapi` tool 可以通过 metadata intent 匹配用户消息并执行 allowlist HTTP 请求。
- 非 `GET` tool 默认阻断，除非显式配置 `metadata.allow_mutation=true` 和完整 `metadata.mutation_approval`。
- 新增 `pnpm smoke:tools`。

### 从 v0.7.x 到 v1.0.0

- v0.8.0 新增 Slack inbound Events API adapter。
- 可通过 admin API/Admin Console 配置 Slack signing secret、default channel、default inbox 和 status。
- `pnpm smoke:channels` 覆盖 generic webhook 和 signed Slack callback。

### 从 v0.6.x 到 v1.0.0

- v0.7.0 新增 knowledge document 原文/content hash 持久化和真实 `knowledge.index` worker handler。
- Reindex 会创建 async job，并由 worker 重建 chunks。

### 从 v0.5.x 到 v1.0.0

- v0.6.0 将 OpenAI-compatible LLM client 接入 grounded answer path。
- 配置 active 且非 `demo://local` 的 LLM provider 后，知识命中问题会调用真实 provider。
- 无知识命中仍拒绝编造并建议转人工。

## 升级后验证

启动 API：

```bash
OPENSUPPORTAI_STORAGE=prisma PORT=4000 pnpm --filter @opensupportai/api dev
```

在 staging 或临时环境执行：

```bash
pnpm smoke:memory -- --help
pnpm smoke:chatwoot -- --help
pnpm smoke:channels -- --help
pnpm smoke:tools -- --help
```

使用内存模式做端到端基本验证：

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
API_URL=http://localhost:4000 pnpm smoke:memory
API_URL=http://localhost:4000 pnpm smoke:channels
API_URL=http://localhost:4000 pnpm smoke:tools
```

如果使用真实 Chatwoot，再配置 `CHATWOOT_*` 环境变量并运行：

```bash
pnpm smoke:chatwoot
```

## 回滚

如果升级失败：

1. 停止 API、worker、admin console 和 demo app。
2. 切回上一版本 tag。
3. 恢复升级前数据库备份。
4. 恢复原 `.env` 和部署 manifest。
5. 启动服务并执行对应版本 smoke。

不要在未知 migration 状态下反复启动生产 API；先在 staging 复现并确认数据库状态。

## 已知限制

- v1.0.0 仍不是完整 CRM 或工单系统。
- Slack 仅支持入站 Events API；出站回复仍需后续 adapter。
- Email 和 Telegram 仍是契约 stub。
- OpenAPI tools 需要手工配置；还没有自动 OpenAPI spec import、工具规划器或人工审批流。
- Retrieval 仍以确定性 keyword scoring 为主，schema 保留 pgvector-ready 字段。
