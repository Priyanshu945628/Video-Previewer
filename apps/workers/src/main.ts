/**
 * Workers entrypoint. Each queue is a separate `Worker` so a stuck FFmpeg job
 * can't block lighter tasks (email, sweeper). One Redis connection per worker,
 * because BullMQ blocks the connection it polls on.
 *
 *   queues:
 *     transcode   — FFmpeg HLS + AES-128 + sprite sheet  (concurrency=2)
 *     diff-strip  — per-version diff strip                (concurrency=4)
 *     review-export — review PDFs                         (concurrency=2)
 *     ai-summary  — Anthropic Claude (async path)          (concurrency=4)
 *     email       — Resend dispatch                       (concurrency=8)
 *     sweep       — exports/sessions/share-link GC        (concurrency=1, every 10m)
 */
import { createLogger } from '@vsp/logger';
import { env } from '@vsp/config';
import { Queue } from 'bullmq';
import { startTranscodeWorker } from './queues/transcode.worker';
import { startDiffWorker } from './queues/diff.worker';
import { startExportWorker } from './queues/export.worker';
import { startAiSummaryWorker } from './queues/ai-summary.worker';
import { startEmailWorker } from './queues/email.worker';
import { startSweepWorker } from './queues/sweep.worker';
import { makeConnection } from './lib/connection';

const logger = createLogger('workers');

const workers = [
  startTranscodeWorker(),
  startDiffWorker(),
  startExportWorker(),
  startAiSummaryWorker(),
  startEmailWorker(),
  startSweepWorker(),
];

// Boot a recurring sweep tick. We use BullMQ's repeatable job so we get HA
// for free (multiple worker pods → one tick still fires per interval).
const sweepQueue = new Queue('sweep', { connection: makeConnection() });
await sweepQueue.add(
  'tick',
  {},
  {
    repeat: { every: 10 * 60 * 1000 }, // 10 min
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
  },
);

logger.info({ env: env.NODE_ENV, count: workers.length }, 'workers up');

async function shutdown(signal: string) {
  logger.info({ signal }, 'workers shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await sweepQueue.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
