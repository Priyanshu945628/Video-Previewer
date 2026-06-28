import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { Public } from '../../common/guards/public.decorator';
import { Permissions, PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequestReviewExportInput } from '@vsp/contracts';
import { ReviewExportsService } from './review-exports.service';
import { SignedUrlService } from '../../common/storage/signed-url.service';
import { S3Service } from '../../common/storage/s3.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('review-exports')
export class ReviewExportsController {
  constructor(
    private readonly svc: ReviewExportsService,
    private readonly signedUrls: SignedUrlService,
    private readonly s3: S3Service,
    private readonly prisma: PrismaService,
  ) {}

  @Post('request')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('asset.read')
  async request(@Req() req: AuthedRequest, @Body(ZodPipe(RequestReviewExportInput)) body: typeof RequestReviewExportInput._type) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.request(req.workspaceId, req.user.id, body) };
  }

  @Get(':id')
  @UseGuards(SessionGuard, PermissionsGuard)
  @Permissions('asset.read')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.get(req.workspaceId, req.user.id, id) };
  }

  @Get(':id/download')
  @Public()
  async download(@Param('id') id: string, @Query('t') token: string, @Res({ passthrough: true }) res: FastifyReply) {
    const v = this.signedUrls.verify(token, { res: 'export' });
    if (!v.ok) throw new ForbiddenException({ code: 'BAD_TOKEN' });
    const e = await this.prisma.reviewExport.findUnique({ where: { id } });
    if (!e?.storageKey) throw new ForbiddenException({ code: 'NOT_READY' });
    const r = await this.s3.getObjectStream('exports', e.storageKey);
    res.header('Content-Type', e.format === 'PDF' ? 'application/pdf' : e.format === 'JSON' ? 'application/json' : 'text/csv');
    res.header('Content-Disposition', `attachment; filename="review-${id}.${e.format.toLowerCase()}"`);
    res.header('Cache-Control', 'no-store');
    return res.send(r.stream);
  }
}
