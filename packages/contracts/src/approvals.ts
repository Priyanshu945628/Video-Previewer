import { z } from 'zod';
import { Uuid } from './common';

export const ApprovalStatus = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']);

export const CreateApprovalInput = z.object({
  versionId: Uuid,
  status: ApprovalStatus,
  note: z.string().max(2000).optional(),
  totp: z.string().length(6).regex(/^\d+$/).optional(),
});
export type CreateApprovalInputDto = z.infer<typeof CreateApprovalInput>;

export const Approval = z.object({
  id: Uuid,
  versionId: Uuid,
  status: ApprovalStatus,
  note: z.string().nullable(),
  approverDisplayName: z.string().nullable(),
  twoFactorVerified: z.boolean(),
  createdAt: z.string().datetime(),
});
