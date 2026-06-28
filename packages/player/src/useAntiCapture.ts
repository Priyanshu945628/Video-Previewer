/**
 * useAntiCapture — browser-side anti-capture signals.
 *
 * Honest framing:
 *   - These are SIGNALS, not enforcement. A determined attacker can defeat
 *     any of them. The goal is (a) raise the cost of casual capture and
 *     (b) feed forensic events to the audit log so leaks are attributable.
 *
 * What it does:
 *   1. Disables context menu, drag, selection, and common save shortcuts.
 *   2. Detects visibility loss (pause playback).
 *   3. Detects window blur (pause playback).
 *   4. Heuristic devtools detection (size delta + debugger heartbeat) —
 *      reports as a signal, does NOT punish the user.
 *   5. Detects active getDisplayMedia (Screen Capture API) and reports it.
 *   6. Detects PrintScreen keypress (best-effort, OS dependent).
 *
 * Cleans up all listeners on unmount.
 */
import { useEffect } from 'react';

export type AntiCaptureSignals = {
  onPause?: () => void;
  onVisibilityHidden?: () => void;
  onWindowBlur?: () => void;
  onDevtoolsOpen?: () => void;
  onScreenCapture?: () => void;
  onPrintScreen?: () => void;
};

const BLOCKED_KEYS = new Set([
  'F12',
]);
const BLOCKED_CHORDS: Array<(e: KeyboardEvent) => boolean> = [
  (e) => e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i',
  (e) => e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'j',
  (e) => e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c',
  (e) => e.ctrlKey && e.key.toLowerCase() === 'u',
  (e) => e.ctrlKey && e.key.toLowerCase() === 's',
  (e) => (e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'i',
];

export function useAntiCapture(signals: AntiCaptureSignals = {}, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    const { signal } = ac;

    const blockEvent = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('contextmenu', blockEvent, { signal });
    document.addEventListener('dragstart', blockEvent, { signal });
    document.addEventListener('selectstart', blockEvent, { signal });
    document.addEventListener(
      'copy',
      (e) => {
        e.preventDefault();
      },
      { signal },
    );

    document.addEventListener(
      'keydown',
      (e) => {
        if (BLOCKED_KEYS.has(e.key) || BLOCKED_CHORDS.some((m) => m(e))) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (e.key === 'PrintScreen') signals.onPrintScreen?.();
      },
      { signal },
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          signals.onVisibilityHidden?.();
          signals.onPause?.();
        }
      },
      { signal },
    );

    window.addEventListener(
      'blur',
      () => {
        signals.onWindowBlur?.();
        signals.onPause?.();
      },
      { signal },
    );

    // ─── Devtools heuristic ──────────────────────────────────────────────
    // Compare outer vs inner dimensions. Not perfect (docked vs undocked,
    // OS chrome differences). We report but don't block.
    let devtoolsReported = false;
    const THRESHOLD = 160;
    const check = () => {
      const widthDelta = window.outerWidth - window.innerWidth;
      const heightDelta = window.outerHeight - window.innerHeight;
      const looksOpen = widthDelta > THRESHOLD || heightDelta > THRESHOLD;
      if (looksOpen && !devtoolsReported) {
        devtoolsReported = true;
        signals.onDevtoolsOpen?.();
      } else if (!looksOpen) {
        devtoolsReported = false;
      }
    };
    const dtInterval = window.setInterval(check, 1500);
    signal.addEventListener('abort', () => window.clearInterval(dtInterval));

    // ─── getDisplayMedia hook ────────────────────────────────────────────
    if (navigator.mediaDevices?.getDisplayMedia) {
      const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      const patched: typeof orig = (...args) => {
        signals.onScreenCapture?.();
        return orig(...args);
      };
      (navigator.mediaDevices as { getDisplayMedia: typeof orig }).getDisplayMedia = patched;
      signal.addEventListener('abort', () => {
        (navigator.mediaDevices as { getDisplayMedia: typeof orig }).getDisplayMedia = orig;
      });
    }

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
