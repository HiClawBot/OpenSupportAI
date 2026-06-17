# OpenSupportAI v0.2.x 发布清单

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
pnpm smoke:memory -- --help
pnpm smoke:chatwoot -- --help
```

GitHub Actions CI 会在 `main`、Pull Request 和 `v*` tag 上执行同一组核心检查。

## 本地无数据库 Smoke Test

启动 API：

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
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
- 输入 `我要转人工` 后会话状态进入 `handoff_requested`。
- 管理台能看到对应 conversation、message 和 knowledge document。
- 管理台会话列表的状态筛选、搜索、刷新、队列指标、最近消息预览和失败 handoff 计数可正常显示。
- `pnpm smoke:memory` 在内存模式 API 启动后可跑通。
- 若启用 `RATE_LIMIT_ENABLED=true`，超过阈值时 API 返回 `429/rate_limited`。
- 管理端 `GET/POST /v1/admin/projects/{project_id}/jobs` 可创建和列出 async jobs。
- 管理端 `GET/POST/DELETE /v1/admin/projects/{project_id}/api-keys` 可创建、列出和撤销项目级 API key，响应不暴露 key hash。
- 使用新建的项目级 API key 访问 `/v1/admin/projects` 只返回自己的项目，撤销后无法继续认证。
- 管理端 `GET /v1/admin/projects/{project_id}/ops/health` 返回 `status: ok`。
- 管理端 `GET /v1/admin/projects/{project_id}/audit-log` 能看到关键写操作。
- 管理端 `GET /v1/admin/projects/{project_id}/webhooks/events` 可查看 webhook event，retry 端点会创建 `webhook.retry` async job。

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
git tag v0.2.0
git push origin v0.2.0
gh release create v0.2.0 --title "OpenSupportAI v0.2.0" --notes-file docs/releases/v0.2.0.md
```

发布说明建议包含：

- v0.1 是可本地运行的 MVP，不是生产级 SaaS。
- 支持 memory mode，用于无数据库快速演示。
- Docker Compose 支持 Postgres/pgvector、Redis、MinIO、API、worker、admin、demo app。
- Chatwoot 是 optional profile 和 adapter，不是内置客服台。
- LLM provider 已有 OpenAI-compatible package，但 demo orchestrator 默认使用确定性知识库回答。
- v0.1.1 增加 Chatwoot 连接测试、handoff retry、状态同步、CI 和 smoke-test 脚本。
- v0.1.2 增加管理台会话运营筛选、摘要指标、最近消息预览和最新 handoff 状态。
- v0.1.3 增加 API 限流、memory smoke test、管理台错误提示和 favicon polish。
- v0.1.4 增加 Prisma async_jobs、管理端 jobs API 和可测试 worker runtime。
- v0.2.0 增加项目级 API key 管理、审计日志、ops health 和 webhook event retry 调度。

## 当前已知限制

- Widget 当前产物是 ESM-first，不是 legacy UMD 全局脚本。
- PDF/URL 知识源在文档中作为方向保留，v0.1 API 主要支持直接提交 markdown/text 内容。
- Worker runtime 已有基础 claim/handler/retry 语义，后续仍需接入真实知识库 indexing 和 webhook retry 处理器。
- v0.2.0 的 webhook retry 已完成管理端调度，实际重放处理器会在后续 worker 迭代中实现。
- Docker Compose 启动需要在安装 Docker 的机器上单独验证。
