# Changelog

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
