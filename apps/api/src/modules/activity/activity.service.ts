import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  query(workspaceId: string, userId: string, opts: { projectId?: string; actorUserId?: string; action?: string; since?: Date; until?: Date; cursor?: string; limit: number }) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.auditEvent.findMany({
        where: {
          workspaceId,
          actorUserId: opts.actorUserId,
          action: opts.action,
          createdAt: { gte: opts.since, lte: opts.until },
          // projectId scoping comes via metadata.projectId — denormalized for filter ease
          ...(opts.projectId
            ? {
                OR: [
                  { targetType: 'project', targetId: opts.projectId },
                  { metadata: { path: ['projectId'], equals: opts.projectId } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: opts.limit + 1,
        ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    );
  }
}
