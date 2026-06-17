FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-console ./apps/admin-console

ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @opensupportai/admin-console... build

EXPOSE 3000
CMD ["pnpm", "--filter", "@opensupportai/admin-console", "preview"]
