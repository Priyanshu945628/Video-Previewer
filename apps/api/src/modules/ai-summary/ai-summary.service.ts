import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { LlmProvider } from './llm.provider';
import { sha256Hex } from '@vsp/crypto';
import { env } from '@vsp/config';

const PROMPT_VERSION = '2026-06-28.v1';

@Injectable()
export class AiSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly llm: LlmProvider,
    private readonly audit: AuditService,
  ) {}

  /** Synchronous summary (for under-50-comment cases). Returns cached if available. */
  async summarize(workspaceId: string, userId: string, versionId: string, refresh = false) {
    if (!env.AI_ENABLED) throw new ForbiddenException({ code: 'AI_DISABLED' });

    const comments = await this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.comment.findMany({
        where: { assetVersionId: versionId, deletedAt: null },
        orderBy: { timeMs: 'asc' },
        select: { id: true, body: true, timeMs: true, authorDisplayName: true },
      }),
    );
    if (!comments.length) throw new NotFoundException({ code: 'NO_COMMENTS' });

    const lastCommentTs = Math.max(...comments.map((c) => c.timeMs));
    const cacheKey = sha256Hex(`${versionId}|${lastCommentTs}|${comments.length}|${PROMPT_VERSION}`);

    if (!refresh) {
      const cached = await this.redis.getJson<{ id: string }>(`aisum:${cacheKey}`);
      if (cached) {
        const persisted = await this.prisma.aiSummary.findUnique({ where: { id: cached.id } });
        if (persisted) return persisted;
      }
      const existing = await this.prisma.aiSummary.findUnique({ where: { cacheKey } });
      if (existing) return existing;
    }

    // Enforce per-workspace AI budget.
    const usage = await this.prisma.workspaceUsage.aggregate({
      where: {
        workspaceId,
        day: { gte: new Date(new Date().setDate(1)) },
      },
      _sum: { aiTokensInput: true, aiTokensOutput: true },
    });
    const monthly = (usage._sum.aiTokensInput ?? 0) + (usage._sum.aiTokensOutput ?? 0);
    const cap = (await this.prisma.workspaceLimits.findUnique({ where: { workspaceId } }))?.aiTokenCap ?? env.AI_MONTHLY_TOKEN_CAP;
    if (monthly >= cap) throw new ForbiddenException({ code: 'AI_BUDGET_EXCEEDED' });

    const result = await this.llm.summarize(
      comments.map((c) => ({ id: c.id, timeMs: c.timeMs, body: c.body, authorName: c.authorDisplayName })),
    );

    const persisted = await this.prisma.aiSummary.create({
      data: {
        assetVersionId: versionId,
        provider: result.provider,
        model: result.model,
        promptVersion: PROMPT_VERSION,
        inputCommentCount: comments.length,
        cacheKey,
        payload: result.payload as unknown as object,
        topPriority: result.payload.topPriority,
        tokensInput: result.tokensIn,
        tokensOutput: result.tokensOut,
        costCents: result.costCents,
        status: 'READY',
        createdById: userId,
      },
    });

    await this.redis.setJson(`aisum:${cacheKey}`, { id: persisted.id }, 60 * 60 * 24);

    // Bump usage.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.prisma.workspaceUsage.upsert({
      where: { workspaceId_day: { workspaceId, day: today } },
      create: {
        workspaceId,
        day: today,
        aiTokensInput: result.tokensIn,
        aiTokensOutput: result.tokensOut,
        aiCostCents: result.costCents,
      },
      update: {
        aiTokensInput: { increment: result.tokensIn },
        aiTokensOutput: { increment: result.tokensOut },
        aiCostCents: { increment: result.costCents },
      },
    });

    await this.audit.emit({
      action: 'ai.summary_generated',
      actor: { kind: 'user', userId, workspaceId },
      targetType: 'asset_version',
      targetId: versionId,
      metadata: { tokensIn: result.tokensIn, tokensOut: result.tokensOut },
    });

    return persisted;
  }

  latest(workspaceId: string, userId: string, versionId: string) {
    return this.prisma.withTenant({ workspaceId, userId }, (tx) =>
      tx.aiSummary.findFirst({
        where: { assetVersionId: versionId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }
}
