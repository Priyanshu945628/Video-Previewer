import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sha256Hex } from '@vsp/crypto';

export interface ShareRequest {
  shareViewer?: {
    id: string;
    shareLinkId: string;
    projectId: string;
    workspaceId: string;
    assetVersionId: string | null;
    allowComments: boolean;
    allowDownload: boolean;
    guestEmail: string | null;
    guestName: string | null;
  };
  cookies: Record<string, string>;
}

/**
 * Validates the opaque viewer token issued by /share/gate. Token is stored
 * as `vsp.share` HttpOnly cookie; we look up its sha256 in share_link_views.
 */
@Injectable()
export class ShareViewerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ShareRequest>();
    const token = req.cookies?.['vsp.share'];
    if (!token) throw new UnauthorizedException({ code: 'NO_SHARE_TOKEN', message: 'Share session required.' });

    const tokenHash = sha256Hex(token);
    const view = await this.prisma.shareLinkView.findUnique({
      where: { viewerTokenHash: tokenHash },
      include: {
        shareLink: {
          select: {
            id: true,
            projectId: true,
            workspaceId: true,
            assetVersionId: true,
            allowComments: true,
            allowDownload: true,
            revokedAt: true,
            expiresAt: true,
            maxViews: true,
            viewCount: true,
          },
        },
      },
    });
    if (!view || view.revokedAt) throw new UnauthorizedException({ code: 'SHARE_REVOKED' });
    const link = view.shareLink;
    if (link.revokedAt) throw new UnauthorizedException({ code: 'SHARE_REVOKED' });
    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'SHARE_EXPIRED' });
    }
    if (link.maxViews && link.viewCount >= link.maxViews) {
      throw new UnauthorizedException({ code: 'SHARE_VIEW_LIMIT' });
    }

    req.shareViewer = {
      id: view.id,
      shareLinkId: link.id,
      projectId: link.projectId,
      workspaceId: link.workspaceId,
      assetVersionId: link.assetVersionId,
      allowComments: link.allowComments,
      allowDownload: link.allowDownload,
      guestEmail: view.guestEmail,
      guestName: view.guestName,
    };
    return true;
  }
}
