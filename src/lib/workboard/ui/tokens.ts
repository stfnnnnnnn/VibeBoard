/** TS mirror of the motion and context tokens in src/app/workboard/workboard.css, for the few
 *  places that need them in code (timers, inline transforms). Pool-free: safe in client bundles. */
import type { WorkContext } from '@/lib/workboard/workContexts';

export const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

export const DUR = { fast: 120, base: 180, slow: 240 } as const;

/** Fill and text pairs, verbatim from color.ts's ratified context pairs. */
export const CONTEXT_FILL: Record<WorkContext, string> = {
  academic: '#4dabf5', project: '#8b7fd6', organization: '#f0a35c', life: '#f2a7c0',
};
export const CONTEXT_TEXT: Record<WorkContext, string> = {
  academic: '#185a7d', project: '#4f3fa0', organization: '#8a5010', life: '#8a4468',
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
