/* Pure helpers for the grading setup sheet (spec §4). No React, no fetch: GradingSetup and its steps hold a
   SetupDraft in state and change it only through these functions, so every rule here is unit-tested.
   The wire types (DraftPeriod / DraftCategory) and the server's whole-draft check come from presetDiff, so the
   sheet and PUT /api/studypulse/grading/[id] validate the same way. */
import {
  validateDraft as validatePresetDraft, type DraftCategory, type DraftPeriod,
} from '@/lib/studypulse/presetDiff';
import type { FinalMode, GradeScale, GradingPresetFull } from '@/lib/studypulse/types';

/** A draft category plus a client-only React key (never sent). */
export interface UiCategory extends DraftCategory { key: string }
export interface UiPeriod { period_id?: number; key: string; name: string; categories: UiCategory[] }
export interface SetupDraft {
  name: string;
  grade_scale: GradeScale;
  /** null: no final rule chosen yet (a preset saved before final rules existed). */
  final_mode: FinalMode | null;
  final_period_index: number | null;
  periods: UiPeriod[];
}
export type FieldErrors = Record<string, string>;
/** A target for a mapped category: a cat_id, 'delete', or '' while the user has not picked one. */
export type MapChoice = number | 'delete' | '';

let seq = 0;
const nextKey = (prefix: string) => `${prefix}${++seq}`;
const norm = (s: string) => s.trim().toLowerCase();
/** Link-group ids are opaque strings (grading_categories.link_group is VARCHAR(40)). */
const newGroup = () => `g${Date.now().toString(36)}${(++seq).toString(36)}`;

export function newCategory(fields: Partial<DraftCategory> = {}): UiCategory {
  return {
    key: nextKey('c'), name: '', weight: 0, is_singleton: false, link_group: null,
    carry_score: true, include_earlier: false, ...fields,
  };
}
export function newPeriod(name = ''): UiPeriod {
  return { key: nextKey('p'), name, categories: [newCategory({ weight: 100 })] };
}

export function toDraft(preset: GradingPresetFull): SetupDraft {
  const periods = [...preset.periods].sort((a, b) => a.sort_order - b.sort_order);
  const fi = periods.findIndex(p => p.period_id === preset.final_period_id);
  return {
    name: preset.name,
    grade_scale: preset.grade_scale ?? '4pt',
    final_mode: preset.final_mode === 'period' || preset.final_mode === 'average' ? preset.final_mode : null,
    final_period_index: fi >= 0 ? fi : null,
    periods: periods.map(p => ({
      period_id: Number(p.period_id),
      key: nextKey('p'),
      name: p.name,
      categories: [...p.categories].sort((a, b) => a.sort_order - b.sort_order).map(c => ({
        cat_id: Number(c.cat_id),
        key: nextKey('c'),
        name: c.name,
        weight: Number(c.weight),
        is_singleton: Number(c.is_singleton) === 1,
        link_group: c.link_group || null,
        carry_score: Number(c.carry_score) !== 0,
        include_earlier: Number(c.include_earlier) === 1,
      })),
    })),
  };
}

/** The FEU Tech default: Midterm Exam is linked into Finals as a single score (reused until Finals has its own). */
export function feuTemplate(): SetupDraft {
  const me = newGroup();
  return {
    name: 'FEU Tech Standard', grade_scale: '4pt', final_mode: 'period', final_period_index: 1,
    periods: [
      { key: nextKey('p'), name: 'Midterm', categories: [
        newCategory({ name: 'Quizzes', weight: 36 }),
        newCategory({ name: 'Tasks', weight: 24 }),
        newCategory({ name: 'Midterm Exam', weight: 40, is_singleton: true, link_group: me }),
      ] },
      { key: nextKey('p'), name: 'Finals', categories: [
        newCategory({ name: 'Quizzes', weight: 36 }),
        newCategory({ name: 'Tasks', weight: 24 }),
        newCategory({ name: 'Midterm Exam', weight: 15, is_singleton: true, link_group: me }),
        newCategory({ name: 'Final Exam', weight: 25, is_singleton: true }),
      ] },
    ],
  };
}

export function blankDraft(): SetupDraft {
  return { name: '', grade_scale: '4pt', final_mode: null, final_period_index: null, periods: [newPeriod('')] };
}

const mapCats = (d: SetupDraft, f: (c: UiCategory, pi: number, ci: number) => UiCategory): SetupDraft => ({
  ...d, periods: d.periods.map((p, pi) => ({ ...p, categories: p.categories.map((c, ci) => f(c, pi, ci)) })),
});

/** Turns "Linked across periods" on or off for draft.periods[pi].categories[ci].
    On: the category gets a link group, and every other period gets exactly one member of it: an unlinked category
    there with the same name is adopted, otherwise a copy is appended (same name, weight and single-score flag, as
    the old wizard did). Off: the whole group is unlinked (same names, separate scores); nothing is removed. */
export function linkAcross(draft: SetupDraft, pi: number, ci: number, on: boolean): SetupDraft {
  const src = draft.periods[pi]?.categories[ci];
  if (!src) return draft;
  if (!on) {
    if (!src.link_group) return draft;
    const g = src.link_group;
    return mapCats(draft, c => c.link_group === g ? { ...c, link_group: null, include_earlier: false } : c);
  }
  const g = src.link_group ?? newGroup();
  return {
    ...draft,
    periods: draft.periods.map((p, i) => {
      if (i === pi) return { ...p, categories: p.categories.map((c, j) => j === ci ? { ...c, link_group: g } : c) };
      if (p.categories.some(c => c.link_group === g)) return p;
      const twin = p.categories.findIndex(c => !c.link_group && norm(c.name) === norm(src.name) && norm(src.name) !== '');
      if (twin >= 0) return { ...p, categories: p.categories.map((c, j) => j === twin ? { ...c, link_group: g } : c) };
      return { ...p, categories: [...p.categories, newCategory({
        name: src.name, weight: src.weight, is_singleton: src.is_singleton, link_group: g,
      })] };
    }),
  };
}

/** Renames a category; a linked one renames its whole group, so the pairing stays visible. */
export function renameLinked(draft: SetupDraft, pi: number, ci: number, name: string): SetupDraft {
  const src = draft.periods[pi]?.categories[ci];
  if (!src) return draft;
  const g = src.link_group;
  return mapCats(draft, (c, i, j) => (i === pi && j === ci) || (g && c.link_group === g) ? { ...c, name } : c);
}

/** Sets "Single score" on a category; a linked one sets it on its whole group (R11), so one group never mixes
    single-score and multi-entry members. A single score never includes earlier entries. */
export function setSingleton(draft: SetupDraft, pi: number, ci: number, on: boolean): SetupDraft {
  const src = draft.periods[pi]?.categories[ci];
  if (!src) return draft;
  const g = src.link_group;
  return mapCats(draft, (c, i, j) => (i === pi && j === ci) || (g && c.link_group === g)
    ? { ...c, is_singleton: on, include_earlier: on ? false : c.include_earlier }
    : c);
}

/** Removes a period and keeps the final period pointing at the same period (or clears it if that one went). */
export function removePeriod(draft: SetupDraft, pi: number): SetupDraft {
  const fi = draft.final_period_index;
  return {
    ...draft,
    periods: draft.periods.filter((_, i) => i !== pi),
    final_period_index: fi === null || fi === pi ? null : fi > pi ? fi - 1 : fi,
  };
}

export function periodSum(p: { categories: Array<{ weight: number }> }): number {
  return Math.round(p.categories.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0) * 100) / 100;
}

/** Field-level errors, keyed so each can sit under its own input:
    name · periods · p{i}.name · p{i}.empty · p{i}.sum · p{i}.c{j}.name · p{i}.c{j}.weight · p{i}.c{j}.group · final.
    When no field is wrong, presetDiff.validateDraft (the server's check) runs too and any message lands in `form`. */
export function validateDraft(d: SetupDraft): FieldErrors {
  const e: FieldErrors = {};
  if (!d.name.trim()) e.name = 'Give the grading system a name';
  else if (d.name.trim().length > 100) e.name = 'Use at most 100 characters';
  if (d.periods.length === 0) e.periods = 'Add at least one period';
  d.periods.forEach((p, pi) => {
    if (!p.name.trim()) e[`p${pi}.name`] = 'Name this period';
    else if (p.name.trim().length > 50) e[`p${pi}.name`] = 'Use at most 50 characters';
    if (p.categories.length === 0) e[`p${pi}.empty`] = 'Add at least one category';
    const groups = new Set<string>();
    p.categories.forEach((c, ci) => {
      const k = `p${pi}.c${ci}`;
      if (!c.name.trim()) e[`${k}.name`] = 'Name this category';
      else if (c.name.trim().length > 50) e[`${k}.name`] = 'Use at most 50 characters';
      if (!Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100) e[`${k}.weight`] = 'Use a weight from 0 to 100';
      if (c.link_group) {
        if (groups.has(c.link_group)) e[`${k}.group`] = 'This period already has a category in this linked group';
        groups.add(c.link_group);
      }
    });
    const sum = periodSum(p);
    if (p.categories.length && Math.abs(sum - 100) > 0.01) e[`p${pi}.sum`] = `Weights add up to ${sum}%; they need to make 100%`;
  });
  if (d.final_mode === 'period') {
    const fi = d.final_period_index;
    if (fi === null || fi < 0 || fi >= d.periods.length) e.final = 'Pick the period that shows the final grade';
  }
  if (Object.keys(e).length === 0) {
    const p = draftToPayload(d);
    const msg = validatePresetDraft(p.name, p.periods);
    if (msg) e.form = msg;
  }
  return e;
}

/** Which of the five steps (0 Scale … 4 Review) an error key belongs to, for the stepper's error dots. */
export function stepOfError(key: string): number {
  if (key === 'name') return 0;
  if (key === 'periods' || /^p\d+\./.test(key)) return 1;
  if (key === 'final') return 2;
  if (key.startsWith('lab')) return 3;
  return 4;
}

export interface DraftPayload {
  name: string;
  grade_scale: GradeScale;
  final_mode: FinalMode | null;
  final_period_index: number | null;
  periods: DraftPeriod[];
}

/** The body fields PUT /grading/[id] and POST /grading share; callers add moves / scope / user_subject_id. */
export function draftToPayload(d: SetupDraft): DraftPayload {
  return {
    name: d.name.trim(),
    grade_scale: d.grade_scale,
    final_mode: d.final_mode,
    final_period_index: d.final_mode === null ? null : d.final_period_index,
    periods: d.periods.map(p => ({
      ...(p.period_id != null ? { period_id: p.period_id } : {}),
      name: p.name.trim(),
      categories: p.categories.map(c => ({
        ...(c.cat_id != null ? { cat_id: c.cat_id } : {}),
        name: c.name.trim(),
        weight: c.weight,
        is_singleton: c.is_singleton,
        link_group: c.link_group || null,
        carry_score: c.carry_score,
        include_earlier: c.include_earlier,
      })),
    })),
  };
}

export interface DeletedCategory { cat_id: number; name: string; period: string }

/** Categories of `preset` whose cat_id is no longer anywhere in the draft, in the preset's order. */
export function deletedCategories(preset: GradingPresetFull, d: SetupDraft): DeletedCategory[] {
  const kept = new Set(d.periods.flatMap(p => p.categories.map(c => c.cat_id)).filter((v): v is number => v != null));
  return [...preset.periods].sort((a, b) => a.sort_order - b.sort_order).flatMap(p =>
    [...p.categories].sort((a, b) => a.sort_order - b.sort_order)
      .filter(c => !kept.has(Number(c.cat_id)))
      .map(c => ({ cat_id: Number(c.cat_id), name: c.name, period: p.name })));
}

/** "Use another system": a starting map for every old category that has entries. Same period name and category
    name first, then the same category name in any period, else '' (the user must pick or choose delete). */
export function prefillMap(
  from: GradingPresetFull, to: GradingPresetFull, counts: Record<number, number>,
): Record<number, MapChoice> {
  const out: Record<number, MapChoice> = {};
  const targets = [...to.periods].sort((a, b) => a.sort_order - b.sort_order);
  for (const p of from.periods) {
    for (const c of p.categories) {
      if (!(counts[c.cat_id] > 0)) continue;
      const samePeriod = targets.find(t => norm(t.name) === norm(p.name))?.categories.find(t => norm(t.name) === norm(c.name));
      const anyPeriod = targets.flatMap(t => t.categories).find(t => norm(t.name) === norm(c.name));
      out[c.cat_id] = Number((samePeriod ?? anyPeriod)?.cat_id ?? 0) || '';
    }
  }
  return out;
}

const scaleLabel = (s: GradeScale) => (s === '4pt' ? '4.0 is highest' : '1.0 is highest');
const finalLabel = (mode: FinalMode | null, index: number | null, names: string[]) =>
  mode === 'average' ? 'average of the periods'
    : mode === 'period' ? `shown in ${index != null && names[index] ? names[index] : 'a period'}`
      : 'not set';

/** Plain-language list of what saving would change, for the Review step. Empty when nothing changed. */
export function describeChanges(preset: GradingPresetFull, d: SetupDraft): string[] {
  const before = toDraft(preset);
  const out: string[] = [];
  if (before.name.trim() !== d.name.trim()) out.push(`Renamed to “${d.name.trim()}”`);
  if (before.grade_scale !== d.grade_scale) out.push(`Grade scale: ${scaleLabel(before.grade_scale)} → ${scaleLabel(d.grade_scale)}`);
  const bf = finalLabel(before.final_mode, before.final_period_index, before.periods.map(p => p.name));
  const af = finalLabel(d.final_mode, d.final_period_index, d.periods.map(p => p.name.trim()));
  if (bf !== af) out.push(`Final grade: ${bf} → ${af}`);

  const oldPeriods = new Map(before.periods.map(p => [p.period_id, p]));
  const oldCats = new Map(before.periods.flatMap(p => p.categories.map(c => [c.cat_id, { c, period: p.name }] as const)));
  const keptPeriods = new Set<number>();
  for (const p of d.periods) {
    const op = p.period_id != null ? oldPeriods.get(p.period_id) : undefined;
    if (!op) { out.push(`Added period ${p.name.trim() || '(unnamed)'}`); continue; }
    keptPeriods.add(p.period_id!);
    if (op.name !== p.name.trim()) out.push(`Period ${op.name} renamed to ${p.name.trim()}`);
  }
  for (const p of before.periods) if (!keptPeriods.has(p.period_id!)) out.push(`Removed period ${p.name}`);

  const seen = new Set<number>();
  for (const p of d.periods) {
    const pn = p.name.trim();
    for (const c of p.categories) {
      const label = `${pn} · ${c.name.trim() || '(unnamed)'}`;
      const old = c.cat_id != null ? oldCats.get(c.cat_id) : undefined;
      if (!old) { out.push(`Added ${label} (${c.weight}%)`); continue; }
      seen.add(c.cat_id!);
      const o = old.c;
      const what: string[] = [];
      if (o.name !== c.name.trim()) what.push(`renamed from ${o.name}`);
      if (o.weight !== c.weight) what.push(`${o.weight}% → ${c.weight}%`);
      if (o.is_singleton !== c.is_singleton) what.push(c.is_singleton ? 'now a single score' : 'now multiple entries');
      if (!!o.link_group !== !!c.link_group) what.push(c.link_group ? 'now linked across periods' : 'no longer linked');
      if (o.include_earlier !== c.include_earlier) what.push(c.include_earlier ? 'includes earlier entries' : 'stops including earlier entries');
      if (o.carry_score !== c.carry_score && c.is_singleton) what.push(c.carry_score ? 'reuses the earlier score' : 'stops reusing the earlier score');
      if (old.period !== pn && oldPeriods.get(p.period_id!)?.name !== old.period) what.push(`moved from ${old.period}`);
      if (what.length) out.push(`${label}: ${what.join(', ')}`);
    }
  }
  for (const [id, { c, period }] of oldCats) if (id != null && !seen.has(id)) out.push(`Removed ${period} · ${c.name}`);
  return out;
}
