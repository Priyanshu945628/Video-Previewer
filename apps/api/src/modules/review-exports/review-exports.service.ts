import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SignedUrlService } from '../../common/storage/signed-url.service';
import { AuditService } from '../audit/audit.service';
import { env } from '@vsp/config';

@Injectable()
export class ReviewExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signedUrls: SignedUrlService,
    private readonly audit: AuditService,
    @InjectQueue('review-export') private readonly queue: Queue,
  ) {}

  async request(
    workspaceId: string,
    userId: string,
    input: { versionId: string; format: 'PDF' | 'JSON' | 'CSV'; includeResolved: boolean; includeDrawings: boolean; includeAiSummary: boolean },
  ) {
    const exp = await this.prisma.reviewExport.create({
      data: {
        assetVersionId: input.versionId,
        requestedById: userId,
        format: input.format,
        includeResolved: input.includeResolved,
        includeDrawings: input.includeDrawings,
        includeAiSummary: input.includeAiSummary,
        status: 'QUEUED',
      },
    });
    await this.queue.add('build', { exportId: exp.id, workspaceId, userId }, { jobId: `export:${exp.id}` });
    await this.audit.emit({
      action: 'review.export_requested',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'review_export',
      targetId: exp.id,
      metadata: { format: input.format },
    });
    return exp;
  }

  async get(workspaceId: string, userId: string, id: string) {
    const e = await this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.reviewExport.findFirst({ where: { id } }),
    );
    if (!e) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND' });

    let url: string | null = null;
    if (e.status === 'READY' && e.storageKey) {
      const tok = this.signedUrls.issue({
        sub: `user:${userId}`,
        res: 'export',
        params: { id: e.id },
        ttlSeconds: 600,
      });
      url = `${env.API_URL}/review-exports/${e.id}/download?t=${encodeURIComponent(tok.token)}`;
    }
    return { ...e, url };
  }
}
