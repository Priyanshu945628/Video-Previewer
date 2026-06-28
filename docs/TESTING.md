# Testing

Three layers, all wired into `pnpm test`:

| Layer | Tooling | What it tests | Where it runs |
|---|---|---|---|
| Unit | Vitest | Pure helpers (crypto, watermark, signed URLs, rate-limit math) | every package |
| Integration | Vitest + ephemeral Postgres + Testcontainers | Repository + service layer against a real DB with RLS enabled | `apps/api`, `apps/workers` |
| E2E | Playwright | Browser-driven flows: sign-in, upload, review, share-link viewer | `tests/e2e` |

## Running

```bash
# everything
pnpm test

# just one package
pnpm --filter @vsp/crypto test

# watch mode
pnpm --filter @vsp/api test --watch

# E2E (boots docker compose first)
pnpm test:e2e
```

## Conventions

- **Unit tests live next to the code:** `signed-url.ts` →
  `signed-url.test.ts`. We only split into `__tests__/` directories
  when a unit needs a lot of fixtures.
- **Integration tests use real services:** Testcontainers spins up
  Postgres + Redis + MinIO. No mocks for the data layer — the value of
  these tests is catching the things mocks hide.
- **One test per behavior:** A failing test should point at exactly
  one cause. Big `describe.each` matrices live in performance suites,
  not correctness suites.
- **No `expect(true).toBe(true)` smoke tests.** If a test can't fail,
  delete it.

## Coverage targets

| Package | Target |
|---|---|
| `@vsp/crypto` | 95% — security-critical, low surface |
| `@vsp/auth` | 90% |
| `@vsp/db` | RLS policies exercised end-to-end, not line coverage |
| `apps/api` | 80% per service, 100% on guard logic |
| `apps/workers` | 70% — FFmpeg paths exercised against fixture files |
| `apps/web` | E2E happy path; unit tests for non-trivial hooks only |

## Forbidden patterns

- **No timer mocks in security tests.** TTL math is too easy to fool.
- **No `process.env` mutation.** Use `vi.stubEnv` or factory-inject.
- **No production data in fixtures.** Faker only, with deterministic
  seeds so failures reproduce.

## Continuous integration

GitHub Actions matrix:

```
- name: lint        → pnpm lint
- name: typecheck   → pnpm typecheck
- name: test        → pnpm test (with Testcontainers)
- name: e2e         → pnpm test:e2e (compose-up first)
- name: scan        → trivy fs + npm audit --audit-level=high
```

Required checks before merge: all of the above + a green review.
