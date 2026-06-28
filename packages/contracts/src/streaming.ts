import { z } from 'zod';
import { Uuid } from './common';

export const StreamInitInput = z.object({
  versionId: Uuid,
  // Hint only — backend may downgrade based on entitlement.
  preferredQuality: z.enum(['auto', '360p', '720p', '1080p', '4k']).default('auto'),
});

export const StreamInitResult = z.object({
  manifestUrl: z.string().url(), // signed URL to /stream/:vid/manifest.m3u8
  watermarkToken: z.string(),
  posterUrl: z.string().url().nullable(),
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  thumbnailsUrl: z.string().url().nullable(), // sprite sheet, for scrubbing
});
export type StreamInitResultDto = z.infer<typeof StreamInitResult>;

export const PlaybackEventKind = z.enum([
  'STARTED',
  'PROGRESS',
  'PAUSED',
  'RESUMED',
  'SEEKED',
  'QUALITY_CHANGED',
  'FINISHED',
  'ENDED',
]);

export const PlaybackEventInput = z.object({
  sessionId: Uuid,
  kind: PlaybackEventKind,
  currentTimeMs: z.number().int().min(0),
  fromTimeMs: z.number().int().min(0).optional(),
  toTimeMs: z.number().int().min(0).optional(),
  quality: z.string().optional(),
});

export const PlaybackStartInput = z.object({
  versionId: Uuid,
  fingerprintHash: z.string().max(128).optional(),
});

export const PlaybackStartResult = z.object({
  sessionId: Uuid,
});

export const PlaybackEndInput = z.object({
  sessionId: Uuid,
  watchedSeconds: z.number().int().min(0),
  completionPct: z.number().min(0).max(100),
  endReason: z.string().max(40),
  devtoolsDetected: z.boolean().default(false),
  recordingApiDetected: z.boolean().default(false),
});
