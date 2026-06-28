# Architecture

## Overview

VSP is a Turborepo monorepo with three deployable apps (`web`, `api`,
`workers`) and seven shared packages. Clean Architecture inside each
service: controllers (or routes) → services → repositories → DB.

```
┌───────────┐    ┌───────────┐    ┌─────────────┐
│  web      │◄──►│  api      │◄──►│  postgres   │
│  Next.js  │    │  NestJS   │    └─────────────┘
└─────┬─────┘    └─────┬─────┘    ┌─────────────┐
      │ ws            │           │   redis     │
      └──── ────►─────┘           └─────────────┘
                      │           ┌─────────────┐
                      └──►────────│  bullmq     │◄──►  workers
                                  └─────────────┘
                      │           ┌─────────────┐
                      └──►────────│  R2 / S3    │
                                  └─────────────┘
```

## Packages

| Package | Purpose | Depends on |
|---|---|---|
| `@vsp/config` | Env loader with zod | — |
| `@vsp/logger` | Pino + ALS context | config |
| `@vsp/crypto` | KMS, signed URLs, watermarks, AES-128 helpers | config, logger |
| `@vsp/db` | Prisma client + RLS-aware tx helpers | config, logger |
| `@vsp/contracts` | Zod DTOs shared web↔api↔workers | — |
| `@vsp/auth` | Auth.js v5 config, password, TOTP, session helpers | config, db, crypto |
| `@vsp/ui` | Tailwind preset, Radix primitives | — |
| `@vsp/player` | Custom HLS player with anti-capture | — |

`web` and `api` both import `@vsp/auth` so the session model is identical
on both sides.

## Data flow: upload → playback

1. **Editor uploads** in `apps/web` `UploadDialog`. Asset row created, then
   `POST /assets/upload/init` reserves an `AssetVersion` and returns a
   multipart `uploadId`.
2. Browser PUTs 8 MiB parts directly to R2 via presigned URLs.
3. `POST /assets/upload/complete` finalizes the multipart and enqueues a
   `transcode` BullMQ job.
4. **Worker** (`apps/workers`) downloads the original, runs an FFmpeg
   HLS encode with AES-128 per-segment encryption. Key bytes are
   generated locally, wrapped by KMS, written to `EncryptionKey` row.
   Renditions are written to R2 `hls/<ws>/<asset>/<version>/...`.
5. **Editor opens** the project room → `streamInit` returns a signed
   manifest URL + watermark token + poster URL.
6. **Player** fetches the manifest via the API. The API rewrites segment
   URIs to signed proxy URLs, then streams each segment from R2 back
   through the proxy. AES key delivery goes through `/stream/:vid/key`
   which re-verifies the session and a separate signed token.

## Why a sibling Socket.io server (port 4001)

Fastify upgrades are tricky to coexist with HTTP routes that share the
same event loop binding. Running Socket.io on its own port is one fewer
moving part: the realtime gateway boots in `RealtimeGateway.onModuleInit`,
shares Auth.js session validation with the HTTP layer via cookies, and
doesn't compete with Fastify's request lifecycle.

## Why DB sessions (not JWT)

Server-side revocation. "Sign out everywhere" needs to be instant, and
JWTs make that hard. We trade a small lookup-per-request cost for
correct security primitives. The session lookup is one indexed query on
`sessions.sessionToken` and runs on every authenticated request via the
`SessionGuard`.

## RLS enforcement

`PrismaService` has two entry points: `withTenant(ctx, fn)` sets
`app.workspace_id` and `app.user_id` as session GUCs, then runs `fn`
inside a transaction. RLS policies on every workspace-scoped table
reference those GUCs, so even a missing `WHERE workspaceId = ?` clause
cannot leak across tenants.

`withRlsBypass` is reserved for workers and admin tooling, and every use
must accompany an `AuditService.emit` call (lint rule planned).

## Audit chain

Each `audit_events` row stores `prevHash = sha256(prev_row)` and
`hash = sha256(prev_hash || row_payload)`. A periodic verifier walks
the chain in `apps/workers` `sweep` and refuses to start the next sweep
if a break is detected. Cheap to verify, cheap to extend, expensive to
tamper with silently.

## Performance budgets

| Path | Target p95 | Notes |
|---|---|---|
| Manifest fetch | 80 ms | Includes Postgres lookup + S3 GET + rewrite |
| Segment fetch | 40 ms | Direct R2 passthrough, no DB |
| Key fetch | 30 ms | KMS Decrypt + token verify |
| Comment write | 120 ms | Includes RLS tx + realtime broadcast |
| AI summary (50 comments) | 6 s | Anthropic round-trip dominates |

## Failure modes

- **R2 outage:** Manifest serving fails; the player surfaces a friendly
  error and pauses. Reads from the originals bucket are also blocked,
  so transcoding stops.
- **Postgres outage:** Auth fails closed; existing playback sessions
  continue until their next key request, then fail.
- **Redis outage:** Rate limits open (we fail open on this — verified
  by tests), nonces lost (one-shot tokens may be replayed within their
  TTL, but TTL is 60s for downloads). Realtime degrades but doesn't
  fall over.
- **KMS outage:** New uploads pile up in `transcode` queue. Existing
  manifests/segments served fine; key delivery fails.
