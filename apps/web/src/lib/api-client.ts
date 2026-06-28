/**
 * Cross-tier API client — talks to the NestJS gateway. Auth.js cookies
 * are sent via `credentials: 'include'`; the API guards check them.
 *
 * Errors come back shaped `{ error: { code, message, details } }` from the
 * gateway's HttpErrorFilter; we throw them as ApiError so call sites can
 * branch on `e.code`.
 */
import { env } from '@vsp/config';

const BASE = env.API_URL.replace(/\/+$/, '');

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (typeof document !== 'undefined') {
    const csrf = document.cookie.match(/__vsp_csrf=([^;]+)/)?.[1];
    if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  }
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const err = json?.error ?? { code: 'UNKNOWN', message: r.statusText };
    throw new ApiError(r.status, err.code, err.message, err.details);
  }
  return (json?.data ?? json) as T;
}

export const api = {
  get: <T = unknown>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T = unknown>(path: string, body?: unknown, init?: RequestInit) => request<T>('POST', path, body, init),
  patch: <T = unknown>(path: string, body?: unknown, init?: RequestInit) => request<T>('PATCH', path, body, init),
  del: <T = unknown>(path: string, init?: RequestInit) => request<T>('DELETE', path, undefined, init),
};
