# Changelog

## Unreleased

English:

- Added conversation-scoped capabilities and short-lived SSE stream tokens; project public keys can no longer read or mutate existing conversations.
- Removed automatic demo seeding from normal API startup and added explicit `dev:demo` startup.
- Added production fail-fast validation for persistence, secrets, CORS, token TTLs, and outbound-network policy.
- Added explicit scopes across admin routes, centralized SSRF-resistant outbound requests, and persisted operator approval for mutation tools.
- Added SDK/Widget SSE reconnection with authenticated polling fallback and regression coverage for native EventSource errors.
- Added persisted conversation/message idempotency, stable message cursor pagination, project-level answer concurrency control, and bounded LLM requests.
- Added atomic PostgreSQL job claims, leases, heartbeats, stale recovery, owner fencing, and graceful worker drain.
- Added tenant-safe relational constraints, contact deduplication migration, project-scoped handoff mappings, and race-safe webhook claims.
- Replaced the placeholder webhook retry flow with an authenticated `501` response until real provider replay handlers exist.
- Fixed Prisma 7 PostgreSQL runtime initialization and bundled API/worker production entrypoints so Docker's `node dist/index.js` command is executable.

中文：

- 新增 conversation-scoped capability 与短期 SSE stream token；项目 public key 不再能够读取或修改已有会话。
- 普通 API 启动不再自动写入 demo 数据，新增显式 `dev:demo` 启动方式。
- 新增生产启动 fail-fast 校验，覆盖持久化、密钥、CORS、token TTL 和出站网络策略。
- 为管理端路由补齐显式 scope，并增加统一 SSRF 防护和 mutation tool 的持久化 operator approval。
- SDK/Widget 新增 SSE 重连、认证轮询 fallback，以及原生 EventSource error 回归测试。
- 新增会话/消息持久化幂等、稳定消息游标分页、项目级回答并发控制和有界 LLM 请求。
- 新增 PostgreSQL 原子 job claim、租约、heartbeat、stale recovery、owner fencing 和 worker 优雅排空。
- 新增租户关系约束、contact 去重 migration、项目级 handoff mapping 和 race-safe webhook claim。
- 移除 placeholder webhook retry 流程；在真实 provider replay handler 完成前，鉴权后的保留接口返回 `501`。
- 修复 Prisma 7 PostgreSQL runtime 初始化，并打包 API/worker 生产入口，确保 Docker 的 `node dist/index.js` 命令可执行。

## v1.0.0 - 2026-06-18

English:

- Promoted OpenSupportAI to the first stable public release line.
- Froze v1.0 public contracts for the REST API, JavaScript SDK, Widget initialization API, Chatwoot handoff adapter, generic/Slack inbound channel adapters, and OpenAPI-style business tool executor.
- Added v1.0 public contract documentation, upgrade guide, and production deployment guide.
- Expanded security guidance with OpenAPI business tool controls and production hardening requirements.
- Updated API spec, README, data model, roadmap, release checklist, release notes, and workspace package versions for `1.0.0`.

中文：

- 将 OpenSupportAI 推进到首个稳定公开发布版本线。
- 冻结 v1.0 公共契约：REST API、JavaScript SDK、Widget 初始化 API、Chatwoot handoff adapter、generic/Slack 入站 channel adapter 和 OpenAPI-style business tool executor。
- 新增 v1.0 公共契约文档、升级指南和生产部署指南。
- 扩展安全文档，覆盖 OpenAPI business tool 控制和生产硬化要求。
- 更新 API 规范、README、数据模型、路线图、发布清单、release notes 和 workspace package versions 到 `1.0.0`。

## v0.9.0 - 2026-06-18

English:

- Added OpenAPI-style business tool execution for active project-scoped tools.
- Added intent matching through tool metadata keywords and regex extraction.
- Added HTTP tool safety controls: final-host allowlists, request timeouts, response-size limits, response-path shaping, answer templates, environment-backed bearer auth, and default mutation blocking for non-GET methods.
- Added completed and failed tool-call records for OpenAPI tool execution.
- Added API regression coverage and a real local `pnpm smoke:tools` end-to-end smoke test.
- Updated API docs, README, release checklist, release notes, and workspace package versions for `0.9.0`.

中文：

- 新增 OpenAPI-style 业务工具执行，支持 active 的项目级工具定义。
- 新增通过 tool metadata keywords 和正则抽取进行意图匹配。
- 新增 HTTP 工具安全控制：最终 host allowlist、请求 timeout、响应大小限制、response path shaping、answer template、环境变量 bearer auth，以及非 GET 方法默认 mutation 阻断。
- OpenAPI 工具执行会记录 completed 和 failed tool-call。
- 新增 API 回归测试和真实本地 `pnpm smoke:tools` 端到端 smoke test。
- 更新 API 文档、README、发布清单、release notes 和 workspace package versions 到 `0.9.0`。

## v0.8.0 - 2026-06-18

English:

- Added a real Slack inbound channel adapter for signed Slack Events API callbacks.
- Added Slack request timestamp/signature verification and Slack URL verification challenge handling.
- Normalized Slack message events into OpenSupportAI conversations with project-scoped webhook event idempotency.
- Added admin API and admin console Operations UI for Slack signing secret, default channel, default inbox, status, and adapter testing.
- Expanded channel smoke testing to cover signed Slack callbacks, invalid signatures, idempotency, admin channel visibility, and webhook event visibility.
- Updated API docs, README, release checklist, release notes, and workspace package versions for `0.8.0`.

中文：

- 新增真实 Slack 入站 channel adapter，支持已签名的 Slack Events API callback。
- 新增 Slack request timestamp/signature 校验和 Slack URL verification challenge 处理。
- 将 Slack message event 归一化为 OpenSupportAI 会话，并保持项目级 webhook event 幂等。
- 新增 Slack signing secret、default channel、default inbox、status 和 adapter test 的管理端 API 与 Admin Console Operations UI。
- 扩展 channel smoke test，覆盖已签名 Slack callback、非法签名、幂等、管理端 channel 可见性和 webhook event 可见性。
- 更新 API 文档、README、发布清单、release notes 和 workspace package versions 到 `0.8.0`。

## v0.7.0 - 2026-06-18

English:

- Added stored knowledge document content and content hashes so indexing can be repeated from persisted data.
- Added a knowledge document reindex API that queues `knowledge.index` async jobs and moves documents back to `pending`.
- Added a real `knowledge.index` worker handler that marks documents `indexing`, rebuilds chunks, and records `indexed` or `failed` status.
- Added admin console reindex actions plus knowledge document source, chunk-count, and error visibility.
- Updated protocol, data model docs, API docs, release checklist, and package versions for `0.7.0`.

中文：

- Knowledge document 新增原文内容和 content hash 持久化，支持从已保存数据重复索引。
- 新增 knowledge document reindex API，可创建 `knowledge.index` async job，并将文档状态切回 `pending`。
- 新增真实 `knowledge.index` worker handler：标记 `indexing`、重建 chunks，并记录 `indexed` 或 `failed` 状态。
- Admin Console 新增 reindex 操作，并展示 knowledge document source、chunk count 和 error。
- 更新 protocol、数据模型文档、API 文档、发布清单和 package versions 到 `0.7.0`。

## v0.6.0 - 2026-06-18

English:

- Wired the OpenAI-compatible LLM client into the API orchestrator for knowledge-grounded answer generation.
- Kept deterministic grounded answers for demo/no-provider/error fallback paths and preserved no-hit refusal behavior.
- Recorded grounded generation provider, model, prompt version, token usage, confidence, retrieved chunk IDs, and fallback metadata in `ai_runs`.
- Added regression coverage for configured LLM generation through the client message flow.
- Bumped workspace package versions to `0.6.0`.

中文：

- 将 OpenAI-compatible LLM client 接入 API orchestrator，用于生成基于知识库的回答。
- 保留 demo、未配置 provider、模型错误等场景下的确定性 grounded answer fallback，并继续保持无命中不编造策略。
- 在 `ai_runs` 中记录 grounded generation 的 provider、model、prompt version、token usage、confidence、retrieved chunk IDs 和 fallback metadata。
- 新增通过客户端消息流程触发已配置 LLM generation 的回归测试。
- Workspace package versions 升级到 `0.6.0`。

## v0.5.2 - 2026-06-18

English:

- Added admin console Operations surfaces for ops health, channel adapters, generic webhook configuration, API keys, async jobs, webhook events, audit logs, and tool-call logs.
- Added admin console actions to test channel adapters, create/revoke admin API keys, queue async jobs, and schedule webhook event retries.
- Upgraded GitHub Actions workflow actions to the current v6 release line.
- Updated Docker Compose and release documentation with operator UI and production secret guidance.

中文：

- Admin Console 新增 Operations 区域，覆盖 ops health、channel adapters、generic webhook 配置、API keys、async jobs、webhook events、audit logs 和 tool-call logs。
- 管理台新增测试 channel adapter、创建/撤销 admin API key、创建 async job、调度 webhook event retry 等操作。
- GitHub Actions workflow 升级到当前 v6 action 版本线。
- 更新 Docker Compose 和发布文档，补充运维 UI 和生产 secret 指引。

## v0.5.1 - 2026-06-18

English:

- Added admin configuration for the generic webhook channel secret and secret header.
- Added secret verification for configured generic webhook channels.
- Made generic webhook event idempotency project-scoped by `project + provider + external_event_id`.
- Avoided duplicate messages when a processed generic webhook event is delivered again.
- Added channel metadata to admin conversation list and detail responses.
- Expanded channel smoke testing for invalid public keys, invalid secrets, invalid payloads, duplicate events, and admin channel visibility.

中文：

- 管理端新增 generic webhook channel secret 和 secret header 配置。
- 配置 generic webhook channel 后会校验 webhook secret。
- Generic webhook 幂等键调整为项目级：`project + provider + external_event_id`。
- 已处理的 generic webhook event 重复投递时不会重复写入消息。
- 管理端会话列表和详情新增 channel metadata。
- Channel smoke test 新增非法 public key、非法 secret、非法 payload、重复事件和管理端 channel 可见性覆盖。

## v0.5.0 - 2026-06-18

English:

- Added shared channel adapter protocol types for multi-channel inbound support.
- Added `@opensupportai/adapter-channels` with a fully testable generic webhook adapter and Slack/email/Telegram contract stubs.
- Added admin channel adapter catalog and adapter test endpoints.
- Added `POST /v1/channel-webhooks/generic` to ingest generic webhook messages into OpenSupportAI conversations.
- Added channel webhook smoke testing with `pnpm smoke:channels`.
- Added tests for channel catalog, generic webhook ingestion, external conversation reuse, stored messages, and webhook event visibility.

中文：

- 新增共享 channel adapter 协议类型，为多渠道接入打基础。
- 新增 `@opensupportai/adapter-channels`，包含可完整测试的 generic webhook adapter，以及 Slack/email/Telegram 契约 stub。
- 管理端新增 channel adapter catalog 和 adapter test API。
- 新增 `POST /v1/channel-webhooks/generic`，可把通用 webhook 消息写入 OpenSupportAI 会话。
- 新增 `pnpm smoke:channels`，用于 channel webhook 本地 smoke test。
- 新增 channel catalog、generic webhook 入站、外部会话复用、消息落库和 webhook event 可见性测试。

## v0.4.0 - 2026-06-18

English:

- Added `ConversationInsight` storage for deterministic agent-assist summaries, suggested replies, and tags.
- Added admin conversation assist APIs to read and generate insights.
- Added handoff analytics API with project-level counts by status, reason, and provider.
- Added conversation insight data to admin conversation detail responses.
- Added tests for insight generation, tags, suggested replies, and handoff analytics.

中文：

- 新增 `ConversationInsight` 存储，用于确定性的坐席辅助摘要、建议回复和标签。
- 管理端新增会话 assist API，支持读取和生成 insight。
- 新增 handoff analytics API，按项目统计 status、reason 和 provider。
- 管理端会话详情响应新增 conversation insight 数据。
- 新增 insight 生成、标签、建议回复和 handoff analytics 测试。

## v0.3.0 - 2026-06-18

English:

- Added business tool primitives with `ToolDefinition` and `ToolCall` storage.
- Added admin tools API for listing, upserting, enabling/disabling allowlisted tools, and reading tool-call logs.
- Added seeded demo tools for order lookup and subscription lookup.
- Added deterministic demo tool execution in the orchestrator before RAG fallback.
- Added tool-call visibility in admin conversation detail and ops health counts.
- Updated the demo app prompt strip and tests for business tool flows.

中文：

- 新增业务工具基础设施：`ToolDefinition` 和 `ToolCall` 存储。
- 管理端新增 tools API，支持列表、upsert、启停 allowlist 工具，以及读取 tool-call 日志。
- 内置 demo 订单查询和订阅查询工具。
- Orchestrator 在 RAG fallback 前会先执行确定性的 demo tool。
- 管理端会话详情和 ops health 新增 tool-call 可见性。
- 更新 Demo App 提示和业务工具流程测试。

## v0.2.0 - 2026-06-18

English:

- Added project-scoped API key management APIs for creating, listing, and revoking admin keys.
- Added API key identity tracking with `lastUsedAt` updates and stricter project-list/project-create permissions.
- Added `AuditLog` storage and admin audit-log API for key production operations.
- Added ops health API with project, storage, integration, async-job, webhook-event, and latest-audit status.
- Added webhook event management APIs to list events and schedule retry jobs.
- Added tests for API key lifecycle, audit logs, ops health, and webhook retry scheduling.

中文：

- 新增项目级 API key 管理 API，支持创建、列表和撤销 admin key。
- 新增 API key 身份识别和 `lastUsedAt` 更新，并收紧项目列表/创建权限边界。
- 新增 `AuditLog` 存储和管理端审计日志 API，覆盖关键生产操作。
- 新增 ops health API，返回项目、存储、集成、异步任务、webhook event 和最新审计状态。
- 新增 webhook event 管理 API，支持列表和调度 retry job。
- 新增 API key 生命周期、审计日志、ops health 和 webhook retry 调度测试。

## v0.1.4 - 2026-06-18

English:

- Added `AsyncJob` storage to Prisma with migration support.
- Added repository job APIs for create, list, claim, complete, and fail/retry flows.
- Added admin jobs API for listing and creating project-scoped async jobs.
- Replaced the worker placeholder with a tested worker runtime that claims jobs, dispatches handlers, completes successful jobs, and schedules retries on failures.
- Added tests for admin job APIs and worker runtime behavior.

中文：

- Prisma 新增 `AsyncJob` 存储和 migration。
- Repository 新增任务创建、列表、claim、完成、失败/重试 API。
- 管理端新增项目级 async jobs 列表和创建 API。
- Worker 从占位进程升级为可测试的运行时：claim job、分发 handler、完成成功任务、失败后安排 retry。
- 新增管理端 jobs API 和 worker runtime 测试。

## v0.1.3 - 2026-06-18

English:

- Added in-process fixed-window API rate limiting with configurable `RATE_LIMIT_*` environment variables.
- Added standard `rate_limited` API errors with rate-limit response headers.
- Added `pnpm smoke:memory` for local memory-mode end-to-end smoke validation.
- Improved admin console API error messages by surfacing backend error code, message, and request id.
- Added favicon links for the admin console and demo app.
- Updated documentation and release notes for ops hardening.

中文：

- 新增进程内固定窗口 API 限流，支持通过 `RATE_LIMIT_*` 环境变量配置。
- 新增标准 `rate_limited` API 错误和限流响应头。
- 新增 `pnpm smoke:memory`，用于本地内存模式端到端 smoke test。
- 管理台 API 错误提示会显示后端 error code、message 和 request id。
- Admin Console 和 Demo App 新增 favicon。
- 更新运维硬化相关文档和 release notes。

## v0.1.2 - 2026-06-17

English:

- Added enriched admin conversation lists with status/search filters, pagination metadata, and project-level summary counts.
- Added contact labels, message counts, recent-message previews, and latest handoff status to admin conversation list responses.
- Updated the admin console with conversation status filters, search, refresh, queue metrics, recent-message previews, and failed-handoff visibility.
- Added API regression coverage for admin conversation summary/filter behavior.
- Updated bilingual README and API documentation for the new conversation operations surface.

中文：

- 管理端会话列表新增状态/搜索筛选、分页元数据和项目级摘要计数。
- 会话列表响应新增联系人标签、消息数、最近消息预览和最新 handoff 状态。
- Admin Console 新增会话状态筛选、搜索、刷新、队列指标、最近消息预览和失败 handoff 可见性。
- 新增 API 回归测试，覆盖管理端会话摘要和筛选行为。
- 更新双语 README 和 API 文档，说明新的会话运营能力。

## v0.1.1 - 2026-06-17

English:

- Added Chatwoot connection testing from the admin console.
- Added Chatwoot handoff diagnostics and retry actions in conversation detail.
- Added Chatwoot `conversation_status_changed` webhook sync for `resolved`, `open`, `pending`, and `snoozed`.
- Added repository/API support for handoff lookup, diagnostics, and retry.
- Added GitHub Actions CI for format, Prisma validation, generation, lint, typecheck, test, and build.
- Added `pnpm smoke:chatwoot` for live OpenSupportAI + Chatwoot smoke testing.
- Updated README, API spec, Chatwoot adapter docs, and release checklist.

中文：

- 管理台新增 Chatwoot 连接测试。
- 会话详情新增 Chatwoot handoff 诊断信息和 retry 操作。
- 新增 Chatwoot `conversation_status_changed` webhook 状态同步，支持 `resolved`、`open`、`pending`、`snoozed`。
- Repository/API 新增 handoff 查询、诊断和重试能力。
- 新增 GitHub Actions CI，覆盖 format、Prisma validate/generate、lint、typecheck、test、build。
- 新增 `pnpm smoke:chatwoot`，用于真实 OpenSupportAI + Chatwoot 联调 smoke test。
- 更新 README、API 规格、Chatwoot adapter 文档和发布检查清单。

## v0.1.0 - 2026-06-17

English:

- Initial public MVP release.
- Fastify API, Prisma schema, in-memory demo storage, seeded demo project, admin console, demo app, widget, SDK, RAG helpers, LLM package, and Docker Compose stack.
- Initial Chatwoot handoff adapter and webhook backflow support.

中文：

- 首个公开 MVP 版本。
- 包含 Fastify API、Prisma schema、内存 demo 存储、内置 demo 项目、管理台、demo app、widget、SDK、RAG 工具、LLM 包和 Docker Compose。
- 提供初版 Chatwoot handoff adapter 和 webhook 回流能力。
