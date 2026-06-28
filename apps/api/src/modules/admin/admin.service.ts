import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Workspace-admin analytics — built off WorkspaceUsage rollups (cheap reads).
 * NOT a platform-superadmin surface; for that we'd add a separate `User.admin`
 * column gated by AdminGuard.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(workspaceId: string, userId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.workspaceUsage.findMany({
        where: { workspaceId, day: { gte: since } },
        orderBy: { day: 'asc' },
      }),
    );
  }

  async members(workspaceId: string, userId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, twoFactorEnabled: true } } },
      }),
    );
  }

  async sessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
  }
}
