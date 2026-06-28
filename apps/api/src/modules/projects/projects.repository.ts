import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Prisma, ProjectStatus } from '@vsp/db';

/**
 * Repository pattern — encapsulates all DB queries for projects.
 * Service layer never reaches into Prisma directly.
 */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, userId: string, opts: { status?: ProjectStatus; limit: number; cursor?: string }) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.project.findMany({
        where: {
          workspaceId,
          status: opts.status,
          archivedAt: opts.status === 'ARCHIVED' ? { not: null } : null,
        },
        orderBy: { updatedAt: 'desc' },
        take: opts.limit + 1,
        ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          clientLabel: true,
          description: true,
          deadline: true,
          status: true,
          watermarkTemplate: true,
          allowDownloadDefault: true,
          aiSummaryEnabled: true,
          ownerId: true,
          createdAt: true,
          updatedAt: true,
          archivedAt: true,
          _count: { select: { assets: true } },
        },
      }),
    );
  }

  findById(workspaceId: string, userId: string, id: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.project.findFirst({
        where: { id, workspaceId },
        include: {
          assets: {
            where: { archivedAt: null },
            orderBy: { createdAt: 'desc' },
            include: {
              versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
            },
          },
        },
      }),
    );
  }

  create(workspaceId: string, userId: string, data: Prisma.ProjectUncheckedCreateInput) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.project.create({ data }),
    );
  }

  update(workspaceId: string, userId: string, id: string, data: Prisma.ProjectUpdateInput) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.project.update({ where: { id }, data }),
    );
  }

  archive(workspaceId: string, userId: string, id: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.project.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      }),
    );
  }
}
