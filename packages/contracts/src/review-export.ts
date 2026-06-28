import { z } from 'zod';
import { Uuid } from './common';

export const ExportFormat = z.enum(['PDF', 'JSON', 'CSV']);
export const ExportStatus = z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED']);

export const RequestReviewExportInput = z.object({
  versionId: Uuid,
  format: ExportFormat.default('PDF'),
  includeResolved: z.boolean().default(true),
  includeDrawings: z.boolean().default(true),
  includeAiSummary: z.boolean().default(true),
});

export const ReviewExport = z.object({
  id: Uuid,
  versionId: Uuid,
  format: ExportFormat,
  status: ExportStatus,
  url: z.string().url().nullable(),
  sizeBytes: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type ReviewExportDto = z.infer<typeof ReviewExport>;
