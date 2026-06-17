FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json prisma.config.ts ./
COPY prisma ./prisma
COPY packages ./packages
COPY services/api ./services/api

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @opensupportai/api... build

EXPOSE 4000
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed && node services/api/dist/index.js"]
