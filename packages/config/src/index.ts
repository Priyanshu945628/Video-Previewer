/**
 * @vsp/config — single source of truth for environment configuration.
 *
 * Loaded ONCE at process start. Throws synchronously on validation failure
 * so we crash loudly instead of running with half-configured secrets.
 *
 * Usage:
 *   import { env } from '@vsp/config';
 *   env.DATABASE_URL // typed, validated
 */

import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const base64_32 = z
  .string()
  .min(32, 'must be a base64 secret of at least 32 bytes')
  .refine((s) => Buffer.from(s, 'base64').length >= 32, 'must decode to ≥32 bytes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1),
  DATABASE_DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().min(1),

  // Auth.js
  AUTH_SECRET: base64_32,
  AUTH_URL: z.string().url(),
  AUTH_TRUST_HOST: boolish.default(true),
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(2592000),
  SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(3600),
  SESSION_ABSOLUTE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(43200),

  // Service-to-service
  INTERNAL_JWT_SECRET: base64_32,
  INTERNAL_JWT_ISSUER: z.string().default('vsp-web'),
  INTERNAL_JWT_AUDIENCE: z.string().default('vsp-api'),

  // Signed URLs
  SIGNING_KEY_CURRENT: base64_32,
  SIGNING_KEY_PREVIOUS: z.string().optional(),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // Storage
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_ORIGINALS: z.string().default('vsp-originals'),
  S3_BUCKET_HLS: z.string().default('vsp-hls'),
  S3_BUCKET_THUMBS: z.string().default('vsp-thumbs'),
  S3_BUCKET_EXPORTS: z.string().default('vsp-exports'),
  S3_FORCE_PATH_STYLE: boolish.default(true),

  // KMS
  KMS_PROVIDER: z.enum(['local', 'aws', 'vault']).default('local'),
  KMS_LOCAL_MASTER_KEY: z.string().optional(),
  KMS_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),

  // Mail
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('VSP <no-reply@vsp.app>'),

  // AI
  AI_ENABLED: boolish.default(true),
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'local']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().default('claude-sonnet-4-6'),
  AI_MONTHLY_TOKEN_CAP: z.coerce.number().int().positive().default(2_000_000),

  // Rate limits
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_STREAM_KEY_PER_MIN: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  // Transcode
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  TRANSCODE_WORK_DIR: z.string().default('/tmp/vsp-transcode'),
  TRANSCODE_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Feature flags
  FEATURE_AI_SUMMARY: boolish.default(true),
  FEATURE_REVIEW_EXPORT: boolish.default(true),
  FEATURE_SHARE_LINKS: boolish.default(true),
  FEATURE_DELIVERY_PACKAGES: boolish.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const formatted = Object.entries(errors)
      .map(([k, v]) => `  - ${k}: ${v?.join(', ')}`)
      .join('\n');
    throw new Error(`[@vsp/config] Invalid environment:\n${formatted}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.KMS_PROVIDER === 'local') {
      throw new Error('[@vsp/config] KMS_PROVIDER=local is not allowed in production');
    }
    if (!parsed.data.AUTH_COOKIE_DOMAIN) {
      // eslint-disable-next-line no-console
      console.warn('[@vsp/config] AUTH_COOKIE_DOMAIN unset in production — cookies will use host-only scope');
    }
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
