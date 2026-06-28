import { z } from 'zod';
import { Uuid } from './common';

export const ActivityEvent = z.object({
  id: Uuid,
  action: z.string(), // 'project.created' | 'version.uploaded' | 'comment.added' | ...
  actorUserId: Uuid.nullable(),
  actorName: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: Uuid.nullable(),
  metadata: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ActivityEventDto = z.infer<typeof ActivityEvent>;

export const ActivityQuery = z.object({
  workspaceId: Uuid.optional(),
  projectId: Uuid.optional(),
  actorUserId: Uuid.optional(),
  action: z.string().optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const NotificationKind = z.enum([
  'comment.new',
  'comment.reply',
  'version.uploaded',
  'approval.changed',
  'download.approved',
  'share.first_view',
  'share.expiring',
]);

export const Notification = z.object({
  id: Uuid,
  kind: NotificationKind,
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
