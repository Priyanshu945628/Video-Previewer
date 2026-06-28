/**
 * Dynamic forensic watermark — DOM overlay (GPU-accelerated, no canvas).
 *
 * Honest framing:
 *   - Not a defence against piracy.
 *   - A forensic identifier: if a screen recording leaks, the watermark
 *     contains enough identity to attribute it to a session.
 *
 * Defence-in-depth touches:
 *   - Position drifts every 5–8s with a 1.2s ease — recordings can't
 *     reliably mask it without also masking the picture.
 *   - Rendered into a non-interactive, pointer-events:none layer.
 *   - We periodically re-render the text to defeat naive overlay removal
 *     via display:none injection.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type WatermarkProps = {
  /** Final rendered text — already token-substituted by the caller. */
  text: string;
  /** Opacity 0..1 — defaults to 0.18 (visible enough to OCR, light enough to ignore). */
  opacity?: number;
  /** Font size in px. */
  fontSize?: number;
  /** ms between position drifts. */
  driftMs?: number;
};

const POSITIONS = [
  { top: '8%', left: '6%' },
  { top: '12%', right: '6%' },
  { bottom: '14%', left: '8%' },
  { bottom: '10%', right: '10%' },
  { top: '46%', left: '40%' },
  { top: '70%', left: '18%' },
  { top: '24%', left: '55%' },
];

export function Watermark({ text, opacity = 0.18, fontSize = 14, driftMs = 6000 }: WatermarkProps) {
  const [idx, setIdx] = useState(0);
  const tickRef = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      tickRef.current += 1;
      // Pick a non-repeating index
      setIdx((prev) => {
        let next = prev;
        while (next === prev) next = Math.floor(Math.random() * POSITIONS.length);
        return next;
      });
    }, driftMs + Math.floor(Math.random() * 2000));
    return () => window.clearInterval(id);
  }, [driftMs]);

  const pos = POSITIONS[idx] ?? POSITIONS[0]!;

  const style: CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    userSelect: 'none',
    color: '#ffffff',
    opacity,
    fontSize,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontWeight: 500,
    letterSpacing: '0.04em',
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    mixBlendMode: 'difference',
    transition: 'top 1.2s ease, left 1.2s ease, right 1.2s ease, bottom 1.2s ease',
    whiteSpace: 'nowrap',
    zIndex: 5,
    ...pos,
  };

  return (
    <div
      aria-hidden
      data-vsp-wm={tickRef.current}
      style={style}
    >
      {text}
    </div>
  );
}
