# syntax=docker/dockerfile:1.7
# Multi-stage build for the NestJS API gateway.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app

# ── deps ────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @vsp/db generate
RUN pnpm --filter @vsp/api build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini ca-certificates
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S vsp && adduser -S vsp -G vsp
COPY --from=build --chown=vsp:vsp /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=vsp:vsp /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=vsp:vsp /app/packages ./packages
COPY --from=build --chown=vsp:vsp /app/node_modules ./node_modules
COPY --from=build --chown=vsp:vsp /app/package.json ./
USER vsp
EXPOSE 4000 4001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
