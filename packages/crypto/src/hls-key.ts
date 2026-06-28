/**
 * HLS AES-128 keys — generate / encrypt segments / build EXT-X-KEY uris.
 *
 * We use HLS sample-AES (AES-128-CBC, 16-byte key, IV per segment).
 * The key URI in the manifest points to OUR API, not R2:
 *
 *   #EXT-X-KEY:METHOD=AES-128,URI="https://api.vsp.app/stream/<vid>/key?t=<token>",IV=0x...
 *
 * The actual key never appears in any URL or persistent store unencrypted —
 * only in the response body, after backend verifies the request, fingerprint,
 * single-use nonce, etc.
 */

import { createCipheriv, randomBytes } from 'node:crypto';

/** AES-128 needs a 16-byte key and 16-byte IV. */
export type HlsKeyMaterial = {
  key: Buffer; // 16 bytes
  iv: Buffer; // 16 bytes
};

export function generateHlsKey(): HlsKeyMaterial {
  return { key: randomBytes(16), iv: randomBytes(16) };
}

/** Encrypt a TS segment in-memory. For large files prefer a streaming variant. */
export function encryptSegment(plaintext: Buffer, material: HlsKeyMaterial): Buffer {
  const cipher = createCipheriv('aes-128-cbc', material.key, material.iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** Render the IV as a 0x-prefixed hex string for the EXT-X-KEY tag. */
export function ivToHls(iv: Buffer): string {
  return `0x${iv.toString('hex').toUpperCase()}`;
}
