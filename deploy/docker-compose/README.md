# OpenSupportAI Docker Compose

[English](#english) | [中文](#中文)

## English

### Evaluation Stack

`docker-compose.yml` is the local evaluation stack. It includes PostgreSQL/pgvector, Redis, MinIO, API, worker, Admin Console, Demo App, and optional Chatwoot. Redis and MinIO are not dependencies of the production Beta runtime.

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d --build
pnpm db:migrate
pnpm db:seed
```

Demo endpoints:

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API:           http://localhost:4000/health
```

### Production Beta Stack

`docker-compose.production.yml` is the supported single-host Beta topology:

```text
PostgreSQL/pgvector
one-shot migration task
one non-root API
one non-root worker
```

It does not seed demo records. Copy the template and fill every blank value. `DATABASE_URL` uses the internal host `postgres`; URL-encode any reserved character in database credentials.

```bash
cp deploy/docker-compose/production.env.example .env.production
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml config --quiet
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml up -d --build
```

The API binds to loopback by default. Put a TLS reverse proxy on the host before exposing it.

```bash
curl http://127.0.0.1:4000/health/live
curl http://127.0.0.1:4000/health/ready
```

`/health/live` is process liveness. `/health/ready` checks database access, the expected migration, and a current worker that declares `answer.generate` and `knowledge.index`; it returns HTTP `503` when a critical component is absent. Queue age may be `degraded` without removing the accepting API from service.

Root administrators can read sanitized runtime metrics:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  http://127.0.0.1:4000/v1/admin/ops/metrics
```

### Upgrade and Recovery

Create a custom-format backup before every migration:

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges > opensupportai.dump
```

Apply migrations as a separate release task, then replace the long-running containers:

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml run --rm migrate
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml up -d --build api worker
```

Always rehearse restore into a separate database before relying on a backup:

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml \
  exec -T postgres createdb -U "$POSTGRES_USER" opensupportai_restore
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml \
  exec -T postgres pg_restore -U "$POSTGRES_USER" -d opensupportai_restore \
  --no-owner --no-privileges < opensupportai.dump
```

Application rollback means redeploying the previously verified image/commit. If a migration is not backward compatible, restore the pre-migration backup instead of attempting ad hoc reverse SQL. Keep the service unavailable until restore verification passes.

CI executes the disposable production rehearsal below. It verifies clean migration, non-root containers, readiness, worker-loss detection, worker recovery, backup/restore, and migration replay:

```bash
sh scripts/production-compose-smoke.sh
```

### Optional Chatwoot Evaluation

Chatwoot remains an external operator system and is not bundled into the production Beta topology. The evaluation profile is available for local integration work:

```bash
docker compose -f deploy/docker-compose/docker-compose.yml --profile chatwoot up -d
pnpm smoke:chatwoot
```

## 中文

### 本地评估栈

`docker-compose.yml` 是本地评估栈，包含 PostgreSQL/pgvector、Redis、MinIO、API、worker、Admin Console、Demo App 和可选 Chatwoot。Redis 与 MinIO 不是生产 Beta runtime 的依赖。

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d --build
pnpm db:migrate
pnpm db:seed
```

Demo 地址：

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API:           http://localhost:4000/health
```

### 生产 Beta 栈

`docker-compose.production.yml` 是支持的单主机 Beta 拓扑：

```text
PostgreSQL/pgvector
一次性 migration task
一个非 root API
一个非 root worker
```

该拓扑不会写入 demo 数据。复制模板并填写所有空值。`DATABASE_URL` 使用内部主机名 `postgres`；数据库凭据中的保留字符必须进行 URL 编码。

```bash
cp deploy/docker-compose/production.env.example .env.production
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml config --quiet
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml up -d --build
```

API 默认只绑定宿主机 loopback。对公网暴露前必须在宿主机配置 TLS 反向代理。

```bash
curl http://127.0.0.1:4000/health/live
curl http://127.0.0.1:4000/health/ready
```

`/health/live` 表示进程存活。`/health/ready` 检查数据库、预期 migration，以及同时声明 `answer.generate` 与 `knowledge.index` 的有效 worker；关键组件缺失时返回 HTTP `503`。队列年龄可以标记为 `degraded`，但不会因此把仍可接收请求的 API 摘除。

Root 管理员可读取已脱敏的运行指标：

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  http://127.0.0.1:4000/v1/admin/ops/metrics
```

### 升级与恢复

每次 migration 前先创建 custom-format 备份：

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges > opensupportai.dump
```

将 migration 作为独立 release task 执行，再替换长期运行容器：

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml run --rm migrate
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml up -d --build api worker
```

备份必须先恢复到独立数据库完成演练：

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml \
  exec -T postgres createdb -U "$POSTGRES_USER" opensupportai_restore
docker compose --env-file .env.production \
  -f deploy/docker-compose/docker-compose.production.yml \
  exec -T postgres pg_restore -U "$POSTGRES_USER" -d opensupportai_restore \
  --no-owner --no-privileges < opensupportai.dump
```

应用回滚是重新部署上一份已验证镜像或提交。如果 migration 不向后兼容，应恢复 migration 前的备份，不要临时编写反向 SQL；恢复验证完成前保持服务不可用。

CI 会执行以下一次性生产演练，覆盖全新 migration、非 root 容器、readiness、worker 失联、worker 恢复、备份恢复和 migration 重放：

```bash
sh scripts/production-compose-smoke.sh
```

### 可选 Chatwoot 评估

Chatwoot 仍是外部客服系统，不会打包进生产 Beta 拓扑。本地集成可以使用评估 profile：

```bash
docker compose -f deploy/docker-compose/docker-compose.yml --profile chatwoot up -d
pnpm smoke:chatwoot
```
