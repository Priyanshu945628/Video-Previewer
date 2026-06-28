import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { env } from '@vsp/config';
import { createLogger } from '@vsp/logger';

const log = createLogger('redis');

/**
 * Thin Redis wrapper. Three primary use cases:
 *   1. Signed-URL nonce blacklist (single-use enforcement)
 *   2. Rate-limit buckets
 *   3. AI summary cache + ephemeral playback counters
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    this.client.on('error', (e) => log.error({ err: e }, 'redis error'));
    this.client.on('connect', () => log.info('redis connected'));
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => {});
  }

  // ─── Nonces ─────────────────────────────────────────────────────────────
  /** Mark a jti as consumed; returns true on first use, false otherwise. */
  async consumeNonce(jti: string, ttlSeconds: number): Promise<boolean> {
    const key = `nonce:${jti}`;
    const r = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return r === 'OK';
  }

  // ─── Rate limiting (sliding-window-ish, fixed bucket) ───────────────────
  /** Returns the new count after increment. */
  async hit(key: string, windowSec: number): Promise<number> {
    const tx = this.client.multi();
    tx.incr(key);
    tx.expire(key, windowSec, 'NX');
    const res = await tx.exec();
    return Number(res?.[0]?.[1] ?? 0);
  }

  /** True when limit exceeded. */
  async over(key: string, limit: number, windowSec: number): Promise<boolean> {
    const c = await this.hit(key, windowSec);
    return c > limit;
  }

  // ─── Generic cache helpers ──────────────────────────────────────────────
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const s = JSON.stringify(value);
    if (ttlSeconds) await this.client.set(key, s, 'EX', ttlSeconds);
    else await this.client.set(key, s);
  }
}
