import { z } from 'zod';
import { Email, Uuid } from './common';

export const ShareLinkExpiry = z.enum(['1h', '24h', '3d', '7d', '30d', 'never']);

export const CreateShareLinkInput = z.object({
  projectId: Uuid,
  assetVersionId: Uuid.optional(),
  password: z.string().min(8).max(200).optional(),
  requireEmail: z.boolean().default(false),
  allowComments: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  expiry: ShareLinkExpiry.default('7d'),
  maxViews: z.number().int().positive().max(10_000).optional(),
  watermarkTemplate: z.string().max(200).optional(),
});
export type CreateShareLinkInputDto = z.infer<typeof CreateShareLinkInput>;

export const ShareLink = z.object({
  id: Uuid,
  publicSlug: z.string(),
  url: z.string().url(),
  hasPassword: z.boolean(),
  requireEmail: z.boolean(),
  allowComments: z.boolean(),
  allowDownload: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  maxViews: z.number().int().nullable(),
  viewCount: z.number().int(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export const ShareLinkGateInput = z.object({
  slug: z.string().min(8).max(64),
  password: z.string().min(1).optional(),
  email: Email.optional(),
  name: z.string().min(1).max(120).optional(),
});

export const ShareLinkGateResult = z.object({
  viewerToken: z.string(),
  needsEmail: z.boolean(),
  needsPassword: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});

// Convenience re-exports under the controller's preferred names.
export const ShareGateInput = ShareLinkGateInput;
export type ShareGateInputDto = z.infer<typeof ShareGateInput>;
