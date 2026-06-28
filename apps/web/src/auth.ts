/**
 * App-level Auth.js handle — re-exports the shared config and provides the
 * `auth()` / `signIn` / `signOut` helpers used by server components and
 * server actions across the app.
 */
import NextAuth from 'next-auth';
import { authConfig } from '@vsp/auth';

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
