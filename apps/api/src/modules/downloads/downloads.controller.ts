import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ShareViewerGuard, type ShareRequest } from '../../common/guards/share-viewer.guard';
import { Public } from '../../common/guards/public.decorator';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequestDownloadInput } from '@vsp/contracts';
import { DownloadsService } from './downloads.service';

@Controller()
export class DownloadsController {
  constructor(private readonly svc: DownloadsService) {}

  @Post('downloads/request')
  @UseGuards(SessionGuard, CsrfGuard)
  async request(@Req() req: AuthedRequest & FastifyRequest, @Body(ZodPipe(RequestDownloadInput)) body: typeof RequestDownloadInput._type) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return {
      data: await this.svc.requestGrant(
        req.workspaceId,
        { kind: 'user', userId: req.user.id, ip: req.session.ip ?? undefined, ua: req.session.userAgent ?? undefined },
        body.versionId,
      ),
    };
  }

  @Post('shares/downloads/request')
  @UseGuards(ShareViewerGuard)
  async shareRequest(
    @Req() req: ShareRequest & FastifyRequest,
    @Body(ZodPipe(RequestDownloadInput)) body: typeof RequestDownloadInput._type,
  ) {
    const v = req.shareViewer!;
    if (!v.allowDownload) throw new ForbiddenException({ code: 'DOWNLOAD_DISABLED' });
    if (v.assetVersionId && v.assetVersionId !== body.versionId) {
      throw new ForbiddenException({ code: 'SHARE_VERSION_MISMATCH' });
    }
    return {
      data: await this.svc.requestGrant(
        v.workspaceId,
        { kind: 'share', shareViewId: v.id, ip: req.ip, ua: (req.headers['user-agent'] as string) ?? undefined },
        body.versionId,
      ),
    };
  }

  @Get('downloads/:versionId')
  @Public()
  async serve(
    @Param('versionId') versionId: string,
    @Query('t') token: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const r = await this.svc.serve(versionId, token);
    res.header('Content-Type', r.contentType);
    res.header('Content-Length', String(r.length));
    res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(r.filename)}"`);
    res.header('Cache-Control', 'no-store');
    return res.send(r.stream);
  }
}
