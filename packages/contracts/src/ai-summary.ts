import { z } from 'zod';
import { Uuid } from './common';

export const AiPriority = z.enum(['high', 'medium', 'low']);
export const AiCategory = z.enum([
  'voiceover',
  'color',
  'editing',
  'graphics',
  'audio',
  'pacing',
  'other',
]);

export const AiIssue = z.object({
  summary: z.string().min(1).max(500),
  timestamps: z.array(z.string()),
  commentIds: z.array(Uuid),
});

export const AiCategoryGroup = z.object({
  name: AiCategory,
  priority: AiPriority,
  issues: z.array(AiIssue),
});

export const AiSummaryPayload = z.object({
  categories: z.array(AiCategoryGroup),
  topPriority: z.string().min(1).max(500),
  duplicateClusters: z
    .array(z.object({ commentIds: z.array(Uuid), theme: z.string() }))
    .default([]),
});
export type AiSummaryPayloadDto = z.infer<typeof AiSummaryPayload>;

export const AiSummaryStatus = z.enum(['PENDING', 'READY', 'FAILED']);

export const AiSummary = z.object({
  id: Uuid,
  assetVersionId: Uuid,
  status: AiSummaryStatus,
  provider: z.string(),
  model: z.string(),
  payload: AiSummaryPayload.nullable(),
  topPriority: z.string().nullable(),
  inputCommentCount: z.number().int(),
  tokensInput: z.number().int(),
  tokensOutput: z.number().int(),
  costCents: z.number().int(),
  createdAt: z.string().datetime(),
});

export const RequestAiSummaryInput = z.object({
  versionId: Uuid,
  refresh: z.boolean().default(false),
});
