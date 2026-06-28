import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { Permissions, PermissionsGuard } from '../../common/guards/permissions.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { AiSummaryService } from './ai-summary.service';
import { RequestAiSummaryInput } from '@vsp/contracts';

@Controller('ai-summary')
@UseGuards(SessionGuard, PermissionsGuard)
export class AiSummaryController {
  constructor(private readonly svc: AiSummaryService) {}

  @Get('versions/:id')
  @Permissions('asset.read')
  async latest(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.latest(req.workspaceId, req.user.id, id) };
  }

  @Post('generate')
  @UseGuards(CsrfGuard)
  @Permissions('asset.write')
  async generate(@Req() req: AuthedRequest, @Body(ZodPipe(RequestAiSummaryInput)) body: typeof RequestAiSummaryInput._type) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.summarize(req.workspaceId, req.user.id, body.versionId, body.refresh) };
  }
}
