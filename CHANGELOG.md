# Changelog

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
