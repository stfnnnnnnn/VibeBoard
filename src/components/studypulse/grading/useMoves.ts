'use client';

/* Where this subject's entries go when categories disappear, for each entry mode, plus the save calls that send
   those choices: PUT /grading/[id] `moves` (edit), POST /grading then POST subjects/[id]/grading `map` (new),
   POST subjects/[id]/grading `map` (another system). Choices are strings: a target id, 'delete', or '' (unpicked).
   Single-score categories are never targets (F1): they show one entry, so moved entries could hide there. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GradingConfig, GradingPresetFull } from '@/lib/studypulse/types';
import type { Move } from '@/lib/studypulse/presetDiff';
import { deletedCategories, draftToPayload, prefillMap, type DraftPayload, type SetupDraft } from './draft';
import { api, loadPreset, subjectGradingUrl } from './api';
import type { MoveRow, Target } from './ReviewStep';
import type { EntryMode, PresetOption } from './ChoosePreset';

type Result = { ok: true; moved: boolean } | { ok: false; error: string };
type Extra = Record<number, { label: string; count: number | null }>;
type Body = { error?: string; cat_id?: number };
const norm = (s: string) => s.trim().toLowerCase();
const sorted = (p: GradingPresetFull) => [...p.periods].sort((a, b) => a.sort_order - b.sort_order)
  .map(x => ({ ...x, categories: [...x.categories].sort((a, b) => a.sort_order - b.sort_order) }));

export function useMoves({ mode, current, draft, entryCounts, others }: {
  mode: EntryMode; current: GradingConfig | null; draft: SetupDraft; entryCounts: Record<number, number>; others: PresetOption[];
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Extra>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [target, setTarget] = useState<GradingPresetFull | null>(null);
  const [loading, setLoading] = useState(false);
  const created = useRef<{ sig: string; id: number } | null>(null);

  useEffect(() => { setPicks({}); setExtra({}); }, [mode]);

  /** The old categories this subject has entries in (plus any the server reported), for "new" and "another". */
  const withEntries = useMemo<MoveRow[]>(() => {
    const rows: MoveRow[] = current ? sorted(current.preset).flatMap(p => p.categories
      .filter(c => entryCounts[c.cat_id] > 0)
      .map(c => ({ id: String(c.cat_id), label: `${p.name} · ${c.name}`, count: entryCounts[c.cat_id] }))) : [];
    for (const [id, x] of Object.entries(extra)) if (!rows.some(r => r.id === id)) rows.push({ id, ...x });
    return rows;
  }, [current, entryCounts, extra]);

  const { rows, targets, defaults } = useMemo(() => {
    const defaults: Record<string, string> = {};
    if (mode === 'edit' && current) {
      const rows: MoveRow[] = deletedCategories(current.preset, draft)
        .filter(d => entryCounts[d.cat_id] > 0 || extra[d.cat_id])
        .map(d => ({ id: String(d.cat_id), label: `${d.period} · ${d.name}`, count: entryCounts[d.cat_id] > 0 ? entryCounts[d.cat_id] : null }));
      const targets: Target[] = draft.periods.flatMap(p => p.categories.filter(c => c.cat_id != null && !c.is_singleton)
        .map(c => ({ value: String(c.cat_id), label: `${p.name.trim()} · ${c.name.trim()}` })));
      return { rows, targets, defaults };
    }
    if (mode === 'new') {
      const targets: Target[] = draft.periods.flatMap(p => p.categories.filter(c => !c.is_singleton).map(c => ({ value: c.key, label: `${p.name.trim() || 'Untitled'} · ${c.name.trim() || 'Untitled'}` })));
      for (const p of current ? current.preset.periods : []) {
        for (const c of p.categories) {
          const same = draft.periods.find(x => norm(x.name) === norm(p.name))?.categories.find(x => norm(x.name) === norm(c.name));
          const any = draft.periods.flatMap(x => x.categories).find(x => norm(x.name) === norm(c.name));
          defaults[String(c.cat_id)] = (same ?? any)?.key ?? '';
        }
      }
      return { rows: withEntries, targets, defaults };
    }
    if (mode === 'another' && target) {
      const targets: Target[] = sorted(target).flatMap(p => p.categories.filter(c => Number(c.is_singleton) !== 1).map(c => ({ value: String(c.cat_id), label: `${p.name} · ${c.name}` })));
      const pre = current ? prefillMap(current.preset, target, entryCounts) : {};
      for (const r of withEntries) defaults[r.id] = String(pre[Number(r.id)] ?? '');
      return { rows: withEntries, targets, defaults };
    }
    return { rows: [] as MoveRow[], targets: [] as Target[], defaults };
  }, [mode, current, draft, entryCounts, extra, target, withEntries]);

  const choices: Record<string, string> = {};
  for (const r of rows) {
    const c = picks[r.id] ?? defaults[r.id] ?? '';
    choices[r.id] = c === 'delete' || targets.some(t => t.value === c) ? c : '';
  }
  const problems = rows.filter(r => choices[r.id] === '')
    .map(r => ({ key: `move.${r.id}`, message: `Choose where the entries of ${r.label} go` }));

  const pick = async (id: number) => {
    setPicked(id); setPicks({}); setExtra({}); setTarget(null); setLoading(true);
    const p = await loadPreset(id);
    setTarget(p); setLoading(false);
  };
  const reset = () => { setPicks({}); setExtra({}); created.current = null; };

  /** Server said these categories still have entries (other subjects, or rows loaded after the page). */
  const report = (cats: Array<{ cat_id: number; name: string | null; entry_count?: number }>) =>
    setExtra(x => ({ ...x, ...Object.fromEntries(cats.map(c => [c.cat_id, { label: c.name ?? 'A removed category', count: c.entry_count ?? null }])) }));

  const assign = async (usid: number, presetId: number, map: Record<string, number | 'delete'>, names: GradingPresetFull | null): Promise<Result> => {
    const r = await api<Body & { categories?: Array<{ cat_id: number; name: string | null; entry_count: number }> }>(
      subjectGradingUrl(usid), 'POST',
      { preset_id: presetId, map, has_lab: current?.has_lab ?? 0, lec_weight: current?.lec_weight ?? 100, lab_weight: current?.lab_weight ?? 0 });
    if (r.ok) return { ok: true, moved: Object.keys(map).length > 0 };
    if (r.data.error === 'map-required' && r.data.categories) {
      report(r.data.categories);
      return { ok: false, error: 'Some entries still need a home. Choose where they go, then save again.' };
    }
    return { ok: false, error: singleScoreMessage(r.data, names) ?? r.data.error ?? 'Could not save. Try again.' };
  };

  const saveEdit = async (usid: number, presetId: number, payload: DraftPayload, scope: 'all' | 'copy'): Promise<Result> => {
    const mv: Record<string, Move> = {};
    for (const r of rows) mv[r.id] = choices[r.id] === 'delete' ? 'delete' : { to: Number(choices[r.id]) };
    const r = await api<Body>(`/api/studypulse/grading/${presetId}`, 'PUT', { ...payload, moves: mv, scope, user_subject_id: usid });
    if (r.ok) return { ok: true, moved: rows.length > 0 || scope === 'copy' };
    if (r.data.error === 'missing-move' && r.data.cat_id != null) {
      const gone = current ? deletedCategories(current.preset, draft).find(d => d.cat_id === r.data.cat_id) : undefined;
      report([{ cat_id: r.data.cat_id, name: gone ? `${gone.period} · ${gone.name}` : null }]);
      return { ok: false, error: `${gone ? `${gone.period} · ${gone.name}` : 'A removed category'} has entries in other subjects too. Choose where they go.` };
    }
    if (r.data.error === 'bad-move-target') return { ok: false, error: 'Entries can only move into a category that already existed. Pick another one.' };
    return { ok: false, error: singleScoreMessage(r.data, current?.preset ?? null) ?? r.data.error ?? 'Could not save. Try again.' };
  };

  /** The F1 refusals, named after the category when it can be found. */
  const singleScoreMessage = (b: Body, preset: GradingPresetFull | null): string | null => {
    if (b.error !== 'single-score-target' && b.error !== 'single-score-has-entries') return null;
    const p = preset?.periods.find(x => x.categories.some(c => Number(c.cat_id) === b.cat_id));
    const c = p?.categories.find(x => Number(x.cat_id) === b.cat_id);
    const name = p && c ? `${p.name} · ${c.name}` : 'A single-score category';
    return b.error === 'single-score-target'
      ? `${name} holds a single score, so it can take at most one entry per subject. Move these entries somewhere else.`
      : `${name} has more than one entry in a subject, so it can't become a single score. Keep it as multiple entries.`;
  };

  const saveNew = async (usid: number, d: SetupDraft): Promise<Result> => {
    const payload = draftToPayload(d);
    const s = JSON.stringify(payload);
    if (created.current?.sig !== s) {
      const r = await api<{ preset_id?: number }>('/api/studypulse/grading', 'POST', { ...payload, is_default: false });
      if (!r.ok || !r.data.preset_id) return { ok: false, error: r.data.error ?? 'Could not create the grading system' };
      created.current = { sig: s, id: r.data.preset_id };
    }
    const id = created.current.id;
    const map: Record<string, number | 'delete'> = {};
    let made: GradingPresetFull | null = null;
    if (rows.length) {
      made = await loadPreset(id);
      if (!made) return { ok: false, error: 'Could not load the new grading system' };
      const byKey = new Map<string, number>();
      sorted(made).forEach((p, pi) => p.categories.forEach((c, ci) => { const k = d.periods[pi]?.categories[ci]?.key; if (k) byKey.set(k, Number(c.cat_id)); }));
      for (const r of rows) {
        if (choices[r.id] === 'delete') { map[r.id] = 'delete'; continue; }
        const to = byKey.get(choices[r.id]);
        if (to == null) return { ok: false, error: `Could not find the new home for ${r.label}. Pick it again.` };
        map[r.id] = to;
      }
    }
    return assign(usid, id, map, made);
  };

  const saveAnother = async (usid: number): Promise<Result> => {
    if (picked == null) return { ok: false, error: 'Pick a grading system' };
    const map: Record<string, number | 'delete'> = {};
    for (const r of rows) map[r.id] = choices[r.id] === 'delete' ? 'delete' : Number(choices[r.id]);
    return assign(usid, picked, map, target);
  };

  return {
    rows, targets, choices, problems, picked, loading, reset, saveEdit, saveNew, saveAnother,
    pick: (id: number) => { if (others.some(o => o.preset_id === id)) void pick(id); },
    choose: (id: string, c: string) => setPicks(p => ({ ...p, [id]: c })),
  };
}
