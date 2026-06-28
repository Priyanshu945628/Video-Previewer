/**
 * Edge middleware.
 *
 * Gates the (app) segment behind a valid session cookie. Public routes:
 *   /login, /signup, /share/*, /_next/*, /api/auth/*, /api/share/*
 *
 * NOTE: we do NOT touch session metadata here — that's the API's job
 * (touchSession in @vsp/auth). The middleware just answers "is there a
 * cookie at all?" so we redirect unauthenticated users without burning
 * a DB roundtrip on every request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@vsp/config';

const PUBLIC_PATHS = [/^\/login/, /^\/signup/, /^\/share\//, /^\/api\/auth\//, /^\/api\/share\//, /^\/_next\//, /^\/favicon/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  const name = env.NODE_ENV === 'production' ? '__Secure-vsp.session' : 'vsp.session';
  const cookie = req.cookies.get(name)?.value;
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Pass through; bind a Request-ID header for downstream API calls.
  const res = NextResponse.next();
  const rid = req.headers.get('x-request-id') ?? crypto.randomUUID();
  res.headers.set('X-Request-Id', rid);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
