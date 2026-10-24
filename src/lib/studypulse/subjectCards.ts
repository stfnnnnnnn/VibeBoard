/* Server-only StudyPulse loaders shared by /studypulse/subjects, GET /api/studypulse/subjects and
   /studypulse/[id]. Imports the DB pool, so it is excluded from scripts/sp-test.mjs. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureGradingV2Schema, ensureSubjectSection } from '@/lib/migrate';
import { buildCustomPeriods, buildLegacyPeriods } from './periodModel';
import { normalizeFinalMode, projectPeriod, subjectOverall, type PeriodInput } from './projection';
import { combinePeriods, overallOfCurrents, periodNamesMatch } from './labLink';
import { EMPTY_PREFS } from './prefs';
import type { EntryRow, GradingConfig, SubjectCardData } from './types';

/** The subject's custom grading config, or null (no config, or grading tables not created yet). */
export async function loadGradingConfig(userSubjectId: number): Promise<GradingConfig | null> {
  try {
    await ensureGradingV2Schema();
    const [sgRows] = await pool.execute<RowDataPacket[]>('SELECT * FROM subject_grading WHERE user_subject_id=?', [userSubjectId]);
    if (!sgRows.length) return null;
    const sg = sgRows[0];
    const presetId = sg.preset_id as number;
    const [presets] = await pool.execute<RowDataPacket[]>('SELECT * FROM grading_presets WHERE preset_id=?', [presetId]);
    if (!presets.length) return null;
    const [periods] = await pool.execute<RowDataPacket[]>('SELECT * FROM grading_periods WHERE preset_id=? ORDER BY sort_order', [presetId]);
    const [cats] = await pool.execute<RowDataPacket[]>(
      `SELECT gc.* FROM grading_categories gc
       JOIN grading_periods gp ON gc.period_id=gp.period_id
       WHERE gp.preset_id=? ORDER BY gc.period_id, gc.sort_order`, [presetId],
    );
    const preset = {
      ...presets[0],
      final_mode: normalizeFinalMode(presets[0].final_mode),
      periods: periods.map(p => ({ ...p, categories: cats.filter(c => c.period_id === p.period_id) })),
    };
    return {
      preset_id: Number(sg.preset_id),
      has_lab: Number(sg.has_lab),
      lec_weight: Number(sg.lec_weight),
      lab_weight: Number(sg.lab_weight),
      grade_scale: ((preset as unknown as Record<string, unknown>).grade_scale as GradingConfig['grade_scale']) ?? '4pt',
      preset: preset as unknown as GradingConfig['preset'],
    };
  } catch {
    return null;
  }
}

type Lite = Pick<EntryRow, 'name' | 'score' | 'items' | 'grade'> & { specificType?: string };
const lite = (r: RowDataPacket): Lite => ({
  name: String(r.name ?? ''),
  score: r.score != null ? String(r.score) : '',
  items: r.items != null ? String(r.items) : '',
  grade: r.grade != null ? Number(r.grade) : null,
  specificType: r.specificType != null ? String(r.specificType) : '',
});

type CardGrade = Pick<SubjectCardData, 'current_grade' | 'grade_scale'>;

export interface SubjectGradeModel { periods: PeriodInput[]; config: GradingConfig }

/** Period inputs (raw grades, default prefs) plus the custom grading config for one subject; null when the
    subject has no custom config (legacy grading). No ownership check: callers verify ownership first. */
export async function loadSubjectGradeModel(userSubjectId: number): Promise<SubjectGradeModel | null> {
  const config = await loadGradingConfig(userSubjectId);
  if (!config) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT cat_id, name, score, items, grade FROM grade_entries WHERE user_subject_id=?', [userSubjectId],
  );
  const byCat: Record<number, Lite[]> = {};
  for (const r of rows) (byCat[r.cat_id as number] ??= []).push(lite(r));
  return { periods: buildCustomPeriods(config.preset, byCat, EMPTY_PREFS, null), config };
}

type GradeInfo = CardGrade & { model: SubjectGradeModel | null };

/** Overall current grade for a card. Never throws: a failed query shows the card ungraded instead of failing
    the whole list (this runs per subject inside Promise.all, and Workboard's dialog uses the same API). */
export async function currentGradeFor(userSubjectId: number): Promise<CardGrade> {
  const { current_grade, grade_scale } = await gradeInfoFor(userSubjectId);
  return { current_grade, grade_scale };
}

async function gradeInfoFor(userSubjectId: number): Promise<GradeInfo> {
  try {
    return await computeGradeInfo(userSubjectId);
  } catch (err) {
    console.error(`[studypulse] current grade failed for user_subject_id=${userSubjectId}:`, err);
    return { current_grade: null, grade_scale: null, model: null };
  }
}

/** Raw grades only: the transmutation table is client-loaded. */
async function computeGradeInfo(userSubjectId: number): Promise<GradeInfo> {
  const model = await loadSubjectGradeModel(userSubjectId);
  if (model) {
    const { final_mode, final_period_id } = model.config.preset;
    return {
      current_grade: subjectOverall(model.periods, final_mode ?? null, final_period_id != null ? 'p' + final_period_id : null),
      grade_scale: model.config.grade_scale,
      model,
    };
  }
  const [acts] = await pool.execute<RowDataPacket[]>('SELECT activity_name AS name, score, items, grade FROM activities WHERE user_subject_id=?', [userSubjectId]);
  const [quizzes] = await pool.execute<RowDataPacket[]>('SELECT quiz_name AS name, score, items, grade FROM quizzes WHERE user_subject_id=?', [userSubjectId]);
  const [exams] = await pool.execute<RowDataPacket[]>('SELECT exam_name AS name, exam_type AS specificType, score, items, grade FROM exams WHERE user_subject_id=?', [userSubjectId]);
  const [overall] = buildLegacyPeriods(acts.map(lite), quizzes.map(lite), exams.map(lite), EMPTY_PREFS, null);
  return { current_grade: projectPeriod(overall).current, grade_scale: '4pt', model: null };
}

/** The user's lecture/lab links. Both sides must be the user's subjects (subject_links has no foreign keys,
    so orphaned rows stay inert). Never throws: links are an enhancement, the list must still load. */
async function loadUserLinks(userId: number): Promise<{ lec: number; lab: number; weight: number }[]> {
  try {
    await ensureGradingV2Schema();
    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT sl.lecture_user_subject_id AS lec, sl.lab_user_subject_id AS lab, sl.lecture_weight AS weight
      FROM subject_links sl
      JOIN user_subjects ul ON ul.user_subject_id = sl.lecture_user_subject_id AND ul.user_id = ?
      JOIN user_subjects ub ON ub.user_subject_id = sl.lab_user_subject_id AND ub.user_id = ?
    `, [userId, userId]);
    return rows.map(r => ({ lec: Number(r.lec), lab: Number(r.lab), weight: Number(r.weight) }));
  } catch (err) {
    console.error(`[studypulse] subject links failed for user_id=${userId}:`, err);
    return [];
  }
}

/** Combined grade for a linked pair: per-period combination, then the lecture subject's final rule.
    Null when either side lacks a custom model or the period names no longer line up. */
function combinedGrade(lec: SubjectGradeModel | null, lab: SubjectGradeModel | null, weight: number): CardGrade | null {
  if (!lec || !lab) return null;
  if (!periodNamesMatch(lec.periods.map(p => p.name), lab.periods.map(p => p.name))) return null;
  const currents = (m: SubjectGradeModel) => m.periods.map(p => projectPeriod(p).current);
  const combined = combinePeriods(currents(lec), currents(lab), weight);
  const { final_mode, final_period_id } = lec.config.preset;
  return {
    current_grade: overallOfCurrents(
      combined, lec.periods.map(p => p.key), final_mode ?? null, final_period_id != null ? 'p' + final_period_id : null,
    ),
    grade_scale: lec.config.grade_scale,
  };
}

export async function listSubjectCards(userId: number): Promise<SubjectCardData[]> {
  await ensureSubjectSection();
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT us.user_subject_id, s.subject_name, s.course_code, s.section,
           s.units, s.year_level, s.trimester
    FROM user_subjects us
    JOIN subjects s ON us.subject_id = s.subject_id
    WHERE us.user_id = ?
    ORDER BY us.user_subject_id DESC
  `, [userId]);

  const cards = await Promise.all(rows.map(async sub => {
    const id = sub.user_subject_id as number;
    const [prog] = await pool.execute<RowDataPacket[]>(`
      SELECT SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS completed, COUNT(*) AS total
      FROM (
        SELECT status FROM activities WHERE user_subject_id = ?
        UNION ALL SELECT status FROM quizzes WHERE user_subject_id = ?
        UNION ALL SELECT status FROM exams WHERE user_subject_id = ?
        UNION ALL SELECT status FROM grade_entries WHERE user_subject_id = ?
      ) t
    `, [id, id, id, id]);
    const completed = Number(prog[0].completed ?? 0);
    const total = Number(prog[0].total ?? 0);
    return {
      user_subject_id: id,
      subject_name: sub.subject_name as string,
      course_code: sub.course_code as string,
      section: sub.section as string | null,
      units: sub.units as number,
      year_level: sub.year_level as string,
      trimester: sub.trimester as string,
      completed_tasks: completed,
      total_tasks: total,
      progress_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      ...(await gradeInfoFor(id)),
      lab_tag: null as SubjectCardData['lab_tag'],
    };
  }));

  const byId = new Map(cards.map(c => [c.user_subject_id, c]));
  for (const link of await loadUserLinks(userId)) {
    const lec = byId.get(link.lec), lab = byId.get(link.lab);
    if (!lec || !lab) continue;
    const grade = combinedGrade(lec.model, lab.model, link.weight);
    if (!grade) continue;
    for (const c of [lec, lab]) Object.assign(c, grade, { lab_tag: 'Lec + Lab' as const });
  }
  return cards.map(({ model: _model, ...card }) => card);
}
