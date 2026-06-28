/**
 * Auth.js v5 configuration — shared by the web app.
 *
 * Strategy: DB sessions (not JWT). This buys us:
 *   - Instant server-side revocation ("sign me out everywhere")
 *   - Single-session enforcement when users opt in
 *   - Per-session metadata (ip, ua, fingerprint) that we own
 *
 * Providers:
 *   - Credentials (email + password + optional TOTP, Argon2id verify)
 *   - Email (magic links via Resend)
 *
 * 2FA: enforced inside the Credentials provider's `authorize` — if a user
 * has 2FA enabled and the submitted `totp` is missing/wrong we throw a
 * typed error that the login UI surfaces.
 */
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import EmailProvider from 'next-auth/providers/email';
import { env } from '@vsp/config';
import { prisma } from '@vsp/db';
import { LoginInput } from '@vsp/contracts';
import { verifyPassword } from './password';
import { verifyTotp } from './totp';
import { persistSession, labelFromUserAgent } from './session';
import type { Wrapped } from '@vsp/crypto';

export class TwoFactorRequiredError extends Error {
  code = 'TWO_FACTOR_REQUIRED' as const;
}
export class InvalidCredentialsError extends Error {
  code = 'INVALID_CREDENTIALS' as const;
}
export class AccountLockedError extends Error {
  code = 'ACCOUNT_LOCKED' as const;
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database', maxAge: env.SESSION_MAX_AGE_SECONDS },
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST,
  cookies: {
    sessionToken: {
      name: env.NODE_ENV === 'production' ? '__Secure-vsp.session' : 'vsp.session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: env.NODE_ENV === 'production',
        domain: env.AUTH_COOKIE_DOMAIN || undefined,
      },
    },
    csrfToken: {
      name: env.NODE_ENV === 'production' ? '__Host-vsp.csrf' : 'vsp.csrf',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: env.NODE_ENV === 'production' },
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/login/check-email',
  },
  providers: [
    Credentials({
      name: 'Email + Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'TOTP', type: 'text' },
      },
      async authorize(raw) {
        const parsed = LoginInput.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentialsError();
        const { email, password, totp } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { authenticators: { where: { kind: 'TOTP' } } },
        });
        if (!user || !user.passwordHash) throw new InvalidCredentialsError();
        if (user.lockedUntil && user.lockedUntil > new Date()) throw new AccountLockedError();
        if (user.status !== 'ACTIVE') throw new InvalidCredentialsError();

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: { increment: 1 },
              lockedUntil:
                user.failedLoginCount + 1 >= 10
                  ? new Date(Date.now() + 15 * 60 * 1000)
                  : undefined,
            },
          });
          throw new InvalidCredentialsError();
        }

        if (user.twoFactorEnabled) {
          if (!totp) throw new TwoFactorRequiredError();
          const auth = user.authenticators[0];
          if (!auth?.secretCipher) throw new InvalidCredentialsError();
          const valid = await verifyTotp(
            { kekId: 'local-master', ciphertext: Buffer.from(auth.secretCipher) } as Wrapped,
            totp,
          );
          if (!valid) throw new TwoFactorRequiredError();
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lastLoginAt: new Date(), lockedUntil: null },
        });

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    EmailProvider({
      from: env.MAIL_FROM,
      server: env.RESEND_API_KEY
        ? { host: 'smtp.resend.com', port: 587, auth: { user: 'resend', pass: env.RESEND_API_KEY } }
        : { host: 'localhost', port: 1025 }, // mailhog in dev
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      // We don't have request context here, so a thin wrapper around persistSession
      // is enabled from the login route's server action (see apps/web). This
      // event is the safety net for OAuth providers added later.
      if (!user?.id) return;
    },
    async signOut(msg) {
      const token = 'session' in msg ? msg.session?.sessionToken : null;
      if (typeof token === 'string') {
        await prisma.session.updateMany({
          where: { sessionToken: token },
          data: { revokedAt: new Date(), revokedReason: 'logout' },
        });
      }
    },
  },
};

export { persistSession, labelFromUserAgent };
