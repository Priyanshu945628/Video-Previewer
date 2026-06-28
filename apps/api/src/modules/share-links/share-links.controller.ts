import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Res } from '@nestjs/common';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { Permissions, PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { ShareLinksService } from './share-links.service';
import { CreateShareLinkInput, ShareGateInput, type CreateShareLinkInputDto, type ShareGateInputDto } from '@vsp/contracts';
import { env } from '@vsp/config';
import { sha256Hex } from '@vsp/crypto';

const SHARE_COOKIE = 'vsp_share';

@Controller()
export class ShareLinksController {
  constructor(private readonly svc: ShareLinksService) {}

  @Post('share-links')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('share.write')
  async create(@Req() req: AuthedRequest, @Body(ZodPipe(CreateShareLinkInput)) body: CreateShareLinkInputDto) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.create(req.workspaceId, req.user.id, body) };
  }

  @Get('share-links')
  @UseGuards(SessionGuard, PermissionsGuard)
  @Permissions('share.write')
  async list(@Req() req: AuthedRequest, @Query('projectId') projectId: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.list(req.workspaceId, req.user.id, projectId) };
  }

  @Delete('share-links/:id')
  @UseGuards(SessionGuard, CsrfGuard, PermissionsGuard)
  @Permissions('share.write')
  async revoke(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    await this.svc.revoke(req.workspaceId, req.user.id, id);
    return { data: { ok: true } };
  }

  /** Public gate — no auth. Returns either a 200 + viewer token (sets cookie) or a 401 with `needsPassword/needsEmail`. */
  @Post('shares/:slug/gate')
  async gate(
    @Param('slug') slug: string,
    @Body(ZodPipe(ShareGateInput)) body: ShareGateInputDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const fp = req.headers['x-fingerprint'] as string | undefined;
    const result = await this.svc.gate({
      slug,
      password: body.password,
      email: body.email,
      name: body.name,
      ip: req.ip,
      ua: (req.headers['user-agent'] as string) ?? undefined,
      fingerprintHash: fp ? sha256Hex(fp) : undefined,
    });
    // Set a scoped cookie containing the viewer token (paths bound to /api/shares).
    reply.setCookie(SHARE_COOKIE, result.viewerToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/api/shares',
      maxAge: 60 * 60 * 24,
    });
    return { data: { ok: true, expiresAt: result.expiresAt } };
  }
}
