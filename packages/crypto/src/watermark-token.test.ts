import { describe, it, expect, vi } from 'vitest';

const secret = Buffer.alloc(32, 9).toString('base64');
vi.stubEnv('SIGNING_KEY_CURRENT', secret);
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

const { issueWatermark, verifyWatermark, renderWatermark } = await import('./watermark-token');

describe('watermark-token', () => {
  it('round-trips', () => {
    const t = issueWatermark({
      name: 'Alex',
      email: 'a@b.co',
      sessionShort: 'ABC123',
      issuedAt: 1700000000,
      template: '{name}',
    });
    const v = verifyWatermark(t);
    expect(v?.name).toBe('Alex');
  });

  it('rejects tampered payloads', () => {
    const t = issueWatermark({
      name: 'Alex',
      sessionShort: 'X',
      issuedAt: 1,
      template: '{name}',
    });
    // Flip a byte in the body.
    const [body, sig] = t.split('.');
    const tampered = `${body.slice(0, -2)}xx.${sig}`;
    expect(verifyWatermark(tampered)).toBeNull();
  });

  it('renders template tokens, leaves unknowns alone', () => {
    expect(renderWatermark('{name} · {unknown}', { name: 'A' })).toBe('A · {unknown}');
    expect(renderWatermark('{date} {time}', { date: '2026-06-28', time: '20:14:00' })).toBe(
      '2026-06-28 20:14:00',
    );
  });
});
