/* Deterministic grade projection (spec §4). Pure: no React, no fetch, no DB.
   A period's grade after every remaining item scores x is linear: G(x) = a + b·x. */
import { SCALE_4PT_ROWS, SCALE_1PT_ROWS, type GradeScale } from '@/lib/gradeScale';

export interface CategoryInput {
  key: string;
  name: string;
  weight: number;
  color: string;
  /** Per-entry percentages already earned (transmuted when transmutation is on). */
  graded: number[];
  /** Ungraded entries already in the table, in table order. */
  pendingNames: string[];
  /** User-defined projected items (>= 0). Ignored for singletons. */
  extra: number;
  singleton: boolean;
  /** Singular noun for planned-slot names ("Quiz" -> "Quiz 5"). */
  noun: string;
}

export interface PeriodInput {
  key: string;
  name: string;
  target: number;
  categories: CategoryInput[];
}

export interface CategoryStats extends CategoryInput {
  n: number;
  sum: number;
  k: number;
  avg: number | null;
  /** weight / W over active categories (n + k > 0); 0 when inactive. */
  share: number;
}

export type Tone = 'success' | 'warn' | 'danger' | 'neutral';
export type StatusKind = 'empty' | 'locked-in' | 'achievable' | 'stretch' | 'out-of-reach';
export interface ProjectionStatus { kind: StatusKind; tone: Tone; label: string }

export interface PeriodProjection {
  categories: CategoryStats[];
  a: number;
  b: number;
  /** Graded-only weighted average (spec D11); null when nothing is graded. */
  current: number | null;
  /** Percent of the period's grade already earned (0..100). */
  coverage: number;
  /** Uniform score needed on every remaining item; null when nothing remains. */
  need: number | null;
  worst: number;
  best: number;
  remaining: number;
  status: ProjectionStatus;
}

export interface Threshold { min: number; label: string }

const round1 = (v: number) => Math.round(v * 10) / 10;

function statusOf(need: number | null, current: number | null, target: number): ProjectionStatus {
  if (need === null) {
    if (current === null) return { kind: 'empty', tone: 'neutral', label: 'Nothing to plan' };
    return current >= target
      ? { kind: 'locked-in', tone: 'success', label: 'Locked in' }
      : { kind: 'out-of-reach', tone: 'danger', label: 'Out of reach' };
  }
  if (need <= 0) return { kind: 'locked-in', tone: 'success', label: 'Locked in' };
  if (need <= 85) return { kind: 'achievable', tone: 'success', label: 'Achievable' };
  if (need <= 100) return { kind: 'stretch', tone: 'warn', label: 'Stretch' };
  return { kind: 'out-of-reach', tone: 'danger', label: 'Out of reach' };
}

export function projectPeriod(p: PeriodInput): PeriodProjection {
  const raw = p.categories.map(c => {
    const extra = c.singleton ? 0 : Math.max(0, Math.floor(c.extra));
    const pendingNames = c.singleton ? c.pendingNames.slice(0, c.graded.length ? 0 : 1) : c.pendingNames;
    const n = c.graded.length;
    const sum = c.graded.reduce((s, g) => s + g, 0);
    const k = pendingNames.length + extra;
    return { ...c, extra, pendingNames, n, sum, k, avg: n ? sum / n : null };
  });
  const W = raw.reduce((s, c) => s + (c.n + c.k > 0 ? Math.max(0, c.weight) : 0), 0);
  const categories: CategoryStats[] = raw.map(c => ({
    ...c, share: W > 0 && c.n + c.k > 0 ? Math.max(0, c.weight) / W : 0,
  }));

  let a = 0, b = 0, cov = 0;
  for (const c of categories) {
    if (c.share === 0) continue;
    a += (c.share * c.sum) / (c.n + c.k);
    b += (c.share * c.k) / (c.n + c.k);
    cov += (c.share * c.n) / (c.n + c.k);
  }
  const graded = categories.filter(c => c.n > 0 && c.weight > 0);
  const gw = graded.reduce((s, c) => s + c.weight, 0);
  const current = gw > 0 ? graded.reduce((s, c) => s + c.weight * (c.avg as number), 0) / gw : null;
  const need = b > 1e-12 ? (p.target - a) / b : null;
  return {
    categories, a, b, current, coverage: cov * 100, need,
    worst: a, best: a + b * 100,
    remaining: categories.reduce((s, c) => s + c.k, 0),
    status: statusOf(need, current, p.target),
  };
}

export const gradeAt = (proj: PeriodProjection, x: number): number => proj.a + proj.b * x;

/** Period grade when each category's remaining items score `slots[i]` (one value per remaining item). */
export function planOutcome(proj: PeriodProjection, slots: number[][]): number {
  let t = 0;
  proj.categories.forEach((c, i) => {
    if (c.share === 0) return;
    const extra = (slots[i] ?? []).slice(0, c.k).reduce((s, v) => s + v, 0);
    t += (c.share * (c.sum + extra)) / (c.n + c.k);
  });
  return t;
}

/** Score needed on category i's remaining items if every OTHER remaining item holds the current average. */
export function soloNeed(proj: PeriodProjection, target: number, i: number): number | null {
  const c = proj.categories[i];
  if (!c || c.k === 0 || c.share === 0) return null;
  const P = proj.current ?? target;
  let others = 0;
  proj.categories.forEach((o, j) => {
    if (j === i || o.share === 0) return;
    others += (o.share * (o.sum + o.k * P)) / (o.n + o.k);
  });
  const needAvg = (target - others) / c.share;
  return (needAvg * (c.n + c.k) - c.sum) / c.k;
}

export const SCENARIO_INPUTS = [60, 70, 80, 90, 100] as const;

export function scenarios(proj: PeriodProjection): Array<{ input: number; result: number }> {
  const xs: number[] = [...SCENARIO_INPUTS];
  if (proj.need !== null && proj.need > 0 && proj.need < 100) {
    const nv = round1(proj.need);
    if (!xs.some(x => Math.abs(x - nv) < 0.05)) {
      let idx = 0;
      xs.forEach((x, i) => { if (Math.abs(x - nv) < Math.abs(xs[idx] - nv)) idx = i; });
      xs[idx] = nv;
      xs.sort((p, q) => p - q);
    }
  }
  return xs.map(input => ({ input, result: gradeAt(proj, input) }));
}

/** Letter/point thresholds above 0, highest first. No scale: plain numeric marks. */
export function scaleThresholds(scale: GradeScale | null): Threshold[] {
  if (scale === '4pt') return SCALE_4PT_ROWS.filter(r => r.min > 0).map(r => ({ min: r.min, label: r.letter }));
  if (scale === '1pt') return SCALE_1PT_ROWS.filter(r => r.min > 0).map(r => ({ min: r.min, label: r.point.toFixed(2) }));
  return [90, 80, 70, 60].map(m => ({ min: m, label: String(m) }));
}

/** Up to three thresholds below the target that are still reachable, with the uniform score each needs. */
export function closestReachable(proj: PeriodProjection, target: number, scale: GradeScale | null): Array<Threshold & { need: number }> {
  if (proj.b <= 1e-12) return [];
  return scaleThresholds(scale)
    .filter(t => t.min < target && t.min <= proj.best + 1e-9)
    .slice(0, 3)
    .map(t => ({ ...t, need: (t.min - proj.a) / proj.b }));
}

export function targetPresets(scale: GradeScale | null): Array<{ label: string; value: number }> {
  if (scale === '4pt') return [
    { label: 'A', value: 97 }, { label: 'B+', value: 93 }, { label: 'B', value: 89 },
    { label: 'C+', value: 85 }, { label: 'C', value: 80 }, { label: 'Pass', value: 70 },
  ];
  if (scale === '1pt') return [
    { label: '1.00', value: 96 }, { label: '1.50', value: 92 }, { label: '2.00', value: 87 },
    { label: '2.50', value: 82 }, { label: '3.00', value: 75 },
  ];
  return [90, 85, 80, 75].map(v => ({ label: String(v), value: v }));
}

export function outcomeTone(delta: number): Exclude<Tone, 'neutral'> {
  if (delta >= -0.05) return 'success';
  if (delta >= -3) return 'warn';
  return 'danger';
}

/** The value an untouched sandbox slot shows: the requirement, clamped and rounded. When the target is
    already locked in (need <= 0), slots hold the current average instead of a discouraging 0. */
export function defaultSlotValue(proj: PeriodProjection): number {
  if (proj.need === null) return 100;
  if (proj.need <= 0) return proj.current === null ? 100 : Math.max(0, Math.min(100, round1(proj.current)));
  return Math.max(0, Math.min(100, round1(proj.need)));
}

/** Pooled graded-only average over every category of every period, each at its own weight. */
export function collectiveCurrent(periods: PeriodInput[]): number | null {
  let ws = 0, w = 0;
  for (const p of periods) for (const c of p.categories) {
    if (!c.graded.length || c.weight <= 0) continue;
    ws += c.weight * (c.graded.reduce((s, g) => s + g, 0) / c.graded.length);
    w += c.weight;
  }
  return w > 0 ? ws / w : null;
}

function meanOfCurrents(periods: PeriodInput[]): number | null {
  const cs = periods.map(p => projectPeriod(p).current).filter((v): v is number => v !== null);
  return cs.length ? cs.reduce((s, v) => s + v, 0) / cs.length : null;
}

/** The preset's Final Grade (spec §4.4); null when the preset defines none. */
export function subjectFinal(periods: PeriodInput[], mode: 'average' | 'collective' | null): number | null {
  if (mode === 'collective') return collectiveCurrent(periods);
  if (mode === 'average') return meanOfCurrents(periods);
  return null;
}

/** One number for a subject card: the Final Grade when defined, else the mean of period currents. */
export function subjectOverall(periods: PeriodInput[], mode: 'average' | 'collective' | null): number | null {
  return mode ? subjectFinal(periods, mode) : meanOfCurrents(periods);
}
