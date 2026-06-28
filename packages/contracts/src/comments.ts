import { z } from 'zod';
import { Uuid } from './common';

export const CommentStatus = z.enum(['OPEN', 'RESOLVED']);

export const CommentDrawing = z.object({
  id: Uuid.optional(),
  svgPath: z.string().max(20_000), // normalized 0..1 coords
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  strokeWidth: z.number().min(0.1).max(40),
});

export const CreateCommentInput = z.object({
  assetVersionId: Uuid,
  parentId: Uuid.optional(),
  body: z.string().min(1).max(4000),
  timeMs: z.number().int().min(0),
  frameNumber: z.number().int().min(0).optional(),
  drawings: z.array(CommentDrawing).max(20).optional(),
});
export type CreateCommentInputDto = z.infer<typeof CreateCommentInput>;

export const UpdateCommentInput = z.object({
  body: z.string().min(1).max(4000).optional(),
  status: CommentStatus.optional(),
});

export const Comment = z.object({
  id: Uuid,
  assetVersionId: Uuid,
  parentId: Uuid.nullable(),
  authorUserId: Uuid.nullable(),
  authorDisplayName: z.string().nullable(),
  body: z.string(),
  timeMs: z.number().int(),
  frameNumber: z.number().int().nullable(),
  status: CommentStatus,
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
  drawings: z.array(CommentDrawing.extend({ id: Uuid })).optional(),
  replies: z.array(z.lazy(() => Comment)).optional(),
});
export type CommentDto = z.infer<typeof Comment>;

export const CreateMarkerInput = z.object({
  assetVersionId: Uuid,
  label: z.string().min(1).max(120),
  timeMs: z.number().int().min(0),
  endTimeMs: z.number().int().min(0).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const ReactInput = z.object({
  commentId: Uuid,
  emoji: z.string().min(1).max(8),
});
