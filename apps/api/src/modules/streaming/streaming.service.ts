import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetsRepository } from '../assets/assets.repository';
import { S3Service } from '../../common/storage/s3.service';
import { SignedUrlService } from '../../common/storage/signed-url.service';
import { ManifestRewriter } from './manifest-rewriter';
import { KeyDeliveryService } from './key-delivery.service';
import { AuditService } from '../audit/audit.service';
import { issueWatermark, renderWatermark, sha256Hex } from '@vsp/crypto';
import type { Readable } from 'node:stream';

export type PlaybackIdentity =
  | { kind: 'user'; userId: string; workspaceId: string; email: string; name: string | null }
  | { kind: 'share'; shareViewId: string; workspaceId: string; email: string | null; name: string | null };

@Injectable()
export class StreamingService {
  constructor(
    private readonly assets: AssetsRepository,
    private readonly s3: S3Service,
    private readonly signedUrls: SignedUrlService,
    private readonly rewriter: ManifestRewriter,
    private readonly keys: KeyDeliveryService,
    private readonly audit: AuditService,
  ) {}

  /** Initialize a playback session: returns the signed master-manifest URL + watermark token. */
  async init(identity: PlaybackIdentity, versionId: string, meta: { ip?: string; ua?: string }) {
    const workspaceId = identity.workspaceId;
    const version = await this.assets.findVersionForStreaming(versionId);
    if (!version) throw new NotFoundException({ code: 'VERSION_NOT_FOUND' });
    if (version.asset.project.workspaceId !== workspaceId) {
      throw new ForbiddenException({ code: 'CROSS_TENANT' });
    }
    if (version.status !== 'READY') {
      throw new ForbiddenException({ code: 'VERSION_NOT_READY' });
    }

    const sub = identity.kind === 'user' ? `user:${identity.userId}` : `share:${identity.shareViewId}`;
    const manifestTok = this.signedUrls.issue({
      sub,
      res: 'manifest',
      params: { vid: versionId },
      ttlSeconds: 60,
    });

    const template = version.asset.project.watermarkTemplate ?? '{name} · {email} · {date} {time}';
    const now = new Date();
    const watermarkText = renderWatermark(template, {
      name: identity.name ?? identity.email ?? 'Viewer',
      email: identity.email ?? '',
      ip: meta.ip ?? '',
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 19),
      sessionShort: sha256Hex(sub).slice(0, 6).toUpperCase(),
    });
    const watermarkToken = issueWatermark({
      name: identity.name ?? undefined,
      email: identity.email ?? undefined,
      ip: meta.ip,
      sessionShort: sha256Hex(sub).slice(0, 6),
      issuedAt: Math.floor(Date.now() / 1000),
      template,
    });

    await this.audit.emit({
      action: 'playback.init',
      actor:
        identity.kind === 'user'
          ? { kind: 'user', userId: identity.userId, workspaceId }
          : { kind: 'share', shareViewId: identity.shareViewId, workspaceId },
      targetType: 'asset_version',
      targetId: versionId,
      metadata: { ip: meta.ip },
    });

    return {
      manifestUrl: `/api/stream/${versionId}/manifest.m3u8?t=${encodeURIComponent(manifestTok.token)}`,
      watermarkToken,
      watermarkText,
      posterUrl: version.asset.project ? `/api/stream/${versionId}/poster` : null,
      durationMs: version.durationMs ?? null,
      width: version.width ?? null,
      height: version.height ?? null,
    };
  }

  /** Serve the (rewritten) master manifest. */
  async serveMaster(versionId: string, token: string): Promise<string> {
    const v = this.signedUrls.verify(token, { res: 'manifest' });
    if (!v.ok) throw new ForbiddenException({ code: 'BAD_TOKEN', message: v.reason });
    const sub = v.payload.sub;

    const masterKey = await this.locateMaster(versionId);
    const raw = await this.s3.getText('hls', masterKey);

    const mintSeg = (idx: number) =>
      this.signedUrls.issue({
        sub,
        res: 'segment',
        params: { vid: versionId, idx },
        ttlSeconds: 20,
      }).token;
    const keyTok = this.signedUrls.issue({
      sub,
      res: 'key',
      params: { vid: versionId },
      ttlSeconds: 10,
    }).token;

    return this.rewriter.rewrite(raw, {
      versionId,
      mintToken: mintSeg,
      keyToken: keyTok,
    });
  }

  /** Stream a segment from R2 through us. */
  async serveSegment(
    versionId: string,
    token: string,
    rawPath: string,
  ): Promise<{ stream: Readable; length?: number; contentType?: string }> {
    const v = this.signedUrls.verify(token, { res: 'segment' });
    if (!v.ok) throw new ForbiddenException({ code: 'BAD_TOKEN', message: v.reason });
    if (v.payload.params?.vid !== versionId) {
      throw new ForbiddenException({ code: 'TOKEN_VERSION_MISMATCH' });
    }
    if (rawPath.includes('..') || rawPath.startsWith('/')) {
      throw new ForbiddenException({ code: 'BAD_PATH' });
    }
    const r = await this.s3.getObjectStream('hls', this.segmentKey(versionId, rawPath));
    return { stream: r.stream, length: r.length, contentType: r.contentType ?? 'video/mp2t' };
  }

  /** Serve the AES-128 key bytes (after re-verifying the token). */
  async serveKey(versionId: string, token: string): Promise<Buffer> {
    const v = this.signedUrls.verify(token, { res: 'key' });
    if (!v.ok) throw new ForbiddenException({ code: 'BAD_TOKEN', message: v.reason });
    if (v.payload.params?.vid !== versionId) {
      throw new ForbiddenException({ code: 'TOKEN_VERSION_MISMATCH' });
    }
    return this.keys.deliverHlsKey(versionId);
  }

  private async locateMaster(versionId: string): Promise<string> {
    // The transcode worker stores the full master.m3u8 key on the
    // AssetVersion row (hlsManifestKey) when the rendition pipeline finishes.
    // Convention: hls/<workspaceId>/<assetId>/<versionId>/master.m3u8
    const v = await this.assets.findVersionForStreaming(versionId);
    if (!v?.hlsManifestKey) throw new NotFoundException({ code: 'NO_MANIFEST' });
    return v.hlsManifestKey;
  }

  private segmentKey(versionId: string, sub: string): string {
    // Strip query, keep just the basename + sibling subfolders.
    return `hls/${versionId}/${sub}`;
  }
}
