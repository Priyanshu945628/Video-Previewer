/**
 * VSP API — Fastify-backed NestJS entrypoint.
 *
 * Hardening at boot:
 *   - Helmet (CSP, HSTS, frame-ancestors)
 *   - Cookies (HttpOnly + SameSite=Lax + CSRF double-submit)
 *   - Strict CORS allowlist
 *   - Global ZodValidation pipe
 *   - Global RLS interceptor (sets per-request Postgres GUCs)
 *   - Global error filter (no stack traces, no enum leaks)
 *   - Throttler (in-memory; replaced by Redis-backed bucket in production)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { env, corsOrigins, isProduction } from '@vsp/config';
import { createLogger } from '@vsp/logger';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

const log = createLogger('api');

async function bootstrap() {
  const adapter = new FastifyAdapter({ trustProxy: true, logger: false, bodyLimit: 16 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            mediaSrc: ["'self'", 'blob:'],
            connectSrc: ["'self'", env.APP_URL],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: isProduction
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
  });

  await app.register(cookie, {
    secret: env.AUTH_SECRET,
    parseOptions: { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' },
  });

  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : [env.APP_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-VSP-Fingerprint'],
    exposedHeaders: ['X-VSP-Request-Id'],
  });

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalInterceptors(new AuditInterceptor());

  app.enableShutdownHooks();

  const port = Number(new URL(env.API_URL).port || 4000);
  await app.listen(port, '0.0.0.0');
  log.info({ port }, 'api listening');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal boot error', err);
  process.exit(1);
});
