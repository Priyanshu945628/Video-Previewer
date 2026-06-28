import { createHash, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex of a string. Used for non-secret identifiers (session-token hash, fingerprint hash). */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** SHA-256 base64url — handy for compact identifiers in URLs. */
export function sha256B64u(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('base64url');
}

/** Constant-time string equality on the raw bytes — use for comparing tokens/hashes. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
