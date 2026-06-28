import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ShareViewerGuard, type ShareRequest } from '../../common/guards/share-viewer.guard';
import { Permissions, PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';
import { CreateApprovalInput, type CreateApprovalInputDto } from '@vsp/contracts';

@Controller()
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  @Post('approvals')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('approval.write')
  async create(@Req() req: AuthedRequest & FastifyRequest, @Body(ZodPipe(CreateApprovalInput)) body: CreateApprovalInputDto) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return {
      data: await this.svc.create(
        req.workspaceId,
        {
          kind: 'user',
          userId: req.user.id,
          name: req.user.name,
          ip: req.session.ip ?? undefined,
          ua: req.session.userAgent ?? undefined,
        },
        body,
      ),
    };
  }

  @Post('shares/approvals')
  @UseGuards(ShareViewerGuard)
  async shareApprove(
    @Req() req: ShareRequest & FastifyRequest,
    @Body(ZodPipe(CreateApprovalInput)) body: CreateApprovalInputDto,
  ) {
    const v = req.shareViewer!;
    // Share-link approvals tied to whether comments are allowed — same trust level.
    if (!v.allowComments) throw new ForbiddenException({ code: 'APPROVALS_DISABLED' });
    if (v.assetVersionId && v.assetVersionId !== body.versionId) {
      throw new ForbiddenException({ code: 'SHARE_VERSION_MISMATCH' });
    }
    return {
      data: await this.svc.create(
        v.workspaceId,
        {
          kind: 'share',
          shareViewId: v.id,
          name: v.guestName,
          ip: req.ip,
          ua: (req.headers['user-agent'] as string) ?? undefined,
        },
        body,
      ),
    };
  }
}
