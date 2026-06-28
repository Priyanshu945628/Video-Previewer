/**
 * Watermark token — the small payload the player renders on screen.
 *
 * It is NOT a security primitive on its own; the goal is leak attribution:
 * if a recording surfaces, the watermark identifies the session that played
 * it. The token is signed so a client can't tamper with the displayed text.
 */

import { createHmac } from 'node:crypto';
import { env } from '@vsp/config';
import { constantTimeEqual } from './hashing';

export type WatermarkPayload = {
  name?: string;
  email?: string;
  ip?: string;
  sessionShort: string;
  issuedAt: number; // unix seconds
  template: string; // e.g. "{name} · {email} · {date} {time}"
};

function b64u(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}
function unb64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function issueWatermark(payload: WatermarkPayload): string {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', Buffer.from(env.SIGNING_KEY_CURRENT, 'base64'))
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyWatermark(token: string): WatermarkPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', Buffer.from(env.SIGNING_KEY_CURRENT, 'base64'))
    .update(body)
    .digest('base64url');
  if (!constantTimeEqual(expected, sig)) return null;
  try {
    return JSON.parse(unb64u(body).toString('utf8')) as WatermarkPayload;
  } catch {
    return null;
  }
}

/** Render watermark template tokens. Unknown tokens stay as-is. */
export function renderWatermark(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
