/* Server-only StudyPulse loaders shared by /studypulse/subjects, GET /api/studypulse/subjects and
   /studypulse/[id]. Imports the DB pool, so it is excluded from scripts/sp-test.mjs. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureGradingV2Schema, ensureSubjectSection } from '@/lib/migrate';
import { buildCustomPeriods, buildLegacyPeriods } from './periodModel';
import { projectPeriod, subjectOverall } from './projection';
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

/** Overall current grade for a card. Never throws: a failed query shows the card ungraded instead of failing
    the whole list (this runs per subject inside Promise.all, and Workboard's dialog uses the same API). */
export async function currentGradeFor(userSubjectId: number): Promise<CardGrade> {
  try {
    return await computeCurrentGrade(userSubjectId);
  } catch (err) {
    console.error(`[studypulse] current grade failed for user_subject_id=${userSubjectId}:`, err);
    return { current_grade: null, grade_scale: null };
  }
}

/** Raw grades only: the transmutation table is client-loaded. */
async function computeCurrentGrade(userSubjectId: number): Promise<CardGrade> {
  const config = await loadGradingConfig(userSubjectId);
  if (config) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT cat_id, name, score, items, grade FROM grade_entries WHERE user_subject_id=?', [userSubjectId],
    );
    const byCat: Record<number, Lite[]> = {};
    for (const r of rows) (byCat[r.cat_id as number] ??= []).push(lite(r));
    const periods = buildCustomPeriods(config.preset, byCat, EMPTY_PREFS, null);
    return { current_grade: subjectOverall(periods, config.preset.final_mode ?? null), grade_scale: config.grade_scale };
  }
  const [acts] = await pool.execute<RowDataPacket[]>('SELECT activity_name AS name, score, items, grade FROM activities WHERE user_subject_id=?', [userSubjectId]);
  const [quizzes] = await pool.execute<RowDataPacket[]>('SELECT quiz_name AS name, score, items, grade FROM quizzes WHERE user_subject_id=?', [userSubjectId]);
  const [exams] = await pool.execute<RowDataPacket[]>('SELECT exam_name AS name, exam_type AS specificType, score, items, grade FROM exams WHERE user_subject_id=?', [userSubjectId]);
  const [overall] = buildLegacyPeriods(acts.map(lite), quizzes.map(lite), exams.map(lite), EMPTY_PREFS, null);
  return { current_grade: projectPeriod(overall).current, grade_scale: '4pt' };
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

  return Promise.all(rows.map(async sub => {
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
      ...(await currentGradeFor(id)),
    };
  }));
}
