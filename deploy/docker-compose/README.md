# Docker Compose

This stack is the v0.1 self-hosted demo path.

## Services

```text
postgres + pgvector
redis
minio
api
worker
admin-console
demo-app
optional chatwoot
```

## Start

From the repository root:

```bash
cp deploy/docker-compose/.env.example .env
docker compose -f deploy/docker-compose/docker-compose.yml up -d --build
pnpm db:migrate
pnpm db:seed
```

Open:

```text
Admin Console: http://localhost:3000
Demo App:      http://localhost:3001
API Health:    http://localhost:4000/health
MinIO Console: http://localhost:9001
```

Demo credentials:

```text
Admin token: admin_demo_key
Project ID:  proj_demo
Public key:  pk_demo
Inbox ID:    inbox_default
```

## Chatwoot

Chatwoot is optional and runs behind a Compose profile:

```bash
docker compose -f deploy/docker-compose/docker-compose.yml --profile chatwoot up -d
```

Then configure the Chatwoot base URL, account ID, inbox ID, API token, and webhook secret from the OpenSupportAI admin console.

## Notes

- The API defaults to Prisma storage in Docker.
- For no-database local development, use `OPENSUPPORTAI_STORAGE=memory` with the API dev server instead.
- Replace all default secrets before using this stack beyond local development.
