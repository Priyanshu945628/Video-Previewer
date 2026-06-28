/**
 * usePlaybackTelemetry — sampled session telemetry.
 *
 * Not per-segment. We emit a small fixed taxonomy of events:
 *   started, progress (every 10s), paused, resumed, seeked,
 *   quality_changed, finished, ended.
 *
 * The shape mirrors `PlaybackEventInput` in @vsp/contracts.
 */
import { useEffect, useRef } from 'react';

export type TelemetryEvent =
  | { kind: 'STARTED'; currentTimeMs: number }
  | { kind: 'PROGRESS'; currentTimeMs: number; quality?: string }
  | { kind: 'PAUSED'; currentTimeMs: number }
  | { kind: 'RESUMED'; currentTimeMs: number }
  | { kind: 'SEEKED'; currentTimeMs: number; fromTimeMs: number; toTimeMs: number }
  | { kind: 'QUALITY_CHANGED'; currentTimeMs: number; quality: string }
  | { kind: 'FINISHED'; currentTimeMs: number }
  | { kind: 'ENDED'; currentTimeMs: number };

export type TelemetrySink = (e: TelemetryEvent) => void;

type Opts = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sink: TelemetrySink;
  progressIntervalMs?: number;
  enabled?: boolean;
};

export function usePlaybackTelemetry({ videoRef, sink, progressIntervalMs = 10_000, enabled = true }: Opts) {
  const lastTimeRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const v = videoRef.current;
    if (!v) return;

    const ms = () => Math.floor(v.currentTime * 1000);

    const onPlay = () => {
      if (!startedRef.current) {
        startedRef.current = true;
        sink({ kind: 'STARTED', currentTimeMs: ms() });
      } else {
        sink({ kind: 'RESUMED', currentTimeMs: ms() });
      }
    };
    const onPause = () => {
      if (!v.ended) sink({ kind: 'PAUSED', currentTimeMs: ms() });
    };
    const onEnded = () => {
      sink({ kind: 'FINISHED', currentTimeMs: ms() });
    };
    const onSeeking = () => {
      lastTimeRef.current = ms();
    };
    const onSeeked = () => {
      const to = ms();
      if (Math.abs(to - lastTimeRef.current) > 750) {
        sink({ kind: 'SEEKED', currentTimeMs: to, fromTimeMs: lastTimeRef.current, toTimeMs: to });
      }
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('seeked', onSeeked);

    const interval = window.setInterval(() => {
      if (!v.paused && !v.ended) {
        sink({ kind: 'PROGRESS', currentTimeMs: ms() });
      }
    }, progressIntervalMs);

    const onPageHide = () => sink({ kind: 'ENDED', currentTimeMs: ms() });
    window.addEventListener('pagehide', onPageHide);

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('seeked', onSeeked);
      window.clearInterval(interval);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled, progressIntervalMs, sink, videoRef]);
}
