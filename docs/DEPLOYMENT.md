# Deployment

Two paths:

1. **Quick** — Vercel (`web`) + Fly.io / Railway (`api`, `workers`). Set
   the env, point DNS, done. Good for the freelance tier.
2. **Production** — Cloudflare (edge), Kubernetes (api + workers + web),
   Neon / RDS (Postgres), Upstash / ElastiCache (Redis), R2 (storage),
   KMS (keys). The `infra/terraform` + `infra/k8s` directories are the
   starting point.

## Prerequisites

| Resource | Why | Where |
|---|---|---|
| Domain | TLS + cookies + email links | Cloudflare-managed for the WAF |
| Cloudflare account | R2, WAF, DNS | api token in TF vars |
| Postgres 16 | Source of truth | Neon (managed) or self-hosted with PITR |
| Redis 7 | Cache, sessions, queues, nonces | Upstash or ElastiCache |
| KMS | Wraps per-version DEKs | AWS KMS or HashiCorp Vault |
| Resend (or Postmark) | Transactional email | `RESEND_API_KEY` env |
| Anthropic key | AI review summary | `ANTHROPIC_API_KEY` env |

## Step by step

```bash
# 1. Provision infra
cd infra/terraform
terraform init
terraform apply -var=domain=vsp.app

# 2. Sealed secrets (one-time, via External Secrets)
kubectl apply -f infra/k8s/namespace.yaml
# Then configure External Secrets to pull AWS Secrets Manager → vsp-secrets
kubectl apply -f infra/k8s/config.yaml

# 3. App deploys
kubectl apply -f infra/k8s/api.yaml
kubectl apply -f infra/k8s/workers.yaml
kubectl apply -f infra/k8s/web.yaml

# 4. DB migrations (run from an admin pod or CI job)
pnpm --filter @vsp/db migrate:deploy

# 5. Watch
kubectl -n vsp get pods -w
```

## Blue/green

Web and API both use rolling deploys with `maxUnavailable: 0` so no
session traffic is dropped during a release. Workers use the same
strategy; in-flight transcode jobs are picked up by the new pod within
the lock duration (30 min).

## Rollback

```bash
kubectl -n vsp rollout undo deployment/vsp-api
kubectl -n vsp rollout undo deployment/vsp-workers
kubectl -n vsp rollout undo deployment/vsp-web
```

DB migrations are forward-only by convention — schema changes ship in
two parts when needed (additive migration → code → cleanup migration)
so rolling back code doesn't strand the DB.

## Observability

- **Logs**: Pino JSON → Loki via Vector sidecar.
- **Metrics**: OpenTelemetry → Tempo + Grafana.
- **Audit chain verifier**: a sweep-worker cron that walks the chain
  per workspace daily; alerts on break.
- **SLO**: 99.9% on API p95 < 200ms, 99.5% on stream startup < 2s.

## Secret rotation

| Secret | Cadence | Procedure |
|---|---|---|
| `AUTH_SECRET` | Quarterly | Add new key as `AUTH_SECRET_PREV`, deploy, drop old after 24h |
| `SIGNING_KEY_CURRENT` | Quarterly or on incident | Same dual-window strategy via `SIGNING_KEY_PREVIOUS` |
| KMS KEK | Yearly (or compromise) | AWS-managed rotation; per-version DEKs re-wrapped lazily on next read |
| DB password | Monthly | Rotate via Neon / RDS console, update External Secrets |
| Anthropic key | On staff departure / quarterly | Rotate, drop |

## Disaster recovery

- **Postgres**: Neon PITR, 30-day window. Test restore weekly.
- **R2**: Daily snapshot to a second region's bucket. Originals only.
- **Redis**: Stateless (caches, rate-limit buckets) — accept loss.
  Replay of one-shot signed URLs is impossible across a Redis reset
  only if the TTL has expired; we accept that 60-second window.
- **Audit chain**: Exported daily to cold storage as a verified
  contiguous file per workspace.
