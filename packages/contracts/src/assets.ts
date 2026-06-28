import { z } from 'zod';
import { Uuid } from './common';

export const AssetKind = z.enum([
  'VIDEO',
  'PREMIERE_PROJECT',
  'AE_PROJECT',
  'FONT',
  'LUT',
  'IMAGE',
  'AUDIO_STEM',
  'ZIP_PACKAGE',
  'DOCUMENT',
  'OTHER',
]);
export type AssetKindDto = z.infer<typeof AssetKind>;

export const ReviewStatus = z.enum(['PENDING', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'FINAL']);
export const VersionStatus = z.enum(['PROCESSING', 'READY', 'FAILED']);

export const CreateAssetInput = z.object({
  projectId: Uuid,
  kind: AssetKind,
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
});
export type CreateAssetInputDto = z.infer<typeof CreateAssetInput>;

export const InitUploadInput = z.object({
  assetId: Uuid,
  filename: z.string().min(1).max(255),
  sizeBytes: z.coerce.number().int().positive().max(50 * 1024 ** 3), // 50 GB
  mimeType: z.string().min(1).max(255),
  contentHashSha256: z.string().length(64).optional(),
});

export const InitUploadResult = z.object({
  uploadId: Uuid,
  uploadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  partSize: z.number().int().positive(),
});

export const CompleteUploadInput = z.object({
  uploadId: Uuid,
  etag: z.string().optional(),
});

export const AssetVersion = z.object({
  id: Uuid,
  assetId: Uuid,
  versionNumber: z.number().int(),
  status: VersionStatus,
  reviewStatus: ReviewStatus,
  uploadedById: Uuid,
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fps: z.number().nullable(),
  allowDownload: z.boolean(),
  maxDownloads: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
});
export type AssetVersionDto = z.infer<typeof AssetVersion>;

export const Asset = z.object({
  id: Uuid,
  projectId: Uuid,
  kind: AssetKind,
  name: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  latestVersion: AssetVersion.nullable(),
  versions: z.array(AssetVersion).optional(),
});
export type AssetDto = z.infer<typeof Asset>;

export const ToggleDownloadInput = z.object({
  versionId: Uuid,
  allow: z.boolean(),
  maxDownloads: z.number().int().positive().max(1000).nullable().optional(),
});

export const DiffStripQuery = z.object({
  versionId: Uuid,
  comparedToId: Uuid,
});
