import { z } from 'zod';

export const Uuid = z.string().uuid();
export const Email = z.string().email().max(254);
export const Url = z.string().url();
export const Slug = z.string().min(2).max(64).regex(/^[a-z0-9-]+$/);

export const Pagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationDto = z.infer<typeof Pagination>;

export const ErrorBody = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ErrorBodyDto = z.infer<typeof ErrorBody>;

export function ok<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data });
}
