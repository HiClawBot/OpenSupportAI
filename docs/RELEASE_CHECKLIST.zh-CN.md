# OpenSupportAI v1.0.x 发布清单

这份清单用于公开发布到 GitHub 前的最后检查。

## 必跑检查

```bash
pnpm install
pnpm exec prisma validate
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm eval:golden
pnpm smoke:memory -- --help
pnpm smoke:chatwoot -- --help
pnpm smoke:channels -- --help
pnpm smoke:tools -- --help
pnpm smoke:postgres-answer
pnpm smoke:postgres-evolution
pnpm smoke:postgres-retrieval
sh scripts/production-compose-smoke.sh
```

三个 PostgreSQL smoke 都需要可用的 PostgreSQL + pgvector 与 `DATABASE_URL`。GitHub Actions 会自动启动临时 pgvector 服务，执行全部 migrations/seed，并验证消息/job 事务、worker 完成、回答重放幂等，提案审批、回归、灰度、晋级和回滚状态机，以及中英文词法检索、no-hit、document status 和 tenant isolation。

`eval:golden` 必须达到 `evals/golden/beta-core.v1.json` 内声明的全部阈值，且所有 critical scenario 通过。该门禁是确定性的，不依赖外部 LLM 或 model judge。

GitHub Actions CI 会在 `main`、Pull Request 和 `v*` tag 上执行同一组核心检查。

`production-compose-smoke.sh` 需要 Docker Compose；GitHub Actions 会自动执行。它是生产 Beta 的镜像、migration、readiness、worker 失联/恢复和 PostgreSQL 备份恢复门槛。本机没有 Docker 时不能把静态 YAML 检查替代为该项通过。

## 本地无数据库 Smoke Test

启动 API：

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev:demo
```

启动管理台和 Demo：

```bash
VITE_API_URL=http://localhost:4000 pnpm --filter @opensupportai/admin-console dev
VITE_API_URL=http://localhost:4000 pnpm --filter @opensupportai/demo-app dev
```

检查：

- `http://localhost:4000/health` 返回 `status: ok`。
- `http://localhost:3000` 能打开管理台，默认 admin token 为 `admin_demo_key`。
- `http://localhost:3001` 能打开 Demo app。
- Demo app 右下角 Widget 能创建会话。
- 输入 `怎么取消订阅？` 后能得到基于 demo 知识库的回答。
- 配置 active 且非 `demo://local` 的 OpenAI-compatible LLM provider 后，知识命中的用户问题会通过 LLM-backed grounded answer path 生成回答，并在 `ai_runs` 中记录 provider/model/prompt/token metadata。
- 未配置 LLM provider、使用 `demo://local` 或模型请求失败时，知识命中的用户问题会回退到确定性 grounded answer。
- 无知识命中时 API 仍拒绝编造答案，并建议转人工。
- 输入 `我要转人工` 后会话状态进入 `handoff_requested`。
- 管理台能看到对应 conversation、message 和 knowledge document。
- 管理台 knowledge document 列表能看到 status、chunk count、error/source 摘要，并可触发 reindex。
- 管理端 `POST /v1/admin/projects/{project_id}/knowledge/documents/{document_id}/reindex` 会创建 `knowledge.index` async job，并将文档状态标记为 `pending`。
- Worker 的 `knowledge.index` handler 会把文档标记为 `indexing`、重建 chunks，并最终标记为 `indexed` 或 `failed`。
- Prisma retrieval 只返回当前项目中 `indexed` 文档的 chunk；中文自然问句与英文关键词都能命中，无关问题返回 no-hit。
- `knowledge_chunks.search_text` 由 trigger 自动维护，FTS 与 trigram GIN 索引均存在；repository 候选集和最终结果数量有硬上限。
- Prisma 模式发送普通用户消息时，用户消息与 `answer.generate` job 在一个事务中提交，HTTP 响应无需等待 LLM 或工具执行。
- Worker 完成 `answer.generate` 后会写入唯一 AI message；同一 job 重放不会产生重复回答或重复 AI run。
- API 与 worker 不共享 EventHub 时，已打开的 SSE 连接仍能通过持久化消息补拉收到 `ai.message.completed`。
- 管理台会话列表的状态筛选、搜索、刷新、队列指标、最近消息预览和失败 handoff 计数可正常显示。
- `pnpm smoke:memory` 在内存模式 API 启动后可跑通。
- 若启用 `RATE_LIMIT_ENABLED=true`，超过阈值时 API 返回 `429/rate_limited`。
- 管理端 `GET/POST /v1/admin/projects/{project_id}/jobs` 可创建和列出 async jobs。
- 管理端 `GET/POST/DELETE /v1/admin/projects/{project_id}/api-keys` 可创建、列出和撤销项目级 API key，响应不暴露 key hash。
- 使用新建的项目级 API key 访问 `/v1/admin/projects` 只返回自己的项目，撤销后无法继续认证。
- 管理端 `GET /v1/admin/projects/{project_id}/ops/health` 返回 `status: ok`。
- 管理端 `GET /v1/admin/projects/{project_id}/audit-log` 能看到关键写操作。
- 管理端 `GET /v1/admin/projects/{project_id}/webhooks/events` 可查看 webhook event；保留的 retry 端点返回 `501`，且不会创建 placeholder job。
- 创建会话和发送消息在复用同一 `Idempotency-Key` 时只产生一条记录；同 key 不同请求体返回 `409`。
- 消息列表 `limit`/`after` 分页无重复，且只在存在下一页时返回 `next_cursor`。
- 两个 worker 并发领取同一 queued job 时只有一个成功；错误 owner 不能续租、完成或失败该 job。
- 生产环境包含 API 与 worker，且 `WORKER_JOB_TYPES=answer.generate,knowledge.index`。
- 构建后执行 `NODE_ENV=test node services/api/dist/index.js` 与 `NODE_ENV=test WORKER_AUTOSTART=false node services/worker/dist/index.js` 均可正常退出。
- 管理端 `GET/POST/PATCH /v1/admin/projects/{project_id}/tools` 可列出、upsert、启停工具 allowlist。
- Widget 中输入 `请帮我查订单 ORD-2026-1001` 会触发 `demo.order_lookup` 并返回订单状态。
- Widget 中输入 `我的订阅状态是什么？` 会触发 `demo.subscription_lookup` 并返回订阅状态。
- 管理端可 upsert `kind=openapi` 的 active tool，metadata 中配置 `intent`、`allowed_hosts`、timeout、response shaping 和 answer template。
- 用户消息命中 OpenAPI tool intent 后，会调用 allowlist HTTP endpoint，写入 `status=completed` tool-call，并用 HTTP 响应生成回复。
- Inline 模式下，非 `GET` OpenAPI tool 只有同时配置 `metadata.allow_mutation=true` 与完整 `metadata.mutation_approval` 时才会执行，否则记录 `status=failed` tool-call 和安全失败回复。
- Durable `answer.generate` worker 不执行非 `GET` OpenAPI tool，即使存在 approval 也会记录安全失败且不发起出站请求。
- Public key 不能读取已有会话；会话 capability 不能跨 conversation 使用，conversation token 也不能直接用于 SSE。
- LLM、Chatwoot 与 OpenAPI tool 出站请求会阻断非 HTTP(S)、URL 凭据、生产私网地址和跨源重定向。
- 管理端 `GET /v1/admin/projects/{project_id}/tool-calls` 可查看工具调用日志。
- `pnpm smoke:tools` 在内存模式 API 启动后可跑通。
- 管理端 `POST /v1/admin/projects/{project_id}/conversations/{conversation_id}/assist` 可生成会话 summary、tags 和 suggested replies。
- 管理端 `GET /v1/admin/projects/{project_id}/analytics/handoffs` 可返回 handoff status/reason/provider 汇总。
- 管理端 `GET /v1/admin/projects/{project_id}/channels/adapters` 可列出 generic webhook、Slack、Email、Telegram adapters。
- 管理端 `POST /v1/admin/projects/{project_id}/channels/adapters/generic_webhook/test` 返回 `ok=true`。
- 管理端 `POST /v1/admin/projects/{project_id}/channels/generic-webhook` 可配置 generic webhook secret，响应不暴露明文 secret。
- `POST /v1/channel-webhooks/generic?public_key=pk_demo` 可写入入站消息，同一外部 `conversation_id` 会复用本地 conversation。
- 配置 generic webhook secret 后，非法 secret 返回 401，非法 payload 返回 400。
- 重复投递已处理过的 `event_id` 不会重复创建 end-user message。
- 管理端 conversation list/detail 响应包含 `channel` 摘要。
- 管理端 `POST /v1/admin/projects/{project_id}/channels/slack` 可配置 Slack signing secret、default channel、default inbox 和 status，响应不暴露明文 secret。
- 管理端 `POST /v1/admin/projects/{project_id}/channels/adapters/slack/test` 在 Slack 已配置时返回 `ok=true`。
- `POST /v1/channel-webhooks/slack?public_key=pk_demo` 对 Slack URL verification payload 会在签名校验通过后回显 `challenge`。
- Slack invalid signature 返回 401，并在 webhook events 中记录 failed event。
- Slack `event_callback` message payload 会写入入站消息，按 `team_id:channel:thread_ts` 复用本地 conversation。
- 重复投递已处理过的 Slack `event_id` 不会重复创建 end-user message。
- `pnpm smoke:channels` 在内存模式 API 启动后可跑通。
- v1.0 公共契约文档已更新：`docs/PUBLIC_CONTRACTS.zh-CN.md`。
- v1.0 升级指南已更新：`docs/UPGRADE_TO_V1.zh-CN.md`。
- v1.0 生产部署指南已更新：`docs/PRODUCTION_DEPLOYMENT.zh-CN.md`。
- `pnpm eval:golden` 的全部 critical scenario 通过，score 与 pass rate 达到语料阈值。
- 缺少 `admin:evolution` scope 的项目 API key 无法读写评测和提案。
- 失败 run 可以创建 draft proposal；source run 不能复用为 regression evidence。
- 只有批准后新建、相同 suite/version 且通过的 run 可以推进到 `regression_passed`。
- 灰度要求 deployment、scope、rollback target；只有 `outcome=passed` 才能晋级。
- 提案状态变更会写 audit log，且任何 transition 都不会修改 knowledge document、LLM config 或 tool definition。
- Admin Console 生产构建默认不含 demo root token，刷新页面后 token 被清除。
- 治理评测英文与中文文档已分别更新：`docs/GOVERNED_EVOLUTION.md`、`docs/GOVERNED_EVOLUTION.zh-CN.md`。

## Docker Compose Smoke Test

需要本机安装 Docker。

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d --build
pnpm db:migrate
pnpm db:seed
```

检查：

- API: `http://localhost:4000/health`
- Admin Console: `http://localhost:3000`
- Demo App: `http://localhost:3001`
- MinIO Console: `http://localhost:9001`

可选 Chatwoot：

```bash
docker compose -f deploy/docker-compose/docker-compose.yml --profile chatwoot up -d
```

配置 Chatwoot account、inbox、API token 和 webhook secret 后，可以执行真实联调 smoke test：

```bash
pnpm smoke:chatwoot
```

该脚本会创建测试 conversation、触发 handoff、验证 external conversation id、模拟 Chatwoot 坐席回复 webhook，并模拟 resolved 状态同步。

## 生产 Compose 恢复测试

```bash
export POSTGRES_PASSWORD='...'
export DATABASE_URL='postgresql://opensupportai:...@postgres:5432/opensupportai'
export ADMIN_API_TOKEN='<at-least-32-character-high-entropy-value>'
export ENCRYPTION_KEY='<independent-encryption-key-at-least-32-chars>'
export CLIENT_TOKEN_SECRET='<independent-client-token-key-at-least-32-chars>'
export CORS_ORIGIN='https://support.example.com'
sh scripts/production-compose-smoke.sh
```

通过标准：API/worker 镜像用户为 `node`；migration task 成功；readiness 为 `200`；停止 worker 后变为 `503/worker_stale`；重启 worker 后恢复；custom-format 备份可恢复到独立数据库；migration 可重复执行。

## 安全发布检查

- `.env` 没有提交。
- `node_modules/`, `dist/`, `.turbo/`, coverage 和日志文件没有提交。
- README 中没有真实 LLM API Key、Chatwoot API token 或 webhook secret。
- 前端代码没有读取或暴露 LLM API Key。
- Admin API 需要 bearer token。
- Client API 使用 public key，并校验 public key 与 project 是否匹配。
- 所有 repository 查询按 `projectId` 隔离。
- RAG no-hit 策略不编造答案。
- Chatwoot webhook 有 secret/signature 校验。

## GitHub 发布建议

```bash
git init
git add .
git commit -m "Initial OpenSupportAI v0.1 release"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

版本发布建议：

```bash
git tag v0.4.0
git push origin v0.4.0
gh release create v0.4.0 --title "OpenSupportAI v0.4.0" --notes-file docs/releases/v0.4.0.md
```

v0.5.0：

```bash
git tag v0.5.0
git push origin v0.5.0
gh release create v0.5.0 --title "OpenSupportAI v0.5.0" --notes-file docs/releases/v0.5.0.md
```

v0.5.1：

```bash
git tag v0.5.1
git push origin v0.5.1
gh release create v0.5.1 --title "OpenSupportAI v0.5.1" --notes-file docs/releases/v0.5.1.md
```

v0.5.2：

```bash
git tag v0.5.2
git push origin v0.5.2
gh release create v0.5.2 --title "OpenSupportAI v0.5.2" --notes-file docs/releases/v0.5.2.md
```

v0.6.0：

```bash
git tag v0.6.0
git push origin v0.6.0
gh release create v0.6.0 --title "OpenSupportAI v0.6.0" --notes-file docs/releases/v0.6.0.md
```

v0.7.0：

```bash
git tag v0.7.0
git push origin v0.7.0
gh release create v0.7.0 --title "OpenSupportAI v0.7.0" --notes-file docs/releases/v0.7.0.md
```

v0.8.0：

```bash
git tag v0.8.0
git push origin v0.8.0
gh release create v0.8.0 --title "OpenSupportAI v0.8.0" --notes-file docs/releases/v0.8.0.md
```

v0.9.0：

```bash
git tag v0.9.0
git push origin v0.9.0
gh release create v0.9.0 --title "OpenSupportAI v0.9.0" --notes-file docs/releases/v0.9.0.md
```

v1.0.0：

```bash
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 --title "OpenSupportAI v1.0.0" --notes-file docs/releases/v1.0.0.md
```

发布说明建议包含：

- v0.1 是可本地运行的 MVP，不是生产级 SaaS。
- 支持 memory mode，用于无数据库快速演示。
- Docker Compose 支持 Postgres/pgvector、Redis、MinIO、API、worker、admin、demo app。
- Chatwoot 是 optional profile 和 adapter，不是内置客服台。
- v0.6.0 已接入 OpenAI-compatible LLM-backed grounded answer path；demo/no-provider/error 场景仍使用确定性知识库回答。
- v0.1.1 增加 Chatwoot 连接测试、handoff retry、状态同步、CI 和 smoke-test 脚本。
- v0.1.2 增加管理台会话运营筛选、摘要指标、最近消息预览和最新 handoff 状态。
- v0.1.3 增加 API 限流、memory smoke test、管理台错误提示和 favicon polish。
- v0.1.4 增加 Prisma async_jobs、管理端 jobs API 和可测试 worker runtime。
- v0.2.0 增加项目级 API key 管理、审计日志、ops health 和 webhook event retry 调度。
- v0.3.0 增加业务工具定义、allowlist 启停、tool-call 日志，以及 demo 订单/订阅查询工具。
- v0.4.0 增加坐席辅助 summary、suggested replies、tags 和 handoff analytics。
- v0.5.0 增加 generic webhook 入站 channel adapter、channel adapter catalog/test API，以及 Slack/email/Telegram 契约 stub。
- v0.5.1 增加 generic webhook secret 配置、项目级 event 幂等、channel metadata 管理端可见性和负向 smoke 覆盖。
- v0.5.2 增加 Admin Console Operations 区域，覆盖 ops health、channel diagnostics、generic webhook 配置、API keys、audit logs、jobs、webhook events 和 tool-call logs，并升级 GitHub Actions action 版本线。
- v0.6.0 将 OpenAI-compatible LLM client 接入 orchestrator 的 grounded answer path：知识命中时可调用真实 provider 生成回答，并保留 demo/no-provider/error 的确定性回退和 no-hit refusal。
- v0.7.0 增加 knowledge document 原文存储、content hash、reindex API/Admin UI，以及真实 `knowledge.index` worker handler，可重建知识块并记录 indexed/failed 状态。
- v0.8.0 增加 Slack 入站 MVP：签名校验、URL verification、message event normalization、admin config/test UI/API、webhook event 幂等和本地 channel smoke 覆盖。
- v0.9.0 增加 OpenAPI-style business tool executor：支持 intent 抽取、host allowlist、timeout、response shaping、answer template、env bearer auth、mutation guard、failed tool-call 记录和本地 tool smoke 覆盖。
- v1.0.0 冻结公共 REST API、SDK、Widget 初始化参数、Chatwoot/generic/Slack adapter 和 OpenAPI tool executor 契约，并新增升级指南、生产部署指南和安全硬化说明。

## 当前已知限制

- Widget 当前产物是 ESM-first，不是 legacy UMD 全局脚本。
- PDF/URL 知识源在文档中作为方向保留，v0.1 API 主要支持直接提交 markdown/text 内容。
- Worker runtime 已具备 PostgreSQL 原子 claim、租约续期、stale recovery、owner fencing 和 graceful drain；v0.7.0 的知识库 indexing handler 继续作为当前真实 job 类型。
- Webhook replay 仍需 provider-specific 处理器；当前管理端不显示操作，保留 API 明确返回 `501`，不会再调度 placeholder job。
- v0.9.0 已接入 `openapi` tool definition 的 HTTP 执行器，但还没有自动 OpenAPI spec import、模型规划器、工具级密钥加密存储或人工审批流；生产部署建议通过环境变量注入 token 并只开放只读工具。
- v0.4.0 的 agent assist 是确定性启发式生成，不调用外部 LLM；后续可替换为可配置的模型生成与评测流程。
- v0.8.0 已新增 Slack 入站 Events API adapter；Slack 出站回复、Email 和 Telegram provider API 仍需后续实现。
- v0.7.0 已新增知识库重建索引 worker handler，但 retrieval 仍以 keyword scoring 为主；embedding/vector retrieval 仍需后续实现。
- 治理评测 observations 当前由可信 runner 或管理员提交；API 不执行任意远程场景，提案也不会自动 apply 到生产。
- 灰度证据当前由 operator 提交；自动流量分配、指标采集和长期评测趋势 dashboard 尚未实现。
- Docker Compose 启动需要在安装 Docker 的机器上单独验证。
