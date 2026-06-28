# syntax=docker/dockerfile:1.7
# Next.js standalone build.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/player/package.json ./packages/player/
COPY packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @vsp/db generate
RUN pnpm --filter @vsp/web build

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini ca-certificates
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN addgroup -S vsp && adduser -S vsp -G vsp
COPY --from=build --chown=vsp:vsp /app/apps/web/.next/standalone ./
COPY --from=build --chown=vsp:vsp /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=vsp:vsp /app/apps/web/public ./apps/web/public
USER vsp
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
