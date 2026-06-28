import { z } from 'zod';
import { Uuid } from './common';

export const RequestDownloadInput = z.object({
  versionId: Uuid,
});

export const DownloadGrant = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
  remaining: z.number().int().nullable(),
});
export type DownloadGrantDto = z.infer<typeof DownloadGrant>;
