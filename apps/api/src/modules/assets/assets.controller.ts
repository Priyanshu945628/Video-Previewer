import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CreateAssetInput } from '@vsp/contracts';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { AssetsService } from './assets.service';

const InitUploadInput = z.object({
  assetId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1).max(127),
  contentHashSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
const PresignPartInput = z.object({
  key: z.string().min(1),
  uploadId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10_000),
});
const CompleteUploadInput = z.object({
  versionId: z.string().uuid(),
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ ETag: z.string(), PartNumber: z.number().int().min(1) }))
    .min(1)
    .max(10_000),
});
const DownloadToggleInput = z.object({
  allow: z.boolean(),
  maxDownloads: z.number().int().min(1).max(10_000).nullable().optional(),
});

@Controller('assets')
@UseGuards(SessionGuard, CsrfGuard)
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query('projectId') projectId: string) {
    if (!req.workspaceId) return { data: [] };
    return this.svc.list(req.workspaceId, req.user.id, projectId).then((data) => ({ data }));
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Body(ZodPipe(CreateAssetInput)) body: typeof CreateAssetInput._type) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.createAsset(req.workspaceId, req.user.id, body) };
  }

  @Post('upload/init')
  async initUpload(@Req() req: AuthedRequest, @Body(ZodPipe(InitUploadInput)) body: typeof InitUploadInput._type) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.initUpload(req.workspaceId, req.user.id, body) };
  }

  @Post('upload/part')
  async presignPart(@Body(ZodPipe(PresignPartInput)) body: typeof PresignPartInput._type) {
    return { data: await this.svc.presignPart(body.key, body.uploadId, body.partNumber) };
  }

  @Post('upload/complete')
  async complete(@Req() req: AuthedRequest, @Body(ZodPipe(CompleteUploadInput)) body: typeof CompleteUploadInput._type) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.completeUpload(req.workspaceId, req.user.id, body.versionId, body.uploadId, body.parts) };
  }

  @Patch('versions/:id/download')
  async toggleDownload(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(ZodPipe(DownloadToggleInput)) body: typeof DownloadToggleInput._type,
  ) {
    if (!req.workspaceId) return { data: null };
    return {
      data: await this.svc.toggleDownload(
        req.workspaceId,
        req.user.id,
        req.user.role,
        id,
        body.allow,
        body.maxDownloads,
      ),
    };
  }
}
