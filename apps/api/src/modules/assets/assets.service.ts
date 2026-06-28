import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AssetsRepository } from './assets.repository';
import { UploadsService } from './uploads.service';
import { AuditService } from '../audit/audit.service';
import type { CreateAssetInputDto, AssetKindDto } from '@vsp/contracts';
import { uuid } from '@vsp/crypto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly repo: AssetsRepository,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
    @InjectQueue('transcode') private readonly transcodeQ: Queue,
    @InjectQueue('diff-strip') private readonly diffQ: Queue,
  ) {}

  list(workspaceId: string, userId: string, projectId: string) {
    return this.repo.list(workspaceId, userId, projectId);
  }

  async createAsset(workspaceId: string, userId: string, dto: CreateAssetInputDto) {
    const asset = await this.repo.createAsset(workspaceId, userId, {
      projectId: dto.projectId,
      kind: dto.kind,
      name: dto.name,
      notes: dto.notes,
    });
    await this.audit.emit({
      action: 'asset.created',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'asset',
      targetId: asset.id,
      metadata: { name: asset.name, kind: asset.kind },
    });
    return asset;
  }

  async initUpload(
    workspaceId: string,
    userId: string,
    input: { assetId: string; filename: string; sizeBytes: number; mimeType: string; contentHashSha256?: string },
  ) {
    const projectId = await this.repo.list(workspaceId, userId, '00000000-0000-0000-0000-000000000000')
      .then(() => null)
      .catch(() => null);
    void projectId; // we'll look up via the asset relation in the next step

    // Reserve a version row immediately so the upload key is bound to it.
    const versionNumber = await this.repo.nextVersionNumber(workspaceId, userId, input.assetId);
    const versionId = uuid();
    const key = this.uploads.storageKey(workspaceId, 'proj', input.assetId, versionId, input.filename);
    const uploadId = await this.uploads.initMultipart(key, input.mimeType);

    const version = await this.repo.createVersion(workspaceId, userId, {
      id: versionId,
      assetId: input.assetId,
      versionNumber,
      uploadedById: userId,
      status: 'PROCESSING',
      originalFilename: input.filename,
      originalSizeBytes: BigInt(input.sizeBytes),
      mimeType: input.mimeType,
      originalKey: key,
      contentHashSha256: input.contentHashSha256,
    });

    return { uploadId, key, versionId: version.id, versionNumber };
  }

  async presignPart(key: string, uploadId: string, partNumber: number) {
    return this.uploads.presignPart(key, uploadId, partNumber);
  }

  async completeUpload(
    workspaceId: string,
    userId: string,
    versionId: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    const version = await this.repo.findVersion(workspaceId, userId, versionId);
    if (!version) throw new NotFoundException({ code: 'VERSION_NOT_FOUND' });
    await this.uploads.complete(version.originalKey, uploadId, parts);

    await this.transcodeQ.add(
      'transcode-version',
      {
        workspaceId,
        projectId: version.asset.projectId,
        assetId: version.asset.id,
        versionId: version.id,
        sourceKey: version.originalKey,
      },
      { jobId: `transcode:${version.id}` },
    );

    // If a prior version exists, also queue a diff-strip job — compares last → this.
    if (version.versionNumber > 1) {
      await this.diffQ.add(
        'diff-strip',
        {
          workspaceId,
          assetId: version.asset.id,
          newVersionId: version.id,
        },
        { jobId: `diff:${version.id}` },
      );
    }

    await this.audit.emit({
      action: 'version.uploaded',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'asset_version',
      targetId: version.id,
      metadata: { versionNumber: version.versionNumber },
    });

    return { versionId: version.id };
  }

  async toggleDownload(
    workspaceId: string,
    userId: string,
    role: string,
    versionId: string,
    allow: boolean,
    maxDownloads?: number | null,
  ) {
    if (!['OWNER', 'ADMIN', 'EDITOR'].includes(role)) {
      throw new ForbiddenException({ code: 'ROLE_DENIED' });
    }
    const v = await this.repo.toggleDownload(workspaceId, userId, versionId, allow, maxDownloads);
    await this.audit.emit({
      action: allow ? 'version.download_enabled' : 'version.download_disabled',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'asset_version',
      targetId: versionId,
      metadata: { maxDownloads },
    });
    return v;
  }
}
