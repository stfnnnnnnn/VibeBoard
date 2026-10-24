/* Linked lecture + lab subjects (spec §3.5). Pure. */
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow, FinalMode, PresetLike } from './types';
import { buildCustomPeriods } from './periodModel';
import { projectPeriod } from './projection';
import { EMPTY_PREFS } from './prefs';

export function combinePeriod(lec: number | null, lab: number | null, lectureWeight: number): number | null {
  if (lec == null && lab == null) return null;
  if (lab == null) return lec; if (lec == null) return lab;
  return lec * lectureWeight / 100 + lab * (100 - lectureWeight) / 100;
}
export function combinePeriods(lecs: (number | null)[], labs: (number | null)[], w: number): (number | null)[] {
  return lecs.map((l, i) => combinePeriod(l, labs[i] ?? null, w));
}
const norm = (s: string) => s.trim().toLowerCase();
export function periodNamesMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((n, i) => norm(n) === norm(b[i]));
}

/** A final rule (same semantics as projection's subjectOverall) applied to already-computed period
    currents: 'period' picks the final period's value, otherwise the mean of the non-null currents. */
export function overallOfCurrents(
  currents: (number | null)[], keys: string[], mode: FinalMode | null, finalPeriodKey: string | null,
): number | null {
  if (mode === 'period') { const i = keys.indexOf(finalPeriodKey ?? ''); return i >= 0 ? currents[i] ?? null : null; }
  const cs = currents.filter((v): v is number => v != null);
  return cs.length ? cs.reduce((s, v) => s + v, 0) / cs.length : null;
}

export type LinkEntry = Pick<EntryRow, 'name' | 'score' | 'items' | 'grade'>;

/** A subject's period currents from its preset and entries, transmuted when `table` is given. The partner side of a
    link goes through this on both pages, so the lecture and the lab page combine the same numbers in either toggle state. */
export function periodCurrents(
  preset: Pick<PresetLike, 'periods'> & Partial<PresetLike>, entries: Record<number, LinkEntry[]>, table: TransmutationTable | null,
): (number | null)[] {
  const full = { final_mode: null, final_period_id: null, ...preset } as PresetLike;
  return buildCustomPeriods(full, entries, EMPTY_PREFS, table).map(p => projectPeriod(p).current);
}
