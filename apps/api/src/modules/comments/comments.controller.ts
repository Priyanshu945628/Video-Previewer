import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ShareViewerGuard, type ShareRequest } from '../../common/guards/share-viewer.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { CommentsService } from './comments.service';
import { CreateCommentInput, type CreateCommentInputDto } from '@vsp/contracts';
import { Permissions, PermissionsGuard } from '../../common/guards/permissions.guard';

@Controller()
export class CommentsController {
  constructor(private readonly svc: CommentsService) {}

  // Authenticated reads (within workspace).
  @Get('versions/:id/comments')
  @UseGuards(SessionGuard, PermissionsGuard)
  @Permissions('comment.read')
  async list(@Req() req: AuthedRequest, @Param('id') versionId: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.list(req.workspaceId, req.user.id, versionId) };
  }

  @Post('comments')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('comment.write')
  async create(@Req() req: AuthedRequest, @Body(ZodPipe(CreateCommentInput)) body: CreateCommentInputDto) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return {
      data: await this.svc.create(
        req.workspaceId,
        { kind: 'user', userId: req.user.id, name: req.user.name },
        body,
      ),
    };
  }

  @Post('comments/:id/resolve')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('comment.write')
  async resolve(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.resolve(req.workspaceId, req.user.id, id) };
  }

  @Post('comments/:id/reopen')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('comment.write')
  async reopen(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.reopen(req.workspaceId, req.user.id, id) };
  }

  @Delete('comments/:id')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('comment.write')
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.delete(req.workspaceId, req.user.id, id) };
  }

  @Post('comments/:id/reactions')
  @UseGuards(SessionGuard, CsrfGuard)
  async react(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { emoji: string }) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.react(req.workspaceId, req.user.id, id, body.emoji) };
  }

  // ─── Share-viewer comment posting ───────────────────────────────────────
  @Post('shares/comments')
  @UseGuards(ShareViewerGuard)
  async shareCreate(
    @Req() req: ShareRequest & FastifyRequest,
    @Body(ZodPipe(CreateCommentInput)) body: CreateCommentInputDto,
  ) {
    const v = req.shareViewer!;
    if (!v.allowComments) throw new ForbiddenException({ code: 'COMMENTS_DISABLED' });
    if (v.assetVersionId && v.assetVersionId !== body.assetVersionId) {
      throw new ForbiddenException({ code: 'SHARE_VERSION_MISMATCH' });
    }
    return {
      data: await this.svc.create(
        v.workspaceId,
        { kind: 'share', shareViewId: v.id, name: v.guestName },
        body,
      ),
    };
  }
}
