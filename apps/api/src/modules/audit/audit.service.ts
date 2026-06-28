import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { currentContext, createLogger } from '@vsp/logger';

const log = createLogger('audit');

export type AuditActor =
  | { kind: 'user'; userId: string; workspaceId: string | null }
  | { kind: 'share'; shareViewId: string; workspaceId: string }
  | { kind: 'system'; workspaceId?: string };

export interface AuditInput {
  action: string;
  actor: AuditActor;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write append-only audit_events. The Postgres `audit_link_hash` trigger
 * computes a SHA-256 hash chained from the previous row for this workspace,
 * so tampering is detectable.
 *
 * Writes require `app.bypass_rls = on`, set by withRlsBypass().
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(input: AuditInput): Promise<void> {
    const ctx = currentContext();
    const workspaceId =
      input.actor.kind === 'user' || input.actor.kind === 'share' || input.actor.kind === 'system'
        ? input.actor.workspaceId ?? null
        : null;
    try {
      await this.prisma.withRlsBypass(async (tx) => {
        await tx.auditEvent.create({
          data: {
            workspaceId,
            actorUserId: input.actor.kind === 'user' ? input.actor.userId : null,
            actorShareViewId: input.actor.kind === 'share' ? input.actor.shareViewId : null,
            action: input.action,
            targetType: input.targetType ?? null,
            targetId: input.targetId ?? null,
            ip: ctx.ip ?? null,
            userAgent: null,
            metadata: input.metadata ?? null,
            // hash is filled by audit_link_hash trigger; we pass a sentinel
            // that the trigger overwrites.
            hash: 'pending',
          },
        });
      });
    } catch (e) {
      // Never fail the caller on audit write — log loudly instead.
      log.error({ err: e, action: input.action }, 'audit write failed');
    }
  }
}
