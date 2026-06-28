import { Injectable } from '@nestjs/common';
import { CommentsRepository } from './comments.repository';
import { AuditService } from '../audit/audit.service';
import type { CreateCommentInputDto } from '@vsp/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class CommentsService {
  constructor(
    private readonly repo: CommentsRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(workspaceId: string, userId: string, versionId: string) {
    return this.repo.listByVersion(workspaceId, userId, versionId);
  }

  async create(
    workspaceId: string,
    actor: { kind: 'user'; userId: string; name: string | null } | { kind: 'share'; shareViewId: string; name: string | null },
    dto: CreateCommentInputDto,
  ) {
    const c = await this.repo.create(
      workspaceId,
      actor.kind === 'user' ? actor.userId : null,
      {
        assetVersionId: dto.assetVersionId,
        parentId: dto.parentId,
        authorUserId: actor.kind === 'user' ? actor.userId : null,
        authorShareViewId: actor.kind === 'share' ? actor.shareViewId : null,
        authorDisplayName: actor.name,
        body: dto.body,
        timeMs: dto.timeMs,
        frameNumber: dto.frameNumber,
      },
      dto.drawings,
    );

    await this.audit.emit({
      action: 'comment.added',
      actor:
        actor.kind === 'user'
          ? { kind: 'user', userId: actor.userId, workspaceId }
          : { kind: 'share', shareViewId: actor.shareViewId, workspaceId },
      targetType: 'comment',
      targetId: c.id,
      metadata: { versionId: dto.assetVersionId, timeMs: dto.timeMs },
    });

    this.realtime.emitToVersion(dto.assetVersionId, 'comment:new', { commentId: c.id });
    return c;
  }

  async resolve(workspaceId: string, userId: string, commentId: string) {
    const c = await this.repo.update(workspaceId, userId, commentId, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedById: userId,
    });
    await this.audit.emit({
      action: 'comment.resolved',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'comment',
      targetId: commentId,
    });
    this.realtime.emitToVersion(c.assetVersionId, 'comment:resolved', { commentId });
    return c;
  }

  async reopen(workspaceId: string, userId: string, commentId: string) {
    const c = await this.repo.update(workspaceId, userId, commentId, {
      status: 'OPEN',
      resolvedAt: null,
      resolvedById: null,
    });
    this.realtime.emitToVersion(c.assetVersionId, 'comment:reopened', { commentId });
    return c;
  }

  async delete(workspaceId: string, userId: string, commentId: string) {
    const c = await this.repo.softDelete(workspaceId, userId, commentId);
    this.realtime.emitToVersion(c.assetVersionId, 'comment:deleted', { commentId });
    return c;
  }

  react(workspaceId: string, userId: string, commentId: string, emoji: string) {
    return this.repo.react(workspaceId, userId, commentId, emoji);
  }
}
