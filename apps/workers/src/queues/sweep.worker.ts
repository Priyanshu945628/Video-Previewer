/**
 * Sweep worker — periodic housekeeping. Booted on a BullMQ repeat from main.ts
 * (every 10 minutes). Each sub-sweep is idempotent + bounded per tick so one
 * failure can't stall the rest.
 *
 *   • ReviewExports past expiresAt    → delete S3 object, status → FAILED.
 *   • ShareLinks past expiresAt       → set revokedAt=now (kept for audit).
 *   • Sessions past expires           → revokedReason='expired'.
 *   • Old, consumed/expired Downloads → row TTL prune (>13 months).
 *   • Empty playback_events partitions are dropped by the monthly migration,
 *     not here.
 */
import { Worker, type Job } from 'bullmq';
import { createLogger } from '@vsp/logger';
import { prisma, withRlsBypass } from '@vsp/db';
import { sweepExpiredSessions } from '@vsp/auth';
import { deleteObject } from '../lib/s3';
import { makeConnection } from '../lib/connection';

const logger = createLogger('worker:sweep');

const BATCH = 200;

async function sweepExpiredExports() {
  const expired = await withRlsBypass((tx) =>
    tx.reviewExport.findMany({
      where: { status: 'READY', expiresAt: { lt: new Date() } },
      select: { id: true, storageKey: true },
      take: BATCH,
    }),
  );
  for (const e of expired) {
    if (e.storageKey) {
      try {
        await deleteObject('exports', e.storageKey);
      } catch (err) {
        logger.warn({ err, key: e.storageKey }, 'export object delete failed');
      }
    }
    await withRlsBypass((tx) =>
      tx.reviewExport.update({
        where: { id: e.id },
        data: { status: 'FAILED', storageKey: null, error: 'expired' },
      }),
    );
  }
  if (expired.length) logger.info({ count: expired.length }, 'expired exports swept');
}

async function sweepExpiredShareLinks() {
  const r = await withRlsBypass((tx) =>
    tx.shareLink.updateMany({
      where: { revokedAt: null, expiresAt: { lt: new Date() } },
      data: { revokedAt: new Date() },
    }),
  );
  if (r.count) logger.info({ count: r.count }, 'share links auto-revoked');
}

async function sweepExpiredSessionsTick() {
  const r = await sweepExpiredSessions();
  if (r.count) logger.info({ count: r.count }, 'sessions expired');
}

async function pruneOldDownloads() {
  // 13-month retention for download history rows; older rows are no longer
  // useful for audit (we still have the audit_events log for forensics).
  const cutoff = new Date(Date.now() - 13 * 30 * 24 * 60 * 60 * 1000);
  const r = await prisma.download.deleteMany({
    where: {
      status: { in: ['CONSUMED', 'EXPIRED', 'REVOKED'] },
      issuedAt: { lt: cutoff },
    },
  });
  if (r.count) logger.info({ count: r.count }, 'old downloads pruned');
}

async function pruneOldNotifications() {
  // Read-and-old notifications can go after 90 days.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const r = await prisma.notification.deleteMany({
    where: { readAt: { not: null, lt: cutoff } },
  });
  if (r.count) logger.info({ count: r.count }, 'old notifications pruned');
}

export async function processSweep(_job: Job) {
  for (const [name, fn] of [
    ['exports', sweepExpiredExports],
    ['shareLinks', sweepExpiredShareLinks],
    ['sessions', sweepExpiredSessionsTick],
    ['downloads', pruneOldDownloads],
    ['notifications', pruneOldNotifications],
  ] as const) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, sweep: name }, 'sweep step failed');
    }
  }
}

export function startSweepWorker() {
  return new Worker('sweep', processSweep, {
    connection: makeConnection(),
    concurrency: 1,
  });
}
