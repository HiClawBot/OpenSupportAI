# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json prisma.config.ts ./
COPY prisma ./prisma
COPY packages ./packages
COPY services/api ./services/api
COPY services/worker ./services/worker
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @opensupportai/worker... build
RUN set -eux; \
    generated_client="$(find node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)"; \
    test -n "$generated_client"; \
    cp -R "$generated_client" /tmp/prisma-client

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
RUN CI=true pnpm install --prod --filter opensupportai --frozen-lockfile

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./package.json
COPY services/worker/package.json ./services/worker/package.json
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=build /tmp/prisma-client /tmp/prisma-client
RUN set -eux; \
    client_dir="$(find node_modules/.pnpm -path '*/node_modules/@prisma/client' -type d -print -quit)"; \
    test -n "$client_dir"; \
    client_node_modules="$(dirname "$(dirname "$client_dir")")"; \
    mkdir -p "$client_node_modules/.prisma"; \
    cp -R /tmp/prisma-client "$client_node_modules/.prisma/client"; \
    rm -rf /tmp/prisma-client
USER node
CMD ["node", "services/worker/dist/index.js"]
