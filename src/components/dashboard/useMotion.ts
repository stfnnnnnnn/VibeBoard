'use client';
import { useEffect, useState } from 'react';

/** True only on the first dashboard view of the session (the page's inline script marks repeat
 *  views with data-db-seen on <html>) and never under reduced motion. False during SSR. */
export function useEntranceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const seen = document.documentElement.hasAttribute('data-db-seen');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const play = !seen && !reduce;
    setOn(play);
    if (!play) return;
    // The inline script never runs on a client-side render, so mark the session here once the
    // entrance (~280ms rise + 4x40ms stagger) and the 600ms count-ups are done. Never synchronously:
    // the attribute disables the running CSS animation. Cleanup marks it too, so unmounting counts.
    const mark = () => document.documentElement.setAttribute('data-db-seen', '');
    const t = window.setTimeout(mark, 700);
    return () => { window.clearTimeout(t); mark(); };
  }, []);
  return on;
}

/** Counts 0 -> target once when `animate` is true (ease-out cubic), else returns target as-is. */
export function useCountUp(target: number, animate: boolean, ms = 600): number {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (!animate) { setValue(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate, ms]);
  return value;
}
