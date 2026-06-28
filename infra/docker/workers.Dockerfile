# syntax=docker/dockerfile:1.7
# Workers image — needs FFmpeg + Bento4 baked in.

FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates tini && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @vsp/db generate
RUN pnpm --filter @vsp/workers build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd -r -u 1001 vsp
COPY --from=build --chown=vsp:vsp /app/apps/workers/dist ./apps/workers/dist
COPY --from=build --chown=vsp:vsp /app/apps/workers/package.json ./apps/workers/
COPY --from=build --chown=vsp:vsp /app/packages ./packages
COPY --from=build --chown=vsp:vsp /app/node_modules ./node_modules
COPY --from=build --chown=vsp:vsp /app/package.json ./
USER vsp
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/workers/dist/main.js"]
