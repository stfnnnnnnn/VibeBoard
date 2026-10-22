/* Builds projection input from StudyPulse data (spec §4.4). Pure. */
import type { CategoryInput, PeriodInput } from './projection';
import { transmute, type TransmutationTable } from '@/lib/transmutation';
import { categoryColor } from './ui/colors';
import { DEFAULT_TARGET, type ProjectionPrefs } from './prefs';
import type { EntryRow, PresetLike } from './types';

type EntryLike = Pick<EntryRow, 'name' | 'score' | 'items' | 'grade'> & { specificType?: string };

export function entryHasGrade(e: EntryLike): boolean {
  return e.grade !== null || (!!e.score && !!e.items);
}

/** The entry's percentage: transmuted when a table is given and applies, else its grade, else score/items. */
export function entryValue(e: EntryLike, table: TransmutationTable | null): number | null {
  if (table) {
    const t = transmute(e.score, e.items, table);
    if (t !== null) return t;
  }
  if (e.grade !== null) return Number(e.grade);
  const s = parseFloat(e.score), i = parseFloat(e.items);
  return Number.isFinite(s) && Number.isFinite(i) && i > 0 ? (s / i) * 100 : null;
}

export function averageOf(entries: EntryLike[], table: TransmutationTable | null): number | null {
  const vals = entries.filter(entryHasGrade).map(e => entryValue(e, table)).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export function nounFor(categoryName: string): string {
  const n = categoryName.trim();
  if (/zzes$/i.test(n)) return n.slice(0, -3);          // Quizzes -> Quiz
  if (/ies$/i.test(n)) return n.slice(0, -3) + 'y';     // Activities -> Activity
  if (/[^s]s$/i.test(n)) return n.slice(0, -1);         // Tasks -> Task (not "Class")
  return n;
}

function split(entries: EntryLike[], table: TransmutationTable | null) {
  const graded: number[] = [];
  const pending: string[] = [];
  for (const e of entries) {
    if (entryHasGrade(e)) {
      const v = entryValue(e, table);
      if (v !== null) graded.push(v);
    } else {
      pending.push(e.name.trim() || 'Untitled');
    }
  }
  return { graded, pending };
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

function category(
  key: string, name: string, weight: number, index: number, singleton: boolean,
  graded: number[], pending: string[], prefs: ProjectionPrefs,
): CategoryInput {
  // A singleton is one score: once graded nothing remains; ungraded it is exactly one item.
  const pendingNames = singleton ? (graded.length ? [] : [pending[0] ?? name]) : pending;
  return {
    key, name, weight, color: categoryColor(index), graded, pendingNames,
    extra: singleton ? 0 : Math.max(0, prefs.extras[key] ?? 0),
    singleton, noun: singleton ? name : nounFor(name),
  };
}

export function buildCustomPeriods(
  preset: PresetLike,
  catEntries: Record<number, EntryLike[]>,
  prefs: ProjectionPrefs,
  table: TransmutationTable | null,
): PeriodInput[] {
  // Linked carry-forward source: the first category in preset order with its own graded score.
  const source: Record<string, number> = {};
  for (const p of preset.periods) for (const c of p.categories) {
    const { graded } = split(catEntries[c.cat_id] ?? [], table);
    if (c.link_group && graded.length && !(c.link_group in source)) source[c.link_group] = mean(graded);
  }
  return preset.periods.map(p => ({
    key: `p${p.period_id}`,
    name: p.name,
    target: prefs.targets[`p${p.period_id}`] ?? DEFAULT_TARGET,
    categories: p.categories.map((c, i) => {
      const singleton = Number(c.is_singleton) === 1;
      let { graded, pending } = split(catEntries[c.cat_id] ?? [], table);
      if (!graded.length && singleton && Number(c.carry_score) === 1 && c.link_group && c.link_group in source) {
        graded = [source[c.link_group]];
        pending = [];
      }
      return category(`c${c.cat_id}`, c.name, Number(c.weight), i, singleton, graded, pending, prefs);
    }),
  }));
}

export function buildLegacyPeriods(
  activities: EntryLike[], quizzes: EntryLike[], exams: EntryLike[],
  prefs: ProjectionPrefs, table: TransmutationTable | null,
): PeriodInput[] {
  const a = split(activities, table);
  const q = split(quizzes, table);
  const m = split(exams.filter(e => e.specificType === 'Midterm'), table);
  const f = split(exams.filter(e => e.specificType === 'Final Exam'), table);
  return [{
    key: 'overall',
    name: 'Overall',
    target: prefs.targets.overall ?? DEFAULT_TARGET,
    categories: [
      category('legacy-activities', 'Activities', 24, 0, false, a.graded, a.pending, prefs),
      category('legacy-quizzes', 'Quizzes', 36, 1, false, q.graded, q.pending, prefs),
      category('legacy-midterm', 'Midterm Exam', 15, 2, true, m.graded, m.pending, prefs),
      category('legacy-final', 'Final Exam', 25, 3, true, f.graded, f.pending, prefs),
    ],
  }];
}

/** The legacy calculator's "Midterm" view: Activities 24 + Quizzes 36 + Midterm Exam 40. */
export function legacyMidtermPeriod(overall: PeriodInput): PeriodInput {
  return {
    ...overall,
    key: 'midterm-view',
    categories: overall.categories
      .filter(c => c.key !== 'legacy-final')
      .map(c => (c.key === 'legacy-midterm' ? { ...c, weight: 40 } : c)),
  };
}
