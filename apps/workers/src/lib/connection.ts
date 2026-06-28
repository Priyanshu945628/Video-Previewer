/** Shared connection factory — one IORedis per BullMQ worker (BullMQ blocks the connection). */
import IORedis from 'ioredis';
import { env } from '@vsp/config';

export function makeConnection() {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ requires null
    enableReadyCheck: true,
  });
}
