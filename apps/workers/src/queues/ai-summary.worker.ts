/**
 * AI summary worker — async fallback for the synchronous endpoint.
 *
 * The API endpoint runs the LLM inline because typical comment threads
 * (<50 comments) complete in 2-4s and editors expect immediacy. When a
 * thread crosses a configured threshold OR the editor flips
 * `autoSummary` on a project, we enqueue here so the API stays snappy.
 *
 * Cache key + dedupe semantics match the API service — re-running an
 * unchanged thread is a no-op via `aiSummary.findUnique({cacheKey})`.
 */
import { Worker, type Job } from 'bullmq';
import { createLogger } from '@vsp/logger';
import { prisma, withRlsBypass } from '@vsp/db';
import { env } from '@vsp/config';
import { sha256Hex } from '@vsp/crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AiSummaryPayload } from '@vsp/contracts';
import { makeConnection } from '../lib/connection';

const logger = createLogger('worker:ai');
const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const PROMPT_VERSION = '2026-06-28.v1';

interface AiJob {
  workspaceId: string;
  versionId: string;
  userId: string | null;
}

const TOOL = {
  name: 'submit_review_summary',
  description: 'Submit the structured review summary.',
  input_schema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              enum: ['voiceover', 'color', 'editing', 'graphics', 'audio', 'pacing', 'other'],
            },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  timestamps: { type: 'array', items: { type: 'string' } },
                  commentIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary', 'timestamps', 'commentIds'],
              },
            },
          },
          required: ['name', 'priority', 'issues'],
        },
      },
      topPriority: { type: 'string' },
      duplicateClusters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commentIds: { type: 'array', items: { type: 'string' } },
            theme: { type: 'string' },
          },
          required: ['commentIds', 'theme'],
        },
      },
    },
    required: ['categories', 'topPriority'],
  },
};

const SYSTEM = `You are a senior video post-production lead. You will receive a chronological list of client review comments on a video cut. Group them into editing categories (voiceover, color, editing, graphics, audio, pacing, other), assess priority (high|medium|low) per category, and identify clusters of comments that all suggest the same fix. Be terse. Output the JSON schema via the provided tool. Do not include filler text.`;

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export async function processAiSummary(job: Job<AiJob>) {
  const { workspaceId, versionId, userId } = job.data;
  if (!anthropic) {
    logger.warn({ versionId }, 'ANTHROPIC_API_KEY unset; skipping');
    return;
  }

  const comments = await prisma.comment.findMany({
    where: { assetVersionId: versionId, deletedAt: null },
    orderBy: { timeMs: 'asc' },
    select: { id: true, body: true, timeMs: true, authorDisplayName: true },
  });
  if (!comments.length) {
    logger.info({ versionId }, 'no comments, skipping');
    return;
  }

  const lastTs = Math.max(...comments.map((c) => c.timeMs));
  const cacheKey = sha256Hex(`${versionId}|${lastTs}|${comments.length}|${PROMPT_VERSION}`);

  // Idempotency — skip if a row with the same cache key already exists.
  const existing = await prisma.aiSummary.findUnique({ where: { cacheKey } });
  if (existing) {
    logger.info({ versionId, cacheKey }, 'cache hit, skip');
    return;
  }

  const transcript = comments
    .map((c) => `[id=${c.id}] [${fmt(c.timeMs)}] ${c.authorDisplayName ?? 'Reviewer'}: ${c.body}`)
    .join('\n');

  const r = await anthropic.messages.create({
    model: env.AI_DEFAULT_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_review_summary' },
    messages: [{ role: 'user', content: `Comments:\n${transcript}` }],
  });

  const tool = r.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!tool) throw new Error('LLM did not call submit_review_summary');
  const payload = AiSummaryPayload.parse(tool.input);

  const tokensIn = r.usage.input_tokens;
  const tokensOut = r.usage.output_tokens;
  // Sonnet 4.6 illustrative pricing: $3 / M in, $15 / M out → centi-cents per token.
  const costCents = Math.ceil((tokensIn * 0.3) / 1000 + (tokensOut * 1.5) / 1000);

  await withRlsBypass(async (tx) => {
    await tx.aiSummary.create({
      data: {
        assetVersionId: versionId,
        provider: env.AI_PROVIDER,
        model: env.AI_DEFAULT_MODEL,
        promptVersion: PROMPT_VERSION,
        inputCommentCount: comments.length,
        cacheKey,
        payload: payload as unknown as object,
        topPriority: payload.topPriority,
        tokensInput: tokensIn,
        tokensOutput: tokensOut,
        costCents,
        status: 'READY',
        createdById: userId,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await tx.workspaceUsage.upsert({
      where: { workspaceId_day: { workspaceId, day: today } },
      create: {
        workspaceId,
        day: today,
        aiTokensInput: tokensIn,
        aiTokensOutput: tokensOut,
        aiCostCents: costCents,
      },
      update: {
        aiTokensInput: { increment: tokensIn },
        aiTokensOutput: { increment: tokensOut },
        aiCostCents: { increment: costCents },
      },
    });
  });

  logger.info({ versionId, tokensIn, tokensOut, costCents }, 'ai summary done');
}

export function startAiSummaryWorker() {
  return new Worker<AiJob>('ai-summary', processAiSummary, {
    connection: makeConnection(),
    concurrency: 4,
  });
}
