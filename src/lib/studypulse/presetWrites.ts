/* Server-only SQL for PUT /api/studypulse/grading/[id] and POST /api/studypulse/subjects/[id]/grading (spec §3.6).
   Every function runs on a connection the caller has already put inside a transaction. editPresetTx and
   setSubjectPresetTx are the routes' whole in-transaction bodies (ownership first); the apply* helpers assume the
   preset is already locked and owned. No pool import: the rolled-back integration probe drives these same
   functions on its own connection. */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import {
  diffPreset, normalizeDraft, normalizeMoves, resolveFinal, singleScoreError, survivingPositions, validateDraft, validateMoves,
  type DraftCategory, type DraftPeriod, type Move, type PresetDiff,
} from './presetDiff';
import { normalizeFinalMode } from './projection';
import type { FinalMode } from './types';

type Conn = Pick<PoolConnection, 'execute'>;

export interface OldStructure { periods: Array<{ period_id: number; categories: Array<{ cat_id: number; is_singleton?: boolean }> }> }

/** What the preset row gets besides its structure. `fallbackIndex` is the draft index of the stored final period
    when that period survives (used when the client sent no index). */
export interface PresetHead {
  name: string;
  grade_scale: string;
  sentMode: unknown;
  storedMode: FinalMode | null;
  index: unknown;
  fallbackIndex: number | null;
}

export async function loadStructure(conn: Conn, presetId: number): Promise<OldStructure> {
  const [periods] = await conn.execute<RowDataPacket[]>(
    'SELECT period_id FROM grading_periods WHERE preset_id=? ORDER BY sort_order, period_id', [presetId]);
  const [cats] = await conn.execute<RowDataPacket[]>(
    `SELECT gc.cat_id, gc.period_id, gc.is_singleton FROM grading_categories gc
     JOIN grading_periods gp ON gp.period_id = gc.period_id
     WHERE gp.preset_id=? ORDER BY gc.sort_order, gc.cat_id`, [presetId]);
  return {
    periods: periods.map(p => ({
      period_id: Number(p.period_id),
      categories: cats.filter(c => Number(c.period_id) === Number(p.period_id))
        .map(c => ({ cat_id: Number(c.cat_id), is_singleton: Number(c.is_singleton) === 1 })),
    })),
  };
}

/** Entries per category, as a locking read so no entry can be added to a category while it is being deleted.
    With `userSubjectId`, counts only that subject's entries (scope 'copy' touches nothing else). */
export async function entryCounts(conn: Conn, catIds: number[], userSubjectId?: number): Promise<Record<number, number>> {
  if (!catIds.length) return {};
  const marks = catIds.map(() => '?').join(',');
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT cat_id, COUNT(*) AS n FROM grade_entries
     WHERE cat_id IN (${marks})${userSubjectId != null ? ' AND user_subject_id=?' : ''}
     GROUP BY cat_id FOR UPDATE`,
    userSubjectId != null ? [...catIds, userSubjectId] : catIds);
  const out: Record<number, number> = {};
  for (const r of rows) out[Number(r.cat_id)] = Number(r.n);
  return out;
}

/** Entries per (category, subject), as a locking read, for the single-score check (F1). With `userSubjectId`,
    only that subject's entries. */
export async function entryCountsBySubject(
  conn: Conn, catIds: number[], userSubjectId?: number,
): Promise<Array<{ cat_id: number; user_subject_id: number; n: number }>> {
  if (!catIds.length) return [];
  const marks = catIds.map(() => '?').join(',');
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT cat_id, user_subject_id, COUNT(*) AS n FROM grade_entries
     WHERE cat_id IN (${marks})${userSubjectId != null ? ' AND user_subject_id=?' : ''}
     GROUP BY cat_id, user_subject_id FOR UPDATE`,
    userSubjectId != null ? [...catIds, userSubjectId] : catIds);
  return rows.map(r => ({ cat_id: Number(r.cat_id), user_subject_id: Number(r.user_subject_id), n: Number(r.n) }));
}

const catValues = (c: DraftCategory) => [
  c.name, c.weight, c.is_singleton ? 1 : 0, c.link_group, c.carry_score ? 1 : 0, c.include_earlier ? 1 : 0,
];

async function insertCategory(conn: Conn, periodId: number, c: DraftCategory, sortOrder: number): Promise<number> {
  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO grading_categories (period_id, name, weight, is_singleton, link_group, carry_score, include_earlier, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [periodId, ...catValues(c), sortOrder]);
  return r.insertId;
}

async function writeHead(conn: Conn, presetId: number, head: PresetHead, periodIds: number[], extra: { name: boolean }) {
  const fin = resolveFinal(head.sentMode, head.storedMode, head.index, head.fallbackIndex, periodIds);
  if ('error' in fin) throw new Error(fin.error); // callers pre-check with the same function, so this is a guard
  await conn.execute(
    `UPDATE grading_presets SET ${extra.name ? 'name=?, ' : ''}grade_scale=?, final_mode=?, final_period_id=? WHERE preset_id=?`,
    [...(extra.name ? [head.name] : []), head.grade_scale, fin.final_mode, fin.final_period_id, presetId]);
}

/** scope 'all': edit the preset in place. Kept periods/categories keep their ids; the entries of deleted
    categories follow `moves` (validated by the caller); every subject using the preset sees the change. */
export async function applyEditAll(
  conn: Conn, presetId: number, diff: PresetDiff, moves: Record<number, Move>, head: PresetHead, periodCount: number,
): Promise<void> {
  const periodIds: number[] = new Array(periodCount);
  for (const p of diff.periodUpdates) {
    await conn.execute('UPDATE grading_periods SET name=?, sort_order=? WHERE period_id=? AND preset_id=?',
      [p.name, p.sort_order, p.period_id, presetId]);
    periodIds[p.sort_order] = p.period_id;
  }
  for (const p of diff.periodInserts) {
    const [r] = await conn.execute<ResultSetHeader>(
      'INSERT INTO grading_periods (preset_id, name, sort_order) VALUES (?, ?, ?)', [presetId, p.name, p.sort_order]);
    periodIds[p.index] = r.insertId;
  }

  for (const c of diff.catUpdates) {
    await conn.execute(
      `UPDATE grading_categories
       SET period_id=?, name=?, weight=?, is_singleton=?, link_group=?, carry_score=?, include_earlier=?, sort_order=?
       WHERE cat_id=?`,
      [periodIds[c.periodIndex], ...catValues(c.fields), c.sort_order, c.cat_id]);
  }
  for (const c of diff.catInserts) await insertCategory(conn, periodIds[c.periodIndex], c.fields, c.sort_order);

  // A kept category may have moved to another period: its entries follow it.
  if (diff.catUpdates.length) {
    const kept = diff.catUpdates.map(c => c.cat_id);
    await conn.execute(
      `UPDATE grade_entries ge JOIN grading_categories gc ON gc.cat_id = ge.cat_id
       SET ge.period_id = gc.period_id
       WHERE ge.cat_id IN (${kept.map(() => '?').join(',')}) AND ge.period_id <> gc.period_id`, kept);
  }

  for (const id of diff.catDeletes) {
    const m = moves[id];
    if (m === 'delete') {
      // canvas_entry_links and the other grade_entry_id FKs are ON DELETE CASCADE.
      await conn.execute('DELETE FROM grade_entries WHERE cat_id=?', [id]);
    } else if (m && typeof m === 'object') {
      await conn.execute(
        'UPDATE grade_entries SET cat_id=?, period_id=(SELECT period_id FROM grading_categories WHERE cat_id=?) WHERE cat_id=?',
        [m.to, m.to, id]);
    }
  }
  if (diff.catDeletes.length) {
    await conn.execute(`DELETE FROM grading_categories WHERE cat_id IN (${diff.catDeletes.map(() => '?').join(',')})`, diff.catDeletes);
  }
  if (diff.periodDeletes.length) {
    await conn.execute(
      `DELETE FROM grading_periods WHERE preset_id=? AND period_id IN (${diff.periodDeletes.map(() => '?').join(',')})`,
      [presetId, ...diff.periodDeletes]);
  }

  await writeHead(conn, presetId, head, periodIds, { name: true });
}

/** scope 'copy': clone the draft as a new preset owned by `userId`, remap only `userSubjectId`'s entries by
    position, and point that subject at the clone. The source preset is not modified. Returns the new preset_id. */
export async function applyEditCopy(
  conn: Conn, userId: number, srcPresetId: number, userSubjectId: number, old: OldStructure,
  draft: DraftPeriod[], catDeletes: number[], moves: Record<number, Move>, head: PresetHead,
): Promise<number> {
  const [src] = await conn.execute<RowDataPacket[]>(
    'SELECT has_lab, lec_weight, lab_weight FROM grading_presets WHERE preset_id=? AND user_id=?', [srcPresetId, userId]);
  const s = src[0] ?? {};
  const [pr] = await conn.execute<ResultSetHeader>(
    `INSERT INTO grading_presets (user_id, name, is_default, has_lab, lec_weight, lab_weight, grade_scale)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
    [userId, head.name, s.has_lab ?? 0, s.lec_weight ?? 100, s.lab_weight ?? 0, head.grade_scale]);
  const newPresetId = pr.insertId;

  const periodIds: number[] = [];
  const catIds: number[][] = [];
  for (let pi = 0; pi < draft.length; pi++) {
    const [r] = await conn.execute<ResultSetHeader>(
      'INSERT INTO grading_periods (preset_id, name, sort_order) VALUES (?, ?, ?)', [newPresetId, draft[pi].name, pi]);
    periodIds[pi] = r.insertId;
    catIds[pi] = [];
    for (let ci = 0; ci < draft[pi].categories.length; ci++) {
      catIds[pi][ci] = await insertCategory(conn, periodIds[pi], draft[pi].categories[ci], ci);
    }
  }

  // New ids are fresh auto-increments, so no entry already points at them: the remaps cannot chain.
  const oldCats = new Set(old.periods.flatMap(p => p.categories.map(c => c.cat_id)));
  const positions = survivingPositions(draft);
  const remap = async (fromCat: number, [pi, ci]: [number, number]) => {
    await conn.execute('UPDATE grade_entries SET cat_id=?, period_id=? WHERE user_subject_id=? AND cat_id=?',
      [catIds[pi][ci], periodIds[pi], userSubjectId, fromCat]);
  };
  for (const [oldId, pos] of Object.entries(positions)) {
    if (oldCats.has(Number(oldId))) await remap(Number(oldId), pos);
  }
  for (const id of catDeletes) {
    const m = moves[id];
    if (m === 'delete') {
      await conn.execute('DELETE FROM grade_entries WHERE user_subject_id=? AND cat_id=?', [userSubjectId, id]);
    } else if (m && typeof m === 'object' && positions[m.to]) {
      await remap(id, positions[m.to]);
    }
  }

  await writeHead(conn, newPresetId, head, periodIds, { name: false });
  await conn.execute('UPDATE subject_grading SET preset_id=? WHERE user_subject_id=?', [newPresetId, userSubjectId]);
  return newPresetId;
}

export type TxResult = { status: number; body: Record<string, unknown> };

/** The whole of PUT /api/studypulse/grading/[id] after auth, on a connection inside an open transaction.
    The caller commits on status 200 and rolls back otherwise. Ownership is the first statement. */
export async function editPresetTx(conn: Conn, userId: number, presetId: number, body: Record<string, unknown>): Promise<TxResult> {
  const bad = (error: string, extra: Record<string, unknown> = {}): TxResult => ({ status: 400, body: { error, ...extra } });

  const [presets] = await conn.execute<RowDataPacket[]>(
    'SELECT * FROM grading_presets WHERE preset_id=? AND user_id=? FOR UPDATE', [presetId, userId]);
  if (!presets.length) return { status: 404, body: { error: 'Not found' } };
  const preset = presets[0];

  const scope = body.scope ?? 'all';
  if (scope !== 'all' && scope !== 'copy') return bad('Invalid scope');
  if (body.grade_scale !== undefined && body.grade_scale !== '4pt' && body.grade_scale !== '1pt') return bad('Invalid grade scale');
  const draftError = validateDraft(body.name, body.periods);
  if (draftError) return bad(draftError);
  const draft = normalizeDraft(body.periods);
  const moves = normalizeMoves(body.moves);

  const hasSubject = body.user_subject_id !== undefined && body.user_subject_id !== null;
  const userSubjectId = Number(body.user_subject_id);
  if (scope === 'copy' && !hasSubject) return bad('Pick the subject the copy is for');
  if (hasSubject) {
    if (!Number.isInteger(userSubjectId)) return { status: 404, body: { error: 'Subject not found' } };
    const [ownsSubject] = await conn.execute<RowDataPacket[]>(
      'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?', [userSubjectId, userId]);
    if (!ownsSubject.length) return { status: 404, body: { error: 'Subject not found' } };
  }
  if (scope === 'copy') {
    const [sg] = await conn.execute<RowDataPacket[]>(
      'SELECT preset_id FROM subject_grading WHERE user_subject_id=? FOR UPDATE', [userSubjectId]);
    if (!sg.length || Number(sg[0].preset_id) !== presetId) return bad('This subject does not use this grading system');
  }

  const old = await loadStructure(conn, presetId);
  let diff: PresetDiff;
  try { diff = diffPreset(old, draft); }
  catch { return bad('Each period and category can appear only once'); }

  const counts = await entryCounts(conn, diff.catDeletes, scope === 'copy' ? userSubjectId : undefined);
  try {
    validateMoves(diff.catDeletes, counts, moves, new Set(diff.catUpdates.map(c => c.cat_id)));
  } catch (err) {
    const [code, catId] = (err instanceof Error ? err.message : '').split(':');
    return bad(code || 'missing-move', { cat_id: Number(catId) });
  }

  // F1: no subject may end up with more than one entry in a single-score category (kept categories only: moves
  // can only target those, and new categories start empty).
  const wasSingle = new Map(old.periods.flatMap(p => p.categories.map(c => [c.cat_id, !!c.is_singleton] as const)));
  const kept = diff.catUpdates.map(c => ({ cat_id: c.cat_id, is_singleton: c.fields.is_singleton, was_singleton: wasSingle.get(c.cat_id) ?? false }));
  if (kept.some(c => c.is_singleton)) {
    const moveTargets: Record<number, number | 'delete'> = {};
    for (const id of diff.catDeletes) { const m = moves[id]; if (m) moveTargets[id] = m === 'delete' ? 'delete' : m.to; }
    const bySubject = await entryCountsBySubject(conn, [...kept.filter(c => c.is_singleton).map(c => c.cat_id), ...diff.catDeletes],
      scope === 'copy' ? userSubjectId : undefined);
    const single = singleScoreError(kept, bySubject, moveTargets);
    if (single) return bad(single.error, { cat_id: single.cat_id });
  }

  const storedFinal = preset.final_period_id != null ? Number(preset.final_period_id) : null;
  const head: PresetHead = {
    name: String(body.name).trim(),
    grade_scale: (body.grade_scale as string | undefined) ?? String(preset.grade_scale ?? '4pt'),
    sentMode: body.final_mode,
    storedMode: normalizeFinalMode(preset.final_mode),
    index: body.final_period_index,
    fallbackIndex: diff.periodUpdates.find(p => p.period_id === storedFinal)?.sort_order ?? null,
  };
  // The rule the writers apply, checked before any write; placeholder ids only need the draft's length.
  const finalCheck = resolveFinal(head.sentMode, head.storedMode, head.index, head.fallbackIndex, draft.map((_, i) => i + 1));
  if ('error' in finalCheck) return bad(finalCheck.error);

  if (scope === 'all') {
    await applyEditAll(conn, presetId, diff, moves, head, draft.length);
    return { status: 200, body: { status: 'success', preset_id: presetId } };
  }
  const newId = await applyEditCopy(conn, userId, presetId, userSubjectId, old, draft, diff.catDeletes, moves, head);
  return { status: 200, body: { status: 'success', preset_id: newId } };
}

/** POST /api/studypulse/subjects/[id]/grading after auth and the subject ownership check, inside an open
    transaction. Switching to a different preset maps the subject's entries that sit outside the new preset's
    categories (`map`: old cat_id -> new cat_id | 'delete'); any unmapped one returns 400 'map-required'. */
export async function setSubjectPresetTx(
  conn: Conn, userId: number, userSubjectId: number, presetId: number,
  opts: { has_lab: unknown; lec_weight: unknown; lab_weight: unknown; map: unknown },
): Promise<TxResult> {
  // The preset must belong to the caller. LOCK IN SHARE MODE (MariaDB 10.4 has no FOR SHARE) keeps it from
  // being deleted or edited until this switch commits.
  const [ownsPreset] = await conn.execute<RowDataPacket[]>(
    'SELECT 1 FROM grading_presets WHERE preset_id=? AND user_id=? LOCK IN SHARE MODE', [presetId, userId]);
  if (!ownsPreset.length) return { status: 404, body: { error: 'Grading system not found' } };

  const [current] = await conn.execute<RowDataPacket[]>(
    'SELECT preset_id FROM subject_grading WHERE user_subject_id=? FOR UPDATE', [userSubjectId]);

  if (current.length && Number(current[0].preset_id) !== presetId) {
    const [newCats] = await conn.execute<RowDataPacket[]>(
      `SELECT gc.cat_id, gc.period_id, gc.is_singleton FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id WHERE gp.preset_id=?`, [presetId]);
    const periodOf = new Map(newCats.map(c => [Number(c.cat_id), Number(c.period_id)]));
    const [byCat] = await conn.execute<RowDataPacket[]>(
      `SELECT ge.cat_id, MAX(gc.name) AS name, COUNT(*) AS entry_count
       FROM grade_entries ge LEFT JOIN grading_categories gc ON gc.cat_id = ge.cat_id
       WHERE ge.user_subject_id=? GROUP BY ge.cat_id FOR UPDATE`, [userSubjectId]);
    const needed = byCat.filter(r => !periodOf.has(Number(r.cat_id)));
    const m = (opts.map && typeof opts.map === 'object' ? opts.map : {}) as Record<string, unknown>;
    const target = (catId: number): number | 'delete' | null => {
      const v = m[String(catId)];
      if (v === 'delete') return 'delete';
      if (typeof v !== 'number' && typeof v !== 'string') return null;
      return v !== '' && periodOf.has(Number(v)) ? Number(v) : null;
    };
    const missing = needed.filter(r => target(Number(r.cat_id)) === null);
    if (missing.length) {
      return {
        status: 400,
        body: {
          error: 'map-required',
          categories: missing.map(r => ({ cat_id: Number(r.cat_id), name: r.name ?? null, entry_count: Number(r.entry_count) })),
        },
      };
    }
    // F1: mapping must not leave this subject with more than one entry in a single-score category.
    const moveTargets: Record<number, number | 'delete'> = {};
    for (const r of needed) moveTargets[Number(r.cat_id)] = target(Number(r.cat_id))!;
    const single = singleScoreError(
      newCats.map(c => ({ cat_id: Number(c.cat_id), is_singleton: Number(c.is_singleton) === 1, was_singleton: Number(c.is_singleton) === 1 })),
      byCat.map(r => ({ cat_id: Number(r.cat_id), user_subject_id: userSubjectId, n: Number(r.entry_count) })),
      moveTargets);
    if (single) return { status: 400, body: { error: single.error, cat_id: single.cat_id } };
    // Sources are outside the new preset and targets inside it, so these updates cannot chain.
    for (const r of needed) {
      const fromCat = Number(r.cat_id);
      const to = target(fromCat)!;
      if (to === 'delete') {
        // canvas_entry_links and the other grade_entry_id FKs are ON DELETE CASCADE.
        await conn.execute('DELETE FROM grade_entries WHERE user_subject_id=? AND cat_id=?', [userSubjectId, fromCat]);
      } else {
        await conn.execute('UPDATE grade_entries SET cat_id=?, period_id=? WHERE user_subject_id=? AND cat_id=?',
          [to, periodOf.get(to)!, userSubjectId, fromCat]);
      }
    }
  }

  await conn.execute(
    `INSERT INTO subject_grading (user_subject_id, preset_id, has_lab, lec_weight, lab_weight)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       preset_id=VALUES(preset_id), has_lab=VALUES(has_lab),
       lec_weight=VALUES(lec_weight), lab_weight=VALUES(lab_weight)`,
    [userSubjectId, presetId, opts.has_lab ? 1 : 0, Number(opts.lec_weight ?? 100), Number(opts.lab_weight ?? 0)]);
  return { status: 200, body: { status: 'success' } };
}
