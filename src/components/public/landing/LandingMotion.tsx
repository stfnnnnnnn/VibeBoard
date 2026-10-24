'use client';
import { useEffect } from 'react';

/* Small, dependency-free motion driver for the landing page (spec §8):
   - count-up for [data-countup] (once, 700 ms)
   - ✕ chips slide in toward the centre when they scroll into view (once)
   - the day arc: the sun follows scroll progress through the section; moments light up in order
   - pauses decorative loops while the tab is hidden
   Does nothing under prefers-reduced-motion (CSS already shows the final state). */
export default function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cleanups: (() => void)[] = [];

    document.querySelectorAll<HTMLElement>('[data-countup]').forEach(el => {
      // Slow hydration: if the card has already been on screen for a while, the visitor has read the server's
      // value, so resetting it to 0 would be a visible flash. Only count up while the card entrance is still young.
      const pop = el.closest('[data-reveal="card"]')?.getAnimations()
        .find((a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === 'pub-pop');
      if (pop && (pop.playState === 'finished' || Number(pop.currentTime ?? 0) > 200)) return;
      const target = Number(el.dataset.countup);
      const decimals = (el.dataset.countup!.split('.')[1] ?? '').length;
      const start = performance.now();
      let raf = 0;
      const step = (t: number) => {
        // rAF's frame timestamp can predate `start`; clamp so the first frame never reads negative (-0.11 was seen).
        const p = Math.min(1, Math.max(0, (t - start) / 700));
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
      // Only arm the 12px offset while the list is still below the fold; chips already on screen at hydration
      // would visibly jump to the offset. Those just fade to 60% when the observer fires.
      if (x.getBoundingClientRect().top >= window.innerHeight) x.classList.add('is-armed');
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { x.classList.add('is-in'); io.disconnect(); } }, { threshold: 0.6 });
      io.observe(x);
      cleanups.push(() => { io.disconnect(); x.classList.remove('is-armed'); });
    }

    const arc = document.querySelector<HTMLElement>('[data-arc]');
    if (arc) {
      const sizePath = () => {
        const w = arc.clientWidth, h = arc.clientHeight;
        const sx = w / 400, sy = h / 200;
        arc.style.setProperty('--sun-path', `path('M0,${180 * sy} C${90 * sx},${20 * sy} ${310 * sx},${20 * sy} ${w},${180 * sy}')`);
      };
      const update = () => {
        const r = arc.getBoundingClientRect();
        const vh = window.innerHeight;
        const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
        arc.style.setProperty('--sun', `${(p * 100).toFixed(1)}%`);
        [0.12, 0.38, 0.62, 0.88].forEach((at, i) => arc.classList.toggle(`is-lit-${i + 1}`, p >= at));
      };
      let raf = 0, resized = false;
      const onScroll = () => {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (resized) { resized = false; sizePath(); } update(); });
      };
      const onResize = () => { resized = true; onScroll(); };
      // Light the moments before arming, so already-passed moments never flash dim (CSS dims only under .is-armed).
      // `is-arming` drops transitions for the first frame, so moments still ahead snap to dim instead of fading from lit.
      sizePath(); update();
      arc.classList.add('is-armed', 'is-arming');
      let arming = requestAnimationFrame(() => { arming = requestAnimationFrame(() => arc.classList.remove('is-arming')); });
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize);
      cleanups.push(() => {
        window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize);
        cancelAnimationFrame(raf); cancelAnimationFrame(arming);
        arc.classList.remove('is-armed', 'is-arming');
      });
    }

    const vis = () => document.documentElement.classList.toggle('pub-hidden', document.hidden);
    document.addEventListener('visibilitychange', vis);
    vis();
    cleanups.push(() => { document.removeEventListener('visibilitychange', vis); document.documentElement.classList.remove('pub-hidden'); });

    return () => cleanups.forEach(f => f());
  }, []);
  return null;
}
