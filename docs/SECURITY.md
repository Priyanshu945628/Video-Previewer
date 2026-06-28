# Security Model

This document is honest about what VSP protects against and what it doesn't.
"Honest" matters here because marketing copy that overstates protection
ages badly when the first leak happens.

## What we defend against

| Threat | Defenses |
|---|---|
| Direct file URL sharing | Originals never exposed; segments + manifests served only through signed proxy URLs (5-min TTL) over per-session bound HMAC tokens |
| Credential stuffing | Argon2id hashing (OWASP defaults), per-IP+email rate limit (5 / min), account lockout after 10 failures (15-min cooldown) |
| Session theft via XSS | `HttpOnly`, `SameSite=Lax`, `Secure` cookies; CSP locks scripts to self + inline only (no `unsafe-eval` in prod) |
| CSRF on state-changing endpoints | Double-submit token (cookie + `X-CSRF-Token` header), enforced by `CsrfGuard` |
| Cross-tenant data leakage | PostgreSQL Row-Level Security on every workspace-scoped table; `withTenant` is the only entry point for app traffic |
| Tampering with audit history | `audit_events` are hash-chained (each row carries SHA-256 of the previous) and append-only via RLS policy |
| Replay of one-shot tokens (downloads, exports) | Redis-backed `jti` blacklist consumed on first use; second use returns 403 |
| HLS key extraction at rest | Per-version DEK wrapped by AWS KMS KEK; only the API process can unwrap, and only after a session check |
| Watermark removal | Dynamic DOM overlay re-positions every 5-8s with random offsets; OCR-survivable bottom-band; for premium tier, burn server-side via FFmpeg pre-encode |
| Brute-force on share-link passwords | Argon2id hashing; per-link rate limit on `/shares/:slug/gate` (3 / min via Redis); CAPTCHA on Cloudflare WAF after 5 failures |
| Concurrent session abuse | Single-session toggle per user (`enforceSingleSession`); on login, prior sessions are revoked |
| Stolen sessions across devices | Per-session IP, UA, optional device fingerprint; signed-URL `sub` claim binds the user — if the cookie is stolen but the user changes IP within the TTL window, segment tokens become invalid |

## What we DO NOT prevent — and how we deal with it

Browsers cannot truly stop these, and pretending otherwise is dishonest.

| Threat | Reality | Mitigation |
|---|---|---|
| Screen recording (OS-level / phone camera) | Always possible | Dynamic watermark identifies the leaker; share-link views log IP/UA/email |
| Screenshots | OS-level capture cannot be blocked | Same — watermark + audit log |
| DevTools / Network sniffing | Power users will see decrypted segments in `MediaSource` | Short segment TTL (20s) + per-session token binding makes the captured URLs useless; key bytes are never written to disk |
| HLS.js source reading | All HLS players show segment URLs | URLs are useless without a fresh signed token; tokens are subject-bound |
| Audio capture via OS | Cannot be blocked from a browser | Watermark only |

We **do not blur the player when DevTools is detected** — security theater
frustrates legitimate clients and only mildly inconveniences a determined
user. We log the signal instead.

## Key management

Three layers:

1. **KEK** (Key Encryption Key) — held in AWS KMS, never leaves it.
2. **DEK** (Data Encryption Key) — one per video version, AES-128. Wrapped
   by KEK at rest; in memory only on the API process and only while
   serving a key request.
3. **Token signing key** — HMAC-SHA256 for signed URLs. Lives in env;
   rotation strategy below.

### Rotation

| Key | Cadence | Procedure |
|---|---|---|
| KMS KEK | Automatic, AWS-managed | KMS handles re-encryption transparently |
| Per-version DEK | On rotation request | Re-encrypt segments via a background job; coordinate with the playback CDN cache |
| Signed-URL HMAC | Quarterly, or on compromise | Add new key alongside old, accept both for 1h, then retire |
| Auth cookie secret | Quarterly | Auth.js handles graceful rotation when `AUTH_SECRET` includes prior versions |

## CSP

Production CSP (set in `next.config.mjs`):

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' blob:;
font-src 'self' data:;
connect-src 'self' <api-origin> ws: wss:;
frame-ancestors 'none';
object-src 'none';
worker-src 'self' blob:;
```

`unsafe-inline` for style is required by Tailwind's runtime inserts.
`unsafe-eval` is **not** allowed in production; hls.js runs without it.

## Reporting

Email `security@vsp.app` (PGP key published at `/.well-known/security.txt`).
We respond within 1 business day. Coordinated disclosure window: 90 days.
