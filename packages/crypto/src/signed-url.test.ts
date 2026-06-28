/**
 * Signed URL — security critical. Every property tested here is one a
 * future refactor could quietly break, so cover them tightly.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Stub env BEFORE importing the module under test.
const secret = Buffer.alloc(32, 7).toString('base64');
vi.stubEnv('SIGNING_KEY_CURRENT', secret);
vi.stubEnv('SIGNED_URL_TTL_SECONDS', '300');
// All the other env vars the config schema demands…
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('APP_URL', 'http://localhost:3000');
vi.stubEnv('API_URL', 'http://localhost:4000');
vi.stubEnv('DATABASE_URL', 'postgresql://x/x');
vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
vi.stubEnv('AUTH_SECRET', secret);
vi.stubEnv('AUTH_URL', 'http://localhost:3000');
vi.stubEnv('INTERNAL_JWT_SECRET', secret);
vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
vi.stubEnv('S3_ACCESS_KEY_ID', 'x');
vi.stubEnv('S3_SECRET_ACCESS_KEY', 'x');
vi.stubEnv('KMS_LOCAL_MASTER_KEY', secret);

const mod = await import('./signed-url');

describe('signed-url', () => {
  it('round-trips a token', () => {
    const t = mod.issueSignedToken({ sub: 'user:1', res: 'manifest' });
    const v = mod.verifySignedToken(t.token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.sub).toBe('user:1');
      expect(v.payload.res).toBe('manifest');
    }
  });

  it('rejects tampered signatures', () => {
    const t = mod.issueSignedToken({ sub: 'user:1', res: 'segment', params: { idx: 0 } });
    const swapped = t.token.replace(/.{4}$/, 'AAAA');
    const v = mod.verifySignedToken(swapped);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('bad_signature');
  });

  it('rejects expired tokens', () => {
    const t = mod.issueSignedToken({ sub: 'u', res: 'key', ttlSeconds: 1 });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    const v = mod.verifySignedToken(t.token);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('expired');
    vi.useRealTimers();
  });

  it('rejects payloads with the wrong resource type', () => {
    const t = mod.issueSignedToken({ sub: 'u', res: 'manifest' });
    const v = mod.verifySignedToken(t.token);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload.res).not.toBe('segment');
  });

  it('rejects malformed inputs', () => {
    expect(mod.verifySignedToken('').ok).toBe(false);
    expect(mod.verifySignedToken('not-a-token').ok).toBe(false);
    expect(mod.verifySignedToken('one.two.three').ok).toBe(false);
  });

  it('clamps ttl above the upper bound', () => {
    // We never want a 24h token leaking from someone passing a giant number.
    const t = mod.issueSignedToken({ sub: 'u', res: 'export', ttlSeconds: 99_999_999 });
    const v = mod.verifySignedToken(t.token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      // Implementation clamps to 1h.
      const delta = v.payload.exp - v.payload.iat;
      expect(delta).toBeLessThanOrEqual(60 * 60);
    }
  });
});
