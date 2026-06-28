/**
 * Review-export worker — renders a PDF (or JSON / CSV) snapshot of a
 * version's comment thread plus the AI summary if present.
 *
 * PDF is rendered with @react-pdf/renderer in a Node context; thumbnails
 * come from the precomputed sprite (no per-comment frame-grab → no FFmpeg
 * here, which keeps this worker memory-light and parallel-friendly).
 */
import { Worker, type Job } from 'bullmq';
import { createLogger } from '@vsp/logger';
import { withRlsBypass } from '@vsp/db';
import { uploadBuffer } from '../lib/s3';
import { makeConnection } from '../lib/connection';
import { renderReviewPdf } from '../pdf/review-pdf';

const logger = createLogger('worker:export');

interface ExportJob {
  exportId: string;
  workspaceId: string;
  userId: string;
}

export async function processExport(job: Job<ExportJob>) {
  const { exportId, workspaceId } = job.data;

  // Mark RUNNING.
  await withRlsBypass((tx) =>
    tx.reviewExport.update({ where: { id: exportId }, data: { status: 'RUNNING' } }),
  );

  try {
    const exp = await withRlsBypass((tx) =>
      tx.reviewExport.findUnique({
        where: { id: exportId },
        include: {
          assetVersion: {
            include: {
              asset: { include: { project: { select: { id: true, name: true, clientLabel: true } } } },
              comments: {
                where: {
                  deletedAt: null,
                  parentId: null,
                },
                orderBy: { timeMs: 'asc' },
                include: {
                  author: { select: { name: true, email: true } },
                  drawings: true,
                  replies: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                    include: { author: { select: { name: true, email: true } } },
                  },
                },
              },
              aiSummaries: { orderBy: { createdAt: 'desc' }, take: 1 },
              thumbnails: true,
            },
          },
        },
      }),
    );
    if (!exp) throw new Error(`export ${exportId} not found`);

    await job.updateProgress(20);

    const visibleComments = exp.includeResolved
      ? exp.assetVersion.comments
      : exp.assetVersion.comments.filter((c) => c.status !== 'RESOLVED');

    let body: Buffer;
    let contentType: string;
    let extension: string;

    if (exp.format === 'JSON') {
      body = Buffer.from(
        JSON.stringify(
          {
            project: exp.assetVersion.asset.project,
            asset: { id: exp.assetVersion.asset.id, name: exp.assetVersion.asset.name },
            version: {
              id: exp.assetVersion.id,
              versionNumber: exp.assetVersion.versionNumber,
              reviewStatus: exp.assetVersion.reviewStatus,
            },
            aiSummary: exp.includeAiSummary ? exp.assetVersion.aiSummaries[0]?.payload : null,
            comments: visibleComments,
          },
          null,
          2,
        ),
      );
      contentType = 'application/json';
      extension = 'json';
    } else if (exp.format === 'CSV') {
      const header = ['id', 'timeMs', 'author', 'status', 'body'].join(',');
      const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = visibleComments.map((c) =>
        [
          c.id,
          c.timeMs,
          escape(c.authorDisplayName ?? c.author?.name ?? c.author?.email ?? ''),
          c.status,
          escape(c.body),
        ].join(','),
      );
      body = Buffer.from([header, ...lines].join('\n'));
      contentType = 'text/csv';
      extension = 'csv';
    } else {
      // PDF (default).
      body = await renderReviewPdf({
        project: exp.assetVersion.asset.project,
        assetName: exp.assetVersion.asset.name,
        versionNumber: exp.assetVersion.versionNumber,
        reviewStatus: exp.assetVersion.reviewStatus,
        comments: visibleComments.map((c) => ({
          id: c.id,
          timeMs: c.timeMs,
          frameNumber: c.frameNumber,
          author: c.authorDisplayName ?? c.author?.name ?? c.author?.email ?? 'Reviewer',
          status: c.status,
          body: c.body,
          createdAt: c.createdAt,
          replies: c.replies.map((r) => ({
            author: r.authorDisplayName ?? r.author?.name ?? r.author?.email ?? 'Reviewer',
            body: r.body,
            createdAt: r.createdAt,
          })),
        })),
        aiSummary: exp.includeAiSummary ? exp.assetVersion.aiSummaries[0]?.payload : null,
      });
      contentType = 'application/pdf';
      extension = 'pdf';
    }

    await job.updateProgress(80);

    const key = `exports/${workspaceId}/${exportId}.${extension}`;
    await uploadBuffer('exports', key, body, contentType);

    await withRlsBypass((tx) =>
      tx.reviewExport.update({
        where: { id: exportId },
        data: {
          status: 'READY',
          storageKey: key,
          sizeBytes: BigInt(body.byteLength),
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        },
      }),
    );

    await job.updateProgress(100);
    logger.info({ exportId, bytes: body.byteLength }, 'export done');
  } catch (err) {
    logger.error({ err, exportId }, 'export failed');
    await withRlsBypass((tx) =>
      tx.reviewExport.update({
        where: { id: exportId },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
      }),
    );
    throw err;
  }
}

export function startExportWorker() {
  return new Worker<ExportJob>('review-export', processExport, {
    connection: makeConnection(),
    concurrency: 2,
  });
}
