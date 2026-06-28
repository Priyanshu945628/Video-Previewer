/**
 * Diff-strip worker — precomputes a 1-sample-per-second visual delta
 * between v(n-1) and v(n) for the compare view's heatmap.
 *
 * Output: a single packed PNG (width = sampleCount, height = 8 px) where
 * each column's brightness encodes how much the frame at that second
 * changed between versions. Cheap to render in the UI as a gradient strip
 * underneath the timeline.
 *
 * We bound work at MAX_SAMPLES=900 (~15 min @ 1fps) — beyond that we
 * downsample to keep the strip small and the encoder cheap.
 */
import { Worker, type Job } from 'bullmq';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { createLogger } from '@vsp/logger';
import { prisma, withRlsBypass } from '@vsp/db';
import { downloadTo, uploadBuffer } from '../lib/s3';
import { makeConnection } from '../lib/connection';

const logger = createLogger('worker:diff');

const MAX_SAMPLES = 900;

interface DiffJob {
  workspaceId: string;
  assetId: string;
  newVersionId: string;
}

function run(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => cmd.on('end', () => resolve()).on('error', reject).run());
}

export async function processDiff(job: Job<DiffJob>) {
  const { workspaceId, assetId, newVersionId } = job.data;

  // Find the previous version on the same asset.
  const prev = await withRlsBypass((tx) =>
    tx.assetVersion.findFirst({
      where: { assetId, id: { not: newVersionId }, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalKey: true, durationMs: true },
    }),
  );
  const next = await withRlsBypass((tx) =>
    tx.assetVersion.findUnique({
      where: { id: newVersionId },
      select: { id: true, originalKey: true, durationMs: true },
    }),
  );
  if (!prev || !next) {
    logger.info({ assetId }, 'no previous version, skipping diff');
    return;
  }

  const work = await mkdtemp(join(tmpdir(), `vsp-diff-${newVersionId}-`));
  try {
    const a = join(work, 'a.bin');
    const b = join(work, 'b.bin');
    await downloadTo('originals', prev.originalKey, a);
    await downloadTo('originals', next.originalKey, b);
    await job.updateProgress(20);

    const durationMs = Math.min(prev.durationMs ?? 0, next.durationMs ?? 0);
    const duration = durationMs / 1000;
    if (duration <= 0) {
      logger.warn({ newVersionId }, 'cannot diff zero-duration');
      return;
    }
    const sampleCount = Math.min(MAX_SAMPLES, Math.max(2, Math.floor(duration)));
    const step = duration / sampleCount;

    // ffmpeg blend=difference + tile in a single pass. Each tile is 8x8 (we'll
    // collapse y in the next pass). Output: PNG of size (8*sampleCount, 8).
    const stripPath = join(work, 'strip.png');
    await run(
      ffmpeg()
        .input(a)
        .input(b)
        .complexFilter([
          `[0:v]fps=1/${step.toFixed(3)},scale=8:8[a]`,
          `[1:v]fps=1/${step.toFixed(3)},scale=8:8[b]`,
          `[a][b]blend=all_mode=difference[d]`,
          `[d]tile=${sampleCount}x1`,
        ])
        .outputOptions(['-frames:v 1', '-pix_fmt rgb24'])
        .output(stripPath),
    );

    const png = await readFile(stripPath);
    const key = `thumbs/${workspaceId}/${assetId}/${newVersionId}/diff.png`;
    await uploadBuffer('thumbs', key, png, 'image/png');

    await withRlsBypass((tx) =>
      tx.diffStrip.upsert({
        where: { assetVersionId: newVersionId },
        create: { assetVersionId: newVersionId, comparedToId: prev.id, storageKey: key, sampleCount },
        update: { comparedToId: prev.id, storageKey: key, sampleCount },
      }),
    );

    await job.updateProgress(100);
    logger.info({ newVersionId, prev: prev.id, sampleCount }, 'diff done');
  } catch (err) {
    logger.error({ err, newVersionId }, 'diff failed');
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function startDiffWorker() {
  return new Worker<DiffJob>('diff-strip', processDiff, {
    connection: makeConnection(),
    concurrency: 4,
    lockDuration: 60_000 * 15,
  });
}

// Silence unused-prisma warning if linter expects the import to be used directly.
void prisma;
