# OpenSupportAI v0.1 首版发布清单

这份清单用于首次公开发布到 GitHub 前的最后检查。

## 必跑检查

```bash
pnpm install
pnpm exec prisma validate
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

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

## GitHub 首次发布建议

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

发布说明建议包含：

- v0.1 是可本地运行的 MVP，不是生产级 SaaS。
- 支持 memory mode，用于无数据库快速演示。
- Docker Compose 支持 Postgres/pgvector、Redis、MinIO、API、worker、admin、demo app。
- Chatwoot 是 optional profile 和 adapter，不是内置客服台。
- LLM provider 已有 OpenAI-compatible package，但 demo orchestrator 默认使用确定性知识库回答。

## 当前已知限制

- Widget 当前产物是 ESM-first，不是 legacy UMD 全局脚本。
- PDF/URL 知识源在文档中作为方向保留，v0.1 API 主要支持直接提交 markdown/text 内容。
- Worker 进程当前是占位常驻进程，后续会承载异步索引、embedding 和 webhook retry。
- Docker Compose 启动需要在安装 Docker 的机器上单独验证。
