import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectsRepository } from './projects.repository';
import { AuditService } from '../audit/audit.service';
import type { CreateProjectInputDto, UpdateProjectInputDto } from '@vsp/contracts';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly audit: AuditService,
  ) {}

  list(workspaceId: string, userId: string, opts: { limit: number; cursor?: string; archived?: boolean }) {
    return this.repo.list(workspaceId, userId, {
      limit: opts.limit,
      cursor: opts.cursor,
      status: opts.archived ? 'ARCHIVED' : 'ACTIVE',
    });
  }

  async get(workspaceId: string, userId: string, id: string) {
    const p = await this.repo.findById(workspaceId, userId, id);
    if (!p) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND' });
    return p;
  }

  async create(workspaceId: string, userId: string, dto: CreateProjectInputDto) {
    const p = await this.repo.create(workspaceId, userId, {
      workspaceId,
      ownerId: userId,
      name: dto.name,
      clientLabel: dto.clientLabel,
      description: dto.description,
      deadline: dto.deadline,
      watermarkTemplate: dto.watermarkTemplate,
      allowDownloadDefault: dto.allowDownloadDefault,
      requireTwoFactorOnApprove: dto.requireTwoFactorOnApprove,
      aiSummaryEnabled: dto.aiSummaryEnabled,
    });
    await this.audit.emit({
      action: 'project.created',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'project',
      targetId: p.id,
      metadata: { name: p.name },
    });
    return p;
  }

  async update(
    workspaceId: string,
    userId: string,
    role: string,
    id: string,
    dto: UpdateProjectInputDto,
  ) {
    if (!['OWNER', 'ADMIN', 'EDITOR'].includes(role)) {
      throw new ForbiddenException({ code: 'ROLE_DENIED' });
    }
    const p = await this.repo.update(workspaceId, userId, id, dto);
    await this.audit.emit({
      action: 'project.updated',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'project',
      targetId: id,
      metadata: dto as Record<string, unknown>,
    });
    return p;
  }

  async archive(workspaceId: string, userId: string, id: string) {
    const p = await this.repo.archive(workspaceId, userId, id);
    await this.audit.emit({
      action: 'project.archived',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'project',
      targetId: id,
    });
    return p;
  }
}
