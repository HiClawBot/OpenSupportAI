# Changelog

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
