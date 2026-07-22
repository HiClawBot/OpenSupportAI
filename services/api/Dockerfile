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
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @opensupportai/api... build
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

FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--config", "prisma.config.ts"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./package.json
COPY services/api/package.json ./services/api/package.json
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /tmp/prisma-client /tmp/prisma-client
RUN set -eux; \
    client_dir="$(find node_modules/.pnpm -path '*/node_modules/@prisma/client' -type d -print -quit)"; \
    test -n "$client_dir"; \
    client_node_modules="$(dirname "$(dirname "$client_dir")")"; \
    mkdir -p "$client_node_modules/.prisma"; \
    cp -R /tmp/prisma-client "$client_node_modules/.prisma/client"; \
    rm -rf /tmp/prisma-client
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/api/dist/index.js"]
