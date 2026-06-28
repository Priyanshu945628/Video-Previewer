import { z } from 'zod';
import { Email } from './common';

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(8).max(200),
  totp: z.string().length(6).regex(/^\d+$/).optional(),
  rememberMe: z.boolean().default(false),
});
export type LoginInputDto = z.infer<typeof LoginInput>;

export const SignupInput = z.object({
  email: Email,
  password: z
    .string()
    .min(12, 'minimum 12 characters')
    .max(200)
    .refine((p) => /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p), {
      message: 'must include upper, lower, digit',
    }),
  name: z.string().min(1).max(120),
  workspaceName: z.string().min(2).max(120),
  inviteToken: z.string().optional(),
});
export type SignupInputDto = z.infer<typeof SignupInput>;

export const MagicLinkInput = z.object({ email: Email });
export type MagicLinkInputDto = z.infer<typeof MagicLinkInput>;

export const EnrollTotpInput = z.object({ password: z.string().min(8) });
export const VerifyTotpInput = z.object({
  code: z.string().length(6).regex(/^\d+$/),
  secretId: z.string().uuid(),
});

export const SessionUser = z.object({
  id: z.string().uuid(),
  email: Email,
  name: z.string().nullable(),
  image: z.string().nullable(),
  workspaceId: z.string().uuid().nullable(),
  role: z.enum(['OWNER', 'ADMIN', 'EDITOR', 'COLLABORATOR', 'CLIENT']),
  twoFactorEnabled: z.boolean(),
});
export type SessionUserDto = z.infer<typeof SessionUser>;
