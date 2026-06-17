FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/demo-app ./apps/demo-app

ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @opensupportai/demo-app... build

EXPOSE 3001
CMD ["pnpm", "--filter", "@opensupportai/demo-app", "preview"]
