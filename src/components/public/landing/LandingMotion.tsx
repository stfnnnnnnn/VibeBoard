'use client';
import { useEffect } from 'react';

/* Small, dependency-free motion driver for the landing page (spec §8):
   - count-up for [data-countup] (once, 700 ms)
   - ✕ chips nudge toward the centre when they scroll into view (once)
   - the day arc: the sun follows scroll progress through the section; moments light up in order
   - pauses decorative loops while the tab is hidden
   Does nothing under prefers-reduced-motion (CSS already shows the final state). */
export default function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cleanups: (() => void)[] = [];

    document.querySelectorAll<HTMLElement>('[data-countup]').forEach(el => {
      const target = Number(el.dataset.countup);
      const decimals = (el.dataset.countup!.split('.')[1] ?? '').length;
      const start = performance.now();
      let raf = 0;
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / 700);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(decimals);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      el.textContent = (0).toFixed(decimals);
      raf = requestAnimationFrame(step);
      cleanups.push(() => cancelAnimationFrame(raf));
    });

    const x = document.querySelector('[data-xchips]');
    if (x) {
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { x.classList.add('is-in'); io.disconnect(); } }, { threshold: 0.6 });
      io.observe(x);
      cleanups.push(() => io.disconnect());
    }

    const arc = document.querySelector<HTMLElement>('[data-arc]');
    if (arc) {
      const sizePath = () => {
        const w = arc.clientWidth, h = arc.clientHeight;
        const sx = w / 400, sy = h / 200;
        arc.style.setProperty('--sun-path', `path('M0,${180 * sy} C${90 * sx},${20 * sy} ${310 * sx},${20 * sy} ${w},${180 * sy}')`);
      };
      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          const r = arc.getBoundingClientRect();
          const vh = window.innerHeight;
          const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
          arc.style.setProperty('--sun', `${(p * 100).toFixed(1)}%`);
          [0.12, 0.38, 0.62, 0.88].forEach((at, i) => arc.classList.toggle(`is-lit-${i + 1}`, p >= at));
        });
      };
      sizePath(); onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', sizePath);
      cleanups.push(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', sizePath); });
    }

    const vis = () => document.documentElement.classList.toggle('pub-hidden', document.hidden);
    document.addEventListener('visibilitychange', vis);
    cleanups.push(() => document.removeEventListener('visibilitychange', vis));

    return () => cleanups.forEach(f => f());
  }, []);
  return null;
}
