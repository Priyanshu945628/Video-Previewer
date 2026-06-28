import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Prisma } from '@vsp/db';

@Injectable()
export class AssetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, userId: string, projectId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.asset.findMany({
        where: { projectId, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: {
              id: true,
              versionNumber: true,
              status: true,
              reviewStatus: true,
              durationMs: true,
              width: true,
              height: true,
              fps: true,
              allowDownload: true,
              maxDownloads: true,
              createdAt: true,
              processedAt: true,
            },
          },
        },
      }),
    );
  }

  findVersion(workspaceId: string, userId: string, versionId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.assetVersion.findFirst({
        where: { id: versionId },
        include: {
          asset: { include: { project: { select: { id: true, watermarkTemplate: true } } } },
          renditions: true,
          encryptionKey: true,
        },
      }),
    );
  }

  /**
   * RLS-bypass lookup for streaming/key delivery.
   *
   * Why bypass? At this point in the pipeline the SIGNED TOKEN is the
   * authority — it's bound to user/share, version, segment, and expiry.
   * We already verified its signature and freshness. We don't have the
   * caller's session GUC here (this is a fetched-by-the-player request),
   * so we look up the row by id and let the token decide access.
   */
  findVersionForStreaming(versionId: string) {
    return this.prisma.withRlsBypass((tx) =>
      tx.assetVersion.findUnique({
        where: { id: versionId },
        include: {
          asset: {
            include: {
              project: { select: { id: true, workspaceId: true, watermarkTemplate: true } },
            },
          },
          renditions: true,
        },
      }),
    );
  }

  nextVersionNumber(workspaceId: string, userId: string, assetId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, async (tx) => {
      const last = await tx.assetVersion.findFirst({
        where: { assetId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      return (last?.versionNumber ?? 0) + 1;
    });
  }

  createAsset(workspaceId: string, userId: string, data: Prisma.AssetUncheckedCreateInput) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) => tx.asset.create({ data }));
  }

  createVersion(workspaceId: string, userId: string, data: Prisma.AssetVersionUncheckedCreateInput) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.assetVersion.create({ data }),
    );
  }

  toggleDownload(workspaceId: string, userId: string, versionId: string, allow: boolean, maxDownloads: number | null | undefined) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.assetVersion.update({
        where: { id: versionId },
        data: { allowDownload: allow, maxDownloads: maxDownloads ?? null },
      }),
    );
  }
}
