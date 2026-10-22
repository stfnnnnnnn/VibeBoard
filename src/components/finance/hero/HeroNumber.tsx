'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPeso, splitPeso } from '@/lib/finance/format';
import { DUR, prefersReducedMotion } from '@/lib/workboard/ui/tokens';

/* Counts from the old value to the new one over 240ms when the number changes after a log
   or undo; no count-up on first render (spec §5.2). Screen readers get the final value only.
   A change mid-count (log, then a quick Undo) continues from the number on screen, not from
   the previous target, so the figure never jumps. */
export default function HeroNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    const show = (v: number) => { shownRef.current = v; setShown(v); };
    if (from === value || prefersReducedMotion()) { show(value); return; }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DUR.slow);
      const eased = 1 - Math.pow(1 - p, 3);
      show(p < 1 ? from + (value - from) * eased : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const { whole, cents } = splitPeso(shown);
  return (
    <p className="fin-hero__num fin-num">
      <span className="fin-sr-only">{formatPeso(value)}</span>
      <span aria-hidden>{whole}<span className="fin-hero__cents">{cents}</span></span>
    </p>
  );
}
