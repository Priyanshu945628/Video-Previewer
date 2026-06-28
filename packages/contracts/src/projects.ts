import { z } from 'zod';
import { Uuid, Email } from './common';

export const ProjectStatus = z.enum(['ACTIVE', 'ARCHIVED']);

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(160),
  clientLabel: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  deadline: z.coerce.date().optional(),
  watermarkTemplate: z.string().max(200).optional(),
  allowDownloadDefault: z.boolean().default(false),
  requireTwoFactorOnApprove: z.boolean().default(false),
  aiSummaryEnabled: z.boolean().default(false),
});
export type CreateProjectInputDto = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = CreateProjectInput.partial().extend({
  status: ProjectStatus.optional(),
});
export type UpdateProjectInputDto = z.infer<typeof UpdateProjectInput>;

export const Project = z.object({
  id: Uuid,
  name: z.string(),
  clientLabel: z.string().nullable(),
  description: z.string().nullable(),
  deadline: z.string().datetime().nullable(),
  status: ProjectStatus,
  watermarkTemplate: z.string().nullable(),
  allowDownloadDefault: z.boolean(),
  aiSummaryEnabled: z.boolean(),
  ownerId: Uuid,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  counts: z
    .object({
      assets: z.number().int(),
      openComments: z.number().int(),
      pendingReview: z.number().int(),
    })
    .optional(),
});
export type ProjectDto = z.infer<typeof Project>;

export const InviteClientInput = z.object({
  email: Email,
  name: z.string().min(1).max(120).optional(),
  canDownload: z.boolean().default(false),
});
