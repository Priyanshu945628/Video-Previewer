import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Prisma } from '@vsp/db';

@Injectable()
export class CommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByVersion(workspaceId: string, userId: string, versionId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.comment.findMany({
        where: { assetVersionId: versionId, deletedAt: null, parentId: null },
        orderBy: { timeMs: 'asc' },
        include: {
          author: { select: { id: true, name: true, image: true, email: true } },
          drawings: true,
          replies: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: {
              author: { select: { id: true, name: true, image: true, email: true } },
              drawings: true,
            },
          },
        },
      }),
    );
  }

  create(workspaceId: string, userId: string | null, data: Prisma.CommentUncheckedCreateInput, drawings: Array<{ svgPath: string; color: string; strokeWidth: number }> = []) {
    return this.prisma.withTenant({ workspaceId, userId: userId ?? undefined }, async (tx) => {
      const c = await tx.comment.create({ data });
      if (drawings.length) {
        await tx.commentDrawing.createMany({
          data: drawings.map((d) => ({
            commentId: c.id,
            svgPath: d.svgPath,
            color: d.color,
            strokeWidth: d.strokeWidth,
          })),
        });
      }
      return c;
    });
  }

  update(workspaceId: string, userId: string, id: string, data: Prisma.CommentUpdateInput) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) => tx.comment.update({ where: { id }, data }));
  }

  softDelete(workspaceId: string, userId: string, id: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.comment.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  react(workspaceId: string, userId: string, commentId: string, emoji: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.commentReaction.upsert({
        where: { commentId_userId_emoji: { commentId, userId, emoji } },
        create: { commentId, userId, emoji },
        update: {},
      }),
    );
  }
}
