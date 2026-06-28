import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3Service } from '../../common/storage/s3.service';
import { SignedUrlService } from '../../common/storage/signed-url.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../common/redis/redis.service';
import { sha256Hex } from '@vsp/crypto';
import { env } from '@vsp/config';
import { rlKey } from '@vsp/auth';

@Injectable()
export class DownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly signedUrls: SignedUrlService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /** Editor flips allowDownload — handled in AssetsService.toggleDownload. */

  /** Client (or share viewer) requests a one-shot download URL. */
  async requestGrant(
    workspaceId: string,
    actor:
      | { kind: 'user'; userId: string; ip?: string; ua?: string }
      | { kind: 'share'; shareViewId: string; ip?: string; ua?: string },
    versionId: string,
  ) {
    if (actor.kind === 'user') {
      if (await this.redis.over(rlKey.download(actor.userId), 10, 60)) {
        throw new ForbiddenException({ code: 'DOWNLOAD_RATE_LIMIT' });
      }
    }

    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      include: { asset: { include: { project: { select: { workspaceId: true } } } }, downloads: true },
    });
    if (!version) throw new NotFoundException({ code: 'VERSION_NOT_FOUND' });
    if (version.asset.project.workspaceId !== workspaceId) throw new ForbiddenException({ code: 'CROSS_TENANT' });
    if (!version.allowDownload) throw new ForbiddenException({ code: 'DOWNLOAD_DISABLED' });

    if (version.maxDownloads && version.downloads.filter((d) => d.status === 'CONSUMED').length >= version.maxDownloads) {
      throw new ForbiddenException({ code: 'DOWNLOAD_LIMIT' });
    }

    // Mint a single-use token. 60s TTL.
    const token = this.signedUrls.issue({
      sub: actor.kind === 'user' ? `user:${actor.userId}` : `share:${actor.shareViewId}`,
      res: 'download',
      params: { vid: versionId },
      ttlSeconds: env.DOWNLOAD_URL_TTL_SECONDS,
    });

    const tokenHash = sha256Hex(token.token);

    await this.prisma.download.create({
      data: {
        assetVersionId: versionId,
        userId: actor.kind === 'user' ? actor.userId : null,
        shareLinkViewId: actor.kind === 'share' ? actor.shareViewId : null,
        tokenHash,
        ip: actor.ip,
        userAgent: actor.ua,
        expiresAt: new Date(token.exp * 1000),
      },
    });

    await this.audit.emit({
      action: 'download.granted',
      actor:
        actor.kind === 'user'
          ? { kind: 'user', userId: actor.userId, workspaceId }
          : { kind: 'share', shareViewId: actor.shareViewId, workspaceId },
      targetType: 'asset_version',
      targetId: versionId,
    });

    const remaining = version.maxDownloads
      ? version.maxDownloads - version.downloads.filter((d) => d.status === 'CONSUMED').length - 1
      : null;

    return {
      url: `${env.API_URL}/downloads/${versionId}?t=${encodeURIComponent(token.token)}`,
      expiresAt: new Date(token.exp * 1000).toISOString(),
      remaining,
    };
  }

  /** Serve the file bytes — verifies + consumes the token, streams from S3. */
  async serve(versionId: string, token: string) {
    const v = this.signedUrls.verify(token, { res: 'download' });
    if (!v.ok) throw new ForbiddenException({ code: 'BAD_TOKEN', message: v.reason });
    const consumed = await this.signedUrls.consume(v.payload);
    if (!consumed) throw new ForbiddenException({ code: 'TOKEN_REPLAY' });

    const tokenHash = sha256Hex(token);
    await this.prisma.download.update({
      where: { tokenHash },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });

    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      select: { originalKey: true, originalFilename: true, mimeType: true, originalSizeBytes: true },
    });
    if (!version) throw new NotFoundException({ code: 'VERSION_NOT_FOUND' });

    const r = await this.s3.getObjectStream('originals', version.originalKey);
    return {
      stream: r.stream,
      contentType: version.mimeType,
      length: Number(version.originalSizeBytes),
      filename: version.originalFilename,
    };
  }
}
