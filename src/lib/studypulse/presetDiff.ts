/* Pure diff/validation for editing a grading preset in place (spec §3.6). No DB access: the routes in
   api/studypulse/grading/[id] and lib/studypulse/presetWrites.ts apply what this computes. */
import type { FinalMode } from './types';

export interface DraftCategory { cat_id?: number; name: string; weight: number; is_singleton: boolean; link_group: string | null; carry_score: boolean; include_earlier: boolean }
export interface DraftPeriod { period_id?: number; name: string; categories: DraftCategory[] }
export type Move = { to: number } | 'delete';
export interface PresetDiff {
  periodUpdates: Array<{ period_id: number; name: string; sort_order: number }>;
  periodInserts: Array<{ index: number; name: string; sort_order: number }>;
  periodDeletes: number[];
  /** `period_id` is the draft period's existing id, or 0 when the category now sits in a new period;
      `periodIndex` (always set) is the draft index, which the writer resolves after period inserts. */
  catUpdates: Array<{ cat_id: number; period_id: number; periodIndex: number; fields: DraftCategory; sort_order: number }>;
  catInserts: Array<{ periodIndex: number; fields: DraftCategory; sort_order: number }>;
  catDeletes: number[];
}

type OldPreset = { periods: Array<{ period_id: number; categories: Array<{ cat_id: number }> }> };

/** Keys by period_id / cat_id. Draft items without an id, or with an id that is not in `old`, are inserts,
    so a draft can never touch another preset's rows. An id used twice in the draft throws 'duplicate-id'. */
export function diffPreset(old: OldPreset, draft: DraftPeriod[]): PresetDiff {
  const oldPeriods = new Set(old.periods.map(p => p.period_id));
  const oldCats = new Set(old.periods.flatMap(p => p.categories.map(c => c.cat_id)));
  const seenPeriods = new Set<number>();
  const seenCats = new Set<number>();
  const d: PresetDiff = { periodUpdates: [], periodInserts: [], periodDeletes: [], catUpdates: [], catInserts: [], catDeletes: [] };

  draft.forEach((p, pi) => {
    const keptPeriod = p.period_id != null && oldPeriods.has(p.period_id);
    if (keptPeriod) {
      if (seenPeriods.has(p.period_id!)) throw new Error(`duplicate-id:period:${p.period_id}`);
      seenPeriods.add(p.period_id!);
      d.periodUpdates.push({ period_id: p.period_id!, name: p.name, sort_order: pi });
    } else {
      d.periodInserts.push({ index: pi, name: p.name, sort_order: pi });
    }
    p.categories.forEach((c, ci) => {
      if (c.cat_id != null && oldCats.has(c.cat_id)) {
        if (seenCats.has(c.cat_id)) throw new Error(`duplicate-id:cat:${c.cat_id}`);
        seenCats.add(c.cat_id);
        d.catUpdates.push({ cat_id: c.cat_id, period_id: keptPeriod ? p.period_id! : 0, periodIndex: pi, fields: c, sort_order: ci });
      } else {
        d.catInserts.push({ periodIndex: pi, fields: c, sort_order: ci });
      }
    });
  });

  d.periodDeletes = old.periods.map(p => p.period_id).filter(id => !seenPeriods.has(id));
  d.catDeletes = [...oldCats].filter(id => !seenCats.has(id));
  return d;
}

/** Throws Error('missing-move:<cat_id>') when a deleted category has entries and no move.
    With `survivors` (the cat_ids kept by the draft), also throws Error('bad-move-target:<cat_id>') when a
    move points at a category that is not kept: moving into a new or deleted category is not supported. */
export function validateMoves(
  catDeletes: number[], entryCounts: Record<number, number>, moves: Record<number, Move>, survivors?: Set<number>,
): void {
  for (const id of catDeletes) {
    if (!(entryCounts[id] > 0)) continue;
    const m = moves[id];
    if (m !== 'delete' && !(m && typeof m === 'object' && Number.isInteger(m.to))) throw new Error(`missing-move:${id}`);
    if (survivors && m !== 'delete' && !survivors.has(m.to)) throw new Error(`bad-move-target:${id}`);
  }
}

/** For scope 'copy': maps each old cat_id that survives to its position [periodIndex, catIndex] in the draft. */
export function survivingPositions(draft: DraftPeriod[]): Record<number, [number, number]> {
  const out: Record<number, [number, number]> = {};
  draft.forEach((p, pi) => p.categories.forEach((c, ci) => { if (c.cat_id != null) out[c.cat_id] = [pi, ci]; }));
  return out;
}

/** First problem with a draft, as a user-facing message, or null. Column limits match grading_* tables. */
export function validateDraft(name: unknown, draft: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Give the grading system a name';
  if (name.trim().length > 100) return 'The name can be at most 100 characters';
  if (!Array.isArray(draft) || draft.length === 0) return 'Add at least one period';
  for (const p of draft as DraftPeriod[]) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) return 'Every period needs a name';
    if (p.name.trim().length > 50) return 'Period names can be at most 50 characters';
    if (!Array.isArray(p.categories) || p.categories.length === 0) return `${p.name.trim()} needs at least one category`;
    let sum = 0;
    const groups = new Set<string>();
    for (const c of p.categories) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) return `Every category in ${p.name.trim()} needs a name`;
      if (c.name.trim().length > 50) return 'Category names can be at most 50 characters';
      const w = Number(c.weight);
      if (!Number.isFinite(w) || w < 0 || w > 100) return `Weights in ${p.name.trim()} must be between 0 and 100`;
      sum += w;
      if (c.link_group != null && c.link_group !== '') {
        if (typeof c.link_group !== 'string' || c.link_group.length > 40) return 'Invalid linked group';
        if (groups.has(c.link_group)) return 'A period can only have one category per linked group';
        groups.add(c.link_group);
      }
    }
    if (Math.abs(sum - 100) > 0.01) return `${p.name.trim()}'s weights must add up to 100`;
  }
  return null;
}

/** Ruling R8: the final rule to store. `index` is a draft period index; `periodIds[i]` is the stored id of draft
    period i. `fallbackIndex` is used when the client sent no index (the previous final period's draft index, if
    it survived). 'period' that cannot resolve is an error only when the client explicitly asked for it. */
export function resolveFinal(
  sentMode: unknown, storedMode: FinalMode | null, index: unknown, fallbackIndex: number | null, periodIds: number[],
): { final_mode: FinalMode | null; final_period_id: number | null } | { error: string } {
  if (sentMode !== undefined && sentMode !== null && sentMode !== 'period' && sentMode !== 'average' && sentMode !== 'collective') {
    return { error: 'Unknown final grade rule' };
  }
  const mode: FinalMode | null = sentMode === undefined
    ? storedMode
    : sentMode === 'collective' ? 'average' : (sentMode as FinalMode | null);
  const i = index === undefined || index === null ? fallbackIndex : Number(index);
  const periodId = i != null && Number.isInteger(i) && i >= 0 && i < periodIds.length ? periodIds[i] : null;
  if (mode === 'average') return { final_mode: 'average', final_period_id: periodId };
  if (mode === 'period') {
    if (periodId != null) return { final_mode: 'period', final_period_id: periodId };
    if (sentMode === 'period') return { error: 'Pick the period that shows the final grade' };
  }
  return { final_mode: null, final_period_id: null };
}

const optId = (v: unknown): number | undefined =>
  (typeof v === 'number' || typeof v === 'string') && v !== '' && Number.isInteger(Number(v)) ? Number(v) : undefined;

/** Coerces a request body's periods (already passed through validateDraft) into DraftPeriod[]. */
export function normalizeDraft(raw: unknown): DraftPeriod[] {
  return (raw as Array<Record<string, unknown>>).map(p => ({
    period_id: optId(p.period_id),
    name: String(p.name).trim(),
    categories: (p.categories as Array<Record<string, unknown>>).map(c => ({
      cat_id: optId(c.cat_id),
      name: String(c.name).trim(),
      weight: Number(c.weight),
      is_singleton: !!c.is_singleton,
      link_group: typeof c.link_group === 'string' && c.link_group !== '' ? c.link_group : null,
      carry_score: c.carry_score !== false,
      include_earlier: !!c.include_earlier,
    })),
  }));
}

/** Coerces a request body's `moves` into Record<cat_id, Move>, dropping anything malformed. */
export function normalizeMoves(raw: unknown): Record<number, Move> {
  const out: Record<number, Move> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isInteger(id)) continue;
    if (v === 'delete') out[id] = 'delete';
    else if (v && typeof v === 'object' && Number.isInteger(Number((v as { to?: unknown }).to))) out[id] = { to: Number((v as { to: unknown }).to) };
  }
  return out;
}
