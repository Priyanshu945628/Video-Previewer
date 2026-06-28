/**
 * Session helpers — bridging Auth.js's `sessions` table with our extra fields
 * (ip, ua, fingerprintHash, idle timeout, single-session enforcement).
 *
 * Auth.js handles the cookie + token rotation; we layer on:
 *   - idle timeout (lastActiveAt + SESSION_IDLE_TIMEOUT_SECONDS)
 *   - absolute timeout (createdAt + SESSION_ABSOLUTE_TIMEOUT_SECONDS)
 *   - single-session enforcement (revoke older sessions for the user)
 */
import { env } from '@vsp/config';
import { prisma, withRlsBypass } from '@vsp/db';
import { sha256Hex } from '@vsp/crypto';

export type SessionMeta = {
  ip?: string | null;
  userAgent?: string | null;
  fingerprintHash?: string | null;
  deviceLabel?: string | null;
};

/**
 * Issue a new session row alongside Auth.js. Called from the signIn callback
 * so we control the metadata. The opaque `sessionToken` is what Auth.js sets
 * as the HttpOnly cookie.
 */
export async function persistSession(
  sessionToken: string,
  userId: string,
  meta: SessionMeta,
): Promise<string> {
  const expires = new Date(Date.now() + env.SESSION_MAX_AGE_SECONDS * 1000);
  return withRlsBypass(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { enforceSingleSession: true },
    });
    if (user?.enforceSingleSession) {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'concurrent' },
      });
    }
    const s = await tx.session.create({
      data: {
        sessionToken,
        userId,
        expires,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        fingerprintHash: meta.fingerprintHash ?? null,
        deviceLabel: meta.deviceLabel ?? null,
      },
      select: { id: true },
    });
    return s.id;
  });
}

/**
 * Touch the session and enforce idle + absolute timeouts in one place.
 * Returns null if the session is no longer valid (caller should sign out).
 */
export async function touchSession(sessionToken: string) {
  const now = Date.now();
  const idleCutoff = new Date(now - env.SESSION_IDLE_TIMEOUT_SECONDS * 1000);
  const absoluteCutoff = new Date(now - env.SESSION_ABSOLUTE_TIMEOUT_SECONDS * 1000);

  return withRlsBypass(async (tx) => {
    const s = await tx.session.findUnique({ where: { sessionToken } });
    if (!s || s.revokedAt) return null;
    if (s.expires.getTime() < now) {
      await tx.session.update({
        where: { id: s.id },
        data: { revokedAt: new Date(), revokedReason: 'expired' },
      });
      return null;
    }
    if (s.lastActiveAt < idleCutoff) {
      await tx.session.update({
        where: { id: s.id },
        data: { revokedAt: new Date(), revokedReason: 'idle' },
      });
      return null;
    }
    if (s.createdAt < absoluteCutoff) {
      await tx.session.update({
        where: { id: s.id },
        data: { revokedAt: new Date(), revokedReason: 'absolute' },
      });
      return null;
    }
    await tx.session.update({
      where: { id: s.id },
      data: { lastActiveAt: new Date() },
    });
    return s;
  });
}

export async function revokeSession(sessionToken: string, reason = 'logout') {
  return withRlsBypass((tx) =>
    tx.session.updateMany({
      where: { sessionToken, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
  );
}

/** Hash a session token for binding it to playback / stream records. */
export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

/** Best-effort device label from User-Agent. Used for the sessions list UI. */
export function labelFromUserAgent(ua?: string | null): string {
  if (!ua) return 'Unknown device';
  const m = ua.match(/\((.*?)\)/);
  const browser = /(Chrome|Firefox|Safari|Edg|OPR)\/[\d.]+/.exec(ua)?.[1] ?? 'Browser';
  return `${browser} on ${m?.[1]?.split(';')[0]?.trim() ?? 'unknown OS'}`;
}

/** Sweep stale sessions — called by a cron worker. */
export async function sweepExpiredSessions() {
  const now = new Date();
  return prisma.session.updateMany({
    where: { revokedAt: null, expires: { lt: now } },
    data: { revokedAt: now, revokedReason: 'expired' },
  });
}
