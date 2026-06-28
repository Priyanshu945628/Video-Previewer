import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { ActivityQuery } from '@vsp/contracts';
import { ActivityService } from './activity.service';

@Controller('activity')
@UseGuards(SessionGuard)
export class ActivityController {
  constructor(private readonly svc: ActivityService) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Query(ZodPipe(ActivityQuery)) q: typeof ActivityQuery._type) {
    if (!req.workspaceId) throw new ForbiddenException({ code: 'NO_WORKSPACE' });
    return { data: await this.svc.query(req.workspaceId, req.user.id, q) };
  }
}
