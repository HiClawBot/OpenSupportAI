FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY packages ./packages
COPY services/api ./services/api
COPY services/worker ./services/worker

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @opensupportai/worker... build

CMD ["node", "services/worker/dist/index.js"]
