/**
 * Server-side API client. Forwards the incoming request's session cookie
 * to the NestJS gateway so server components can fetch tenant-scoped data.
 *
 * Different from `lib/api-client` (which runs in the browser): no CSRF
 * header needed for GETs, and we must explicitly forward the cookie.
 */
import { cookies, headers } from 'next/headers';
import { env } from '@vsp/config';

const BASE = env.API_URL.replace(/\/+$/, '');

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const h: Record<string, string> = {
    Accept: 'application/json',
    Cookie: cookieHeader,
  };
  const reqHeaders = await headers();
  const xfwd = reqHeaders.get('x-forwarded-for');
  if (xfwd) h['X-Forwarded-For'] = xfwd;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const e = json?.error ?? { code: 'UNKNOWN', message: r.statusText };
    throw Object.assign(new Error(e.message), { code: e.code, status: r.status });
  }
  return (json?.data ?? json) as T;
}

export const serverApi = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
};
