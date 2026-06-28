/**
 * Signed URL vendor — HMAC-SHA256 tokens with key rotation.
 *
 * Every privileged resource (HLS manifest, AES key, segment, download)
 * is fetched through our API with one of these tokens. The R2 URL itself
 * is NEVER returned to the client — the API streams the bytes through.
 *
 * Tokens are URL-safe base64 of a payload + 32-byte signature:
 *   token = b64u(payload) "." b64u(hmac(key_current, payload))
 *
 * Payload is a canonical JSON object:
 *   { kid, sub, res, params?, iat, exp, jti }
 *
 *   kid    key id ('cur' | 'prev') — supports rotation
 *   sub    subject — `user:<uuid>` or `share:<viewId>`
 *   res    resource type — 'manifest' | 'key' | 'segment' | 'download' | 'export' | 'thumb'
 *   params resource-specific (e.g. { versionId, idx })
 *   iat    issued-at (unix seconds)
 *   exp    expires-at (unix seconds)
 *   jti    nonce (uuid) — single-use enforcement via Redis
 */

import { createHmac } from 'node:crypto';
import { env } from '@vsp/config';
import { constantTimeEqual } from './hashing';
import { uuid } from './random';

const KEYS: Record<'cur' | 'prev', Buffer | null> = {
  cur: Buffer.from(env.SIGNING_KEY_CURRENT, 'base64'),
  prev: env.SIGNING_KEY_PREVIOUS ? Buffer.from(env.SIGNING_KEY_PREVIOUS, 'base64') : null,
};

export type SignedResource = 'manifest' | 'key' | 'segment' | 'download' | 'export' | 'thumb' | 'asset';

export type SignedPayload = {
  kid: 'cur' | 'prev';
  sub: string;
  res: SignedResource;
  params?: Record<string, string | number>;
  iat: number;
  exp: number;
  jti: string;
};

export type IssueOptions = {
  sub: string;
  res: SignedResource;
  params?: Record<string, string | number>;
  ttlSeconds?: number;
};

export type SignedToken = {
  token: string;
  jti: string;
  exp: number;
};

function b64u(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function unb64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function canonical(payload: SignedPayload): string {
  // Stable key order so the signature is deterministic across runtimes.
  const ordered = {
    kid: payload.kid,
    sub: payload.sub,
    res: payload.res,
    params: payload.params ?? null,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
  return JSON.stringify(ordered);
}

function sign(payload: SignedPayload): string {
  const key = KEYS[payload.kid];
  if (!key) throw new Error(`signing key '${payload.kid}' not configured`);
  const body = canonical(payload);
  const sig = createHmac('sha256', key).update(body).digest();
  return `${b64u(body)}.${b64u(sig)}`;
}

/**
 * Mint a signed token. ttl defaults to env.SIGNED_URL_TTL_SECONDS (5 min).
 * Pass shorter ttl for downloads (60s) and longer (manifest only) very rarely.
 */
export function issueSignedToken(opts: IssueOptions): SignedToken {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(opts.ttlSeconds ?? env.SIGNED_URL_TTL_SECONDS, 60 * 60);
  const payload: SignedPayload = {
    kid: 'cur',
    sub: opts.sub,
    res: opts.res,
    params: opts.params,
    iat: now,
    exp: now + ttl,
    jti: uuid(),
  };
  return { token: sign(payload), jti: payload.jti, exp: payload.exp };
}

export type VerifyOk = { ok: true; payload: SignedPayload };
export type VerifyFail = { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'unknown_key' };
export type VerifyResult = VerifyOk | VerifyFail;

export function verifySignedToken(token: string): VerifyResult {
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let payload: SignedPayload;
  try {
    payload = JSON.parse(unb64u(bodyB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const key = KEYS[payload.kid];
  if (!key) return { ok: false, reason: 'unknown_key' };
  const expected = createHmac('sha256', key).update(canonical(payload)).digest();
  if (!constantTimeEqual(b64u(expected), sigB64)) return { ok: false, reason: 'bad_signature' };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
