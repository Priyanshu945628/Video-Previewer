import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';

/**
 * Presence tracking via Redis. Uses sorted sets keyed by versionId,
 * scored by last-seen ms; entries TTL'd by periodic GC and ZREMRANGEBYSCORE
 * on each touch. Cheap, eventually-consistent, good enough for cursors.
 */
@Injectable()
export class PresenceService {
  private readonly log = new Logger(PresenceService.name);
  private readonly TTL_MS = 30_000;

  constructor(private readonly redis: RedisService) {}

  private key(versionId: string) {
    return `presence:v:${versionId}`;
  }

  async heartbeat(versionId: string, userId: string, payload: { name: string; color: string }) {
    const now = Date.now();
    const r = this.redis.client;
    const k = this.key(versionId);
    await r
      .multi()
      .hset(`presence:u:${versionId}:${userId}`, payload)
      .pexpire(`presence:u:${versionId}:${userId}`, this.TTL_MS * 3)
      .zadd(k, now, userId)
      .zremrangebyscore(k, 0, now - this.TTL_MS)
      .pexpire(k, this.TTL_MS * 3)
      .exec();
  }

  async leave(versionId: string, userId: string) {
    const r = this.redis.client;
    await r.multi().zrem(this.key(versionId), userId).del(`presence:u:${versionId}:${userId}`).exec();
  }

  async list(versionId: string) {
    const r = this.redis.client;
    const now = Date.now();
    const ids = await r.zrangebyscore(this.key(versionId), now - this.TTL_MS, '+inf');
    if (!ids.length) return [];
    const pipe = r.pipeline();
    for (const id of ids) pipe.hgetall(`presence:u:${versionId}:${id}`);
    const res = await pipe.exec();
    return ids.map((id, i) => {
      const meta = (res?.[i]?.[1] as Record<string, string> | null) ?? {};
      return { userId: id, name: meta.name ?? 'Anonymous', color: meta.color ?? '#888' };
    });
  }
}
