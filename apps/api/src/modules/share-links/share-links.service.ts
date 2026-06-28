import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '@vsp/auth';
import { randomSlug, randomToken, sha256Hex } from '@vsp/crypto';
import { env } from '@vsp/config';
import type { CreateShareLinkInputDto } from '@vsp/contracts';

const EXPIRY_MS: Record<string, number | null> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  never: null,
};

@Injectable()
export class ShareLinksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(workspaceId: string, userId: string, dto: CreateShareLinkInputDto) {
    const slug = randomSlug(18);
    const passwordHash = dto.password ? await hashPassword(dto.password) : null;
    const expiresAt = EXPIRY_MS[dto.expiry] === null ? null : new Date(Date.now() + (EXPIRY_MS[dto.expiry] ?? 0));

    const link = await this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.shareLink.create({
        data: {
          workspaceId,
          projectId: dto.projectId,
          assetVersionId: dto.assetVersionId,
          publicSlug: slug,
          passwordHash,
          requireEmail: dto.requireEmail,
          allowComments: dto.allowComments,
          allowDownload: dto.allowDownload,
          expiresAt,
          maxViews: dto.maxViews,
          watermarkTemplate: dto.watermarkTemplate,
          createdById: userId,
        },
      }),
    );

    await this.audit.emit({
      action: 'share.created',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'share_link',
      targetId: link.id,
      metadata: { projectId: dto.projectId, expiry: dto.expiry },
    });

    return {
      ...link,
      url: `${env.APP_URL}/share/${slug}`,
      hasPassword: !!passwordHash,
    };
  }

  list(workspaceId: string, userId: string, projectId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.shareLink.findMany({
        where: { projectId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { views: true } } },
      }),
    );
  }

  async revoke(workspaceId: string, userId: string, id: string) {
    await this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.shareLink.update({ where: { id }, data: { revokedAt: new Date() } }),
    );
    await this.audit.emit({
      action: 'share.revoked',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'share_link',
      targetId: id,
    });
  }

  /** Public gate — verifies password, optional email, mints a viewer token. */
  async gate(input: { slug: string; password?: string; email?: string; name?: string; ip?: string; ua?: string; fingerprintHash?: string }) {
    const link = await this.prisma.shareLink.findUnique({ where: { publicSlug: input.slug } });
    if (!link || link.revokedAt) throw new NotFoundException({ code: 'SHARE_NOT_FOUND' });
    if (link.expiresAt && link.expiresAt < new Date()) throw new ForbiddenException({ code: 'SHARE_EXPIRED' });
    if (link.maxViews && link.viewCount >= link.maxViews) {
      throw new ForbiddenException({ code: 'SHARE_VIEW_LIMIT' });
    }

    if (link.passwordHash) {
      if (!input.password) throw new UnauthorizedException({ code: 'PASSWORD_REQUIRED' });
      const ok = await verifyPassword(input.password, link.passwordHash);
      if (!ok) throw new UnauthorizedException({ code: 'PASSWORD_INVALID' });
    }
    if (link.requireEmail && !input.email) {
      throw new BadRequestException({ code: 'EMAIL_REQUIRED' });
    }

    const viewerToken = randomToken(32);
    const viewerTokenHash = sha256Hex(viewerToken);

    await this.prisma.$transaction([
      this.prisma.shareLinkView.create({
        data: {
          shareLinkId: link.id,
          guestEmail: input.email,
          guestName: input.name,
          ip: input.ip,
          userAgent: input.ua,
          fingerprintHash: input.fingerprintHash,
          viewerTokenHash,
        },
      }),
      this.prisma.shareLink.update({
        where: { id: link.id },
        data: { viewCount: { increment: 1 } },
      }),
    ]);

    await this.audit.emit({
      action: 'share.viewed',
      actor: { kind: 'system', workspaceId: link.workspaceId },
      targetType: 'share_link',
      targetId: link.id,
      metadata: { ip: input.ip, email: input.email },
    });

    return {
      viewerToken,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      needsEmail: false,
      needsPassword: false,
    };
  }
}
