import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { Permissions, PermissionsGuard } from '../../common/guards/permissions.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(SessionGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('usage')
  @Permissions('workspace.admin')
  async usage(@Req() req: AuthedRequest, @Query('days') days?: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.usage(req.workspaceId, req.user.id, days ? Number(days) : 30) };
  }

  @Get('members')
  @Permissions('workspace.admin')
  async members(@Req() req: AuthedRequest) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.members(req.workspaceId, req.user.id) };
  }

  @Get('sessions')
  @Permissions('workspace.admin')
  async sessions(@Req() req: AuthedRequest) {
    return { data: await this.svc.sessions(req.user.id) };
  }
}
