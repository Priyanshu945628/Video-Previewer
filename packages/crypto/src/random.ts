import { randomBytes, randomUUID } from 'node:crypto';

/** URL-safe base64 of N random bytes. Default 32 bytes ≈ 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short opaque slug for share-links and public IDs. 16 bytes ≈ 128 bits. */
export function randomSlug(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

/** UUID v4 (re-export for clarity at call sites). */
export function uuid(): string {
  return randomUUID();
}

/** Recovery codes for TOTP. Returns plaintext array; caller is responsible for hashing. */
export function recoveryCodes(count = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = randomBytes(5).toString('hex'); // 10 hex chars
    out.push(`${buf.slice(0, 5)}-${buf.slice(5)}`);
  }
  return out;
}
