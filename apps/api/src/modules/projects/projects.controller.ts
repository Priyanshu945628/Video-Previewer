import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CreateProjectInput, UpdateProjectInput } from '@vsp/contracts';
import { SessionGuard, type AuthedRequest } from '../../common/guards/session.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProjectsService } from './projects.service';

const ListQuery = z.object({
  archived: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('projects')
@UseGuards(SessionGuard, CsrfGuard)
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Query(ZodPipe(ListQuery)) q: typeof ListQuery._type) {
    if (!req.workspaceId) return { data: [] };
    const rows = await this.svc.list(req.workspaceId, req.user.id, q);
    return { data: rows };
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.get(req.workspaceId, req.user.id, id) };
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Body(ZodPipe(CreateProjectInput)) body: typeof CreateProjectInput._type) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.create(req.workspaceId, req.user.id, body) };
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(ZodPipe(UpdateProjectInput)) body: typeof UpdateProjectInput._type,
  ) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.update(req.workspaceId, req.user.id, req.user.role, id, body) };
  }

  @Delete(':id')
  async archive(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!req.workspaceId) return { data: null };
    return { data: await this.svc.archive(req.workspaceId, req.user.id, id) };
  }
}
