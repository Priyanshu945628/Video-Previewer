import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { verifyTotp } from '@vsp/auth';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { CreateApprovalInputDto, ApprovalStatus } from '@vsp/contracts';

const REVIEW_TO_VERSION: Record<ApprovalStatus, 'APPROVED' | 'CHANGES_REQUESTED' | 'CHANGES_REQUESTED'> = {
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  REJECTED: 'CHANGES_REQUESTED',
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(
    workspaceId: string,
    actor:
      | { kind: 'user'; userId: string; name: string | null; ip?: string; ua?: string }
      | { kind: 'share'; shareViewId: string; name: string | null; ip?: string; ua?: string },
    dto: CreateApprovalInputDto,
  ) {
    // If the project requires 2FA for approval, verify here.
    let twoFactorVerified = false;
    if (actor.kind === 'user') {
      const version = await this.prisma.assetVersion.findUnique({
        where: { id: dto.versionId },
        include: { asset: { include: { project: { select: { requireTwoFactorOnApprove: true } } } } },
      });
      if (version?.asset.project.requireTwoFactorOnApprove) {
        if (!dto.totp) throw new BadRequestException({ code: 'TWO_FACTOR_REQUIRED' });
        const auth = await this.prisma.authenticator.findFirst({
          where: { userId: actor.userId, kind: 'TOTP' },
        });
        if (!auth?.secretCipher) throw new ForbiddenException({ code: 'NO_TOTP_ENROLLED' });
        const ok = await verifyTotp(
          { kekId: 'local-master', ciphertext: Buffer.from(auth.secretCipher) },
          dto.totp,
        );
        if (!ok) throw new ForbiddenException({ code: 'TWO_FACTOR_INVALID' });
        twoFactorVerified = true;
      }
    }

    return this.prisma.withTenant({ workspaceId, userId: actor.kind === 'user' ? actor.userId : undefined }, async (tx) => {
      const approval = await tx.approval.create({
        data: {
          assetVersionId: dto.versionId,
          approverUserId: actor.kind === 'user' ? actor.userId : null,
          approverShareViewId: actor.kind === 'share' ? actor.shareViewId : null,
          approverDisplayName: actor.name,
          status: dto.status,
          note: dto.note,
          ip: actor.ip,
          userAgent: actor.ua,
          twoFactorVerified,
        },
      });
      await tx.assetVersion.update({
        where: { id: dto.versionId },
        data: { reviewStatus: REVIEW_TO_VERSION[dto.status] },
      });

      await this.audit.emit({
        action: `approval.${dto.status.toLowerCase()}`,
        actor:
          actor.kind === 'user'
            ? { kind: 'user', userId: actor.userId, workspaceId }
            : { kind: 'share', shareViewId: actor.shareViewId, workspaceId },
        targetType: 'asset_version',
        targetId: dto.versionId,
        metadata: { note: dto.note, twoFactorVerified },
      });

      this.realtime.emitToVersion(dto.versionId, 'approval:changed', { status: dto.status });
      return approval;
    });
  }
}
