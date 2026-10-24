/* Points of weight for the grade summary (spec §5.4). Pure: no React, no fetch, no DB.
   A category worth W% that averages a% has earned a × W / 100 of its W points. The weight is the raw one, not
   renormalised over graded categories, so a period's points add up toward 100 as its categories get graded. */
import { transmute, type TransmutationTable } from '../transmutation';
import type { CategoryStats } from './projection';

/** Points earned out of a category's raw weight; null when the category has no average. */
export function pointsOf(avg: number | null, weight: number): number | null {
  return avg === null ? null : (avg * Math.max(0, weight)) / 100;
}

export interface PeriodPoints {
  /** Σ avg × weight / 100 over graded categories. */
  earned: number;
  /** Weight of the graded categories (the "of y pts"). */
  gradedWeight: number;
  /** Weight of every category. */
  totalWeight: number;
  /** Percent of the period's weight that is graded (0..100). */
  inShare: number;
}

/** A period's points: graded means n > 0 and weight > 0, the same set projectPeriod's `current` averages over, so
    earned / gradedWeight × 100 is the period's current. */
export function periodPoints(cats: Pick<CategoryStats, 'n' | 'weight' | 'avg'>[]): PeriodPoints {
  let earned = 0, gradedWeight = 0, totalWeight = 0;
  for (const c of cats) {
    const w = Math.max(0, c.weight);
    totalWeight += w;
    if (c.n > 0 && w > 0 && c.avg !== null) { earned += (c.avg * w) / 100; gradedWeight += w; }
  }
  return { earned, gradedWeight, totalWeight, inShare: totalWeight > 0 ? (gradedWeight / totalWeight) * 100 : 0 };
}

const num = (v: number | string): number => (typeof v === 'number' ? v : v.trim() === '' ? NaN : Number(v));

/** A typed raw score as a percent: score / items × 100 (clamped to 0..100), or the transmuted grade when a table is
    given. Null for an incomplete or invalid pair (empty, non-numeric, negative score, items <= 0, missing table cell). */
export function rawPercent(score: number | string, items: number | string, table: TransmutationTable | null): number | null {
  const s = num(score), i = num(items);
  if (!Number.isFinite(s) || !Number.isFinite(i) || s < 0 || i <= 0) return null;
  if (table) return transmute(s, i, table);
  return Math.min(100, (s / i) * 100);
}

export type WhatIfEdit = { kind: 'pct'; text: string } | { kind: 'raw'; score: string; items: string };

/** The what-if overrides (category key -> average) from the typed edits. Only an edit that parses is an override;
    the rest leave their category on its real entries. Values keep full precision; raw pairs follow `table`. */
export function whatIfOverrides(edits: Record<string, WhatIfEdit>, table: TransmutationTable | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, e] of Object.entries(edits)) {
    const v = e.kind === 'pct' ? num(e.text) : rawPercent(e.score, e.items, table);
    if (v !== null && Number.isFinite(v)) out[key] = Math.min(100, Math.max(0, v));
  }
  return out;
}

/** A category weight for display: 40 -> "40", 12.5 -> "12.5", 33.333 -> "33.33". */
export const fmtWeight = (w: number): string => String(Math.round(w * 100) / 100);
