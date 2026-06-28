# VSP — Secure Video Review Platform

Frame.io-class workflow with a Netflix-shaped security posture, plus AI
review summaries. Designed for professional editors who hand cuts to
clients and need both the review tools AND the protection.

> **Honest framing.** Browser-side anti-capture is a forensic strategy,
> not a prevention strategy. We make casual capture inconvenient and
> attribute deliberate capture via dynamic watermarks. We do not pretend
> to stop a screen recorder. See `docs/SECURITY.md`.

## What's in the box

- **Editor dashboard**: projects, version history, frame-accurate
  comments, threaded replies, approvals, share-link controls.
- **Client portal**: stripped-down review surface; comments + approvals
  only.
- **Share-link viewer**: no-account flow with password / email / expiry
  / view-cap.
- **Custom HLS player**: native `<video>` + hls.js, dynamic watermark
  overlay, anti-capture signals, quality + speed + frame-step controls.
- **AI review summary**: Anthropic Claude (Sonnet 4.6 by default),
  categorizes the comment thread into voiceover / color / editing /
  graphics / audio / pacing and prioritizes the top fix.
- **Review export**: PDF / JSON / CSV snapshot of the comment thread,
  including AI summary and frame thumbnails.
- **Per-version diff strip**: precomputed 1fps visual delta to v(n-1).
- **Admin**: workspace usage (storage, egress, AI spend), member roster,
  2FA status.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15 (App Router) + Tailwind + Radix | Server components, modern routing, premium-feel UI |
| API | NestJS 11 + Fastify | Clean Architecture, fast HTTP, easy DI |
| Workers | BullMQ + FFmpeg + Bento4 + @react-pdf | Robust queues, the industry FFmpeg stack |
| Data | PostgreSQL 16 + Prisma + RLS | Tenancy enforced at the DB |
| Cache / queue | Redis 7 | Sessions, rate limits, signed-URL nonces, queues |
| Storage | Cloudflare R2 (S3-compatible) | Zero egress fees, S3 swap-in |
| Auth | Auth.js v5 + Prisma adapter | DB sessions, TOTP, magic links — no DIY crypto |
| AI | Anthropic Claude | Sonnet 4.6 for the summary path |
| Realtime | Socket.io (sibling port) | Frame-accurate comment broadcast |
| Edge | Cloudflare | WAF, rate limit, DDoS |

## Repository layout

```
apps/
├── web/         Next.js (editor + client + share + admin)
├── api/         NestJS gateway (REST, WS, signed URL vending)
└── workers/     BullMQ (transcode, diff strip, export, AI, email, sweep)

packages/
├── config/      Env loader (zod-validated)
├── logger/      Pino + ALS context
├── crypto/      KMS, signed URLs, watermark tokens, AES-128
├── db/          Prisma client + RLS helpers
├── contracts/   Zod DTOs shared web↔api↔workers
├── auth/        Auth.js v5 config, password, TOTP, sessions
├── ui/          Tailwind preset + Radix primitives + design tokens
└── player/      Custom HLS player

infra/
├── docker/      Per-app Dockerfiles + compose
├── k8s/         Production manifests (api/workers/web + ingress)
└── terraform/   R2 + Neon + Upstash + Cloudflare modules

docs/
├── ARCHITECTURE.md
├── SECURITY.md
├── DEPLOYMENT.md
└── TESTING.md

tests/
└── e2e/         Playwright (auth, share-link flows)
```

## Quickstart

```bash
# 0. Prereqs: pnpm 9, Node 20, Docker
pnpm install

# 1. Boot local stack (postgres + redis + minio + mailhog)
docker compose up -d

# 2. Configure env
cp .env.example .env
# fill AUTH_SECRET, SIGNING_KEY_CURRENT, KMS_LOCAL_MASTER_KEY, ANTHROPIC_API_KEY

# 3. Migrate + seed
pnpm db:migrate
pnpm db:seed
# → creates demo workspace, editor (editor@vsp.local / EditorPass!42),
#   client (client@vsp.local / ClientPass!42), one project.

# 4. Dev
pnpm dev
# web   → http://localhost:3000
# api   → http://localhost:4000
# ws    → http://localhost:4001
# minio → http://localhost:9001  (vsp / vspvspvsp)
# smtp  → http://localhost:8025  (mailhog UI)
```

## Production-readiness checklist

- [x] Per-tenant RLS at the database
- [x] Append-only hash-chained audit log
- [x] Argon2id password hashing (OWASP defaults)
- [x] TOTP 2FA (RFC 6238), KMS-wrapped secrets
- [x] Server-side DB sessions (instant revocation)
- [x] CSP, HSTS, COOP, COEP, Permissions-Policy
- [x] CSRF double-submit
- [x] Signed URLs with short TTL, single-use enforcement via Redis
- [x] Per-version AES-128 keys, wrapped by KMS, delivered through
      authenticated proxy
- [x] Hot-path indexes + partitioned `audit_events` and `playback_events`
- [x] Per-request, per-user rate limits
- [x] Watermark template substitution + signed payload
- [x] Multi-arch container images, non-root runtimes, read-only rootfs
- [x] Three-layer test pyramid (unit / integration / Playwright)
- [x] CI: lint, typecheck, test, integration, e2e, Trivy, audit
- [x] Documented deployment + rotation + DR runbook

## Honest non-goals

- **DRM (Widevine / FairPlay / PlayReady).** Architecture is DRM-ready
  via the `KeyDeliveryService` seam; CDM licensing is a business
  decision, not an engineering one.
- **Preventing OS-level screen recording.** Browsers cannot do this.
  We use dynamic watermarks to attribute leaks instead.
- **Live streaming.** VOD only. Live ingest is a separate pipeline.

## License

Proprietary. All rights reserved.
