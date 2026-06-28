/**
 * SecurePlayer — custom HLS player.
 *
 *   - Native <video> with hls.js (no canvas — keeps GPU decode, battery)
 *   - DOM overlay watermark (sibling element)
 *   - Custom controls (no native UI)
 *   - Anti-capture signals
 *   - Sampled telemetry callbacks
 *   - Auto-resume from last position via prop
 *   - Quality menu, playback speed, fullscreen, volume
 *
 * The signed manifest URL is provided by the host (api.streamInit).
 * We never construct R2 URLs here.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Hls, { type Level } from 'hls.js';
import { Watermark } from './Watermark';
import { useAntiCapture } from './useAntiCapture';
import { usePlaybackTelemetry, type TelemetryEvent } from './usePlaybackTelemetry';
import { clsx } from 'clsx';

export type PlayerEventHandlers = {
  onTelemetry?: (e: TelemetryEvent) => void;
  onDevtoolsOpen?: () => void;
  onScreenCapture?: () => void;
  onPrintScreen?: () => void;
  onError?: (e: { code: string; message: string }) => void;
};

export type SecurePlayerProps = {
  manifestUrl: string;
  watermarkText: string;
  posterUrl?: string | null;
  resumeAtMs?: number;
  /** Browser autoplays muted unless caller sets autoplay/muted. */
  autoplay?: boolean;
  muted?: boolean;
  className?: string;
  handlers?: PlayerEventHandlers;
  /** Disable controls (for embeds / share viewers with no perms). */
  controls?: boolean;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmt(ts: number): string {
  if (!Number.isFinite(ts)) return '0:00';
  const t = Math.max(0, Math.floor(ts));
  const m = Math.floor(t / 60);
  const s = t % 60;
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function SecurePlayer({
  manifestUrl,
  watermarkText,
  posterUrl,
  resumeAtMs,
  autoplay = false,
  muted = false,
  className,
  handlers,
  controls = true,
}: SecurePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [mutedState, setMuted] = useState(muted);
  const [rate, setRate] = useState(1);
  const [levels, setLevels] = useState<Level[]>([]);
  const [activeLevel, setActiveLevel] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState(false);

  // ─── Set up hls.js or native HLS ────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let hls: Hls | null = null;

    const canNative = v.canPlayType('application/vnd.apple.mpegurl');
    if (canNative && !Hls.isSupported()) {
      v.src = manifestUrl;
    } else if (Hls.isSupported()) {
      hls = new Hls({
        // Critical: hls.js fetches manifest, key, and segments through these URLs.
        // We intentionally use credentialed fetch so our signed-URL middleware
        // can re-authorize each request via session cookie.
        xhrSetup(xhr) {
          xhr.withCredentials = true;
        },
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 10,
      });
      hls.loadSource(manifestUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(hls!.levels);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
        setActiveLevel(d.level);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          handlers?.onError?.({ code: data.type, message: data.details });
        }
      });
      hlsRef.current = hls;
    } else {
      handlers?.onError?.({ code: 'UNSUPPORTED', message: 'HLS is not supported in this browser' });
    }

    return () => {
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [manifestUrl, handlers]);

  // ─── Resume position ────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !resumeAtMs) return;
    const onLoaded = () => {
      try {
        v.currentTime = Math.min(v.duration - 1, resumeAtMs / 1000);
      } catch {
        /* noop */
      }
    };
    v.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [resumeAtMs]);

  // ─── Generic video events ───────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrent(v.currentTime);
    const onDur = () => setDuration(v.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVolume);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVolume);
    };
  }, []);

  // ─── Fullscreen ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ─── Anti-capture wiring ────────────────────────────────────────────────
  useAntiCapture({
    onPause: () => videoRef.current?.pause(),
    onDevtoolsOpen: handlers?.onDevtoolsOpen,
    onScreenCapture: handlers?.onScreenCapture,
    onPrintScreen: handlers?.onPrintScreen,
  });

  // ─── Telemetry ──────────────────────────────────────────────────────────
  const telemetrySink = useCallback(
    (e: TelemetryEvent) => handlers?.onTelemetry?.(e),
    [handlers],
  );
  usePlaybackTelemetry({ videoRef, sink: telemetrySink });

  // ─── Controls ───────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || t, t));
  }, []);

  const changeVolume = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, val));
    if (v.muted) v.muted = false;
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const changeRate = (r: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = r;
    setRate(r);
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) await el.requestFullscreen().catch(() => {});
    else await document.exitFullscreen().catch(() => {});
  };

  const setLevel = (idx: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = idx;
  };

  // ─── Keyboard shortcuts (player-only) ───────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') {
        seek((videoRef.current?.currentTime ?? 0) + 5);
      } else if (e.key === 'ArrowLeft') {
        seek((videoRef.current?.currentTime ?? 0) - 5);
      } else if (e.key === 'f' || e.key === 'F') {
        void toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      } else if (e.key === 'j' || e.key === 'J') {
        seek((videoRef.current?.currentTime ?? 0) - 10);
      } else if (e.key === 'k' || e.key === 'K') {
        toggle();
      } else if (e.key === 'l' || e.key === 'L') {
        seek((videoRef.current?.currentTime ?? 0) + 10);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [seek, toggle]);

  const pct = useMemo(() => (duration > 0 ? (current / duration) * 100 : 0), [current, duration]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={clsx('vsp-player', className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={() => setHover(true)}
      style={{
        position: 'relative',
        background: '#000',
        outline: 'none',
        borderRadius: 12,
        overflow: 'hidden',
        aspectRatio: '16 / 9',
        userSelect: 'none',
      }}
    >
      <video
        ref={videoRef}
        // Native UI disabled — we render our own
        autoPlay={autoplay}
        muted={muted}
        playsInline
        poster={posterUrl ?? undefined}
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        crossOrigin="use-credentials"
        onContextMenu={(e) => e.preventDefault()}
        onClick={toggle}
        onDragStart={(e) => e.preventDefault()}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
      />

      <Watermark text={watermarkText} />

      {controls && (
        <div
          className="vsp-controls"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            opacity: hover || !playing ? 1 : 0,
            transition: 'opacity 180ms ease',
            background:
              'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.2) 30%, rgba(0,0,0,0) 60%)',
            pointerEvents: hover || !playing ? 'auto' : 'none',
            zIndex: 10,
          }}
        >
          <div style={{ padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Scrubber */}
            <div
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={current}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const p = (e.clientX - rect.left) / rect.width;
                seek(p * duration);
              }}
              style={{
                position: 'relative',
                height: 6,
                background: 'rgba(255,255,255,0.18)',
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg,#a78bfa,#ec4899)',
                  borderRadius: 999,
                }}
              />
            </div>

            {/* Buttons row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'white' }}>
              <button
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={toggle}
                style={iconBtn}
              >
                {playing ? '❚❚' : '▶'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button aria-label="Mute" onClick={toggleMute} style={iconBtn}>
                  {mutedState || volume === 0 ? '🔇' : '🔊'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={mutedState ? 0 : volume}
                  onChange={(e) => changeVolume(parseFloat(e.target.value))}
                  style={{ width: 80 }}
                />
              </div>

              <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                {fmt(current)} / {fmt(duration)}
              </div>

              <div style={{ flex: 1 }} />

              {/* Speed */}
              <select
                aria-label="Playback speed"
                value={rate}
                onChange={(e) => changeRate(parseFloat(e.target.value))}
                style={menuStyle}
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>

              {/* Quality */}
              {levels.length > 0 && (
                <select
                  aria-label="Quality"
                  value={activeLevel}
                  onChange={(e) => setLevel(parseInt(e.target.value, 10))}
                  style={menuStyle}
                >
                  <option value={-1}>Auto</option>
                  {levels.map((l, i) => (
                    <option key={i} value={i}>
                      {l.height}p
                    </option>
                  ))}
                </select>
              )}

              <button aria-label="Fullscreen" onClick={() => void toggleFullscreen()} style={iconBtn}>
                {fullscreen ? '⤢' : '⛶'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: 'white',
  fontSize: 18,
  cursor: 'pointer',
  padding: 4,
  lineHeight: 1,
};

const menuStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.16)',
  color: 'white',
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 8,
  cursor: 'pointer',
};
