/**
 * @vsp/logger — structured logging with secret redaction.
 *
 * Every log line carries a request-scoped context (set via runWithContext)
 * so we don't have to thread a logger through every call site.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { env, isProduction } from '@vsp/config';

export type LogContext = {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  sessionId?: string;
  route?: string;
  ip?: string;
};

const als = new AsyncLocalStorage<LogContext>();

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-csrf-token"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.secretCipher',
  '*.wrappedDek',
  '*.signature',
  '*.cookie',
];

const baseOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: undefined, env: env.NODE_ENV },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    return als.getStore() ?? {};
  },
};

const transport = isProduction
  ? undefined
  : pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', singleLine: false },
    });

export const rootLogger: Logger = pino(baseOptions, transport);

export function createLogger(service: string): Logger {
  return rootLogger.child({ service });
}

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  const merged = { ...(als.getStore() ?? {}), ...ctx };
  return als.run(merged, fn);
}

export function withContext(ctx: LogContext): void {
  const store = als.getStore();
  if (store) Object.assign(store, ctx);
}

export function currentContext(): LogContext {
  return als.getStore() ?? {};
}

export type { Logger };
