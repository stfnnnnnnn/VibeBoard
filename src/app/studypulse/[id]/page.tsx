import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import SubjectCardView from '@/components/studypulse/SubjectCardView';
import type { EntryRow, GradingConfig } from '@/components/studypulse/SubjectCardView';
import { ensureCanvasSchema, ensureSubjectSection } from '@/lib/migrate';

export default async function SubjectCardPage(
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // The four entry queries below join canvas_entry_links (for the canvas_linked
  // flag), so make sure the Canvas tables exist before running them — idempotent,
  // cheap after the first call. The Canvas flag is an optional nicety, though, and
  // those CREATE TABLEs declare foreign keys into six existing tables: if any of it
  // fails on a given host (missing privilege, collation/engine mismatch, …) this page
  // must still render, so fall back to the pre-Canvas queries with canvas_linked off
  // — the same "optional feature table might not exist" handling used for the grading
  // tables further down.
  let canvasReady = true;
  try {
    await ensureCanvasSchema();
  } catch (err) {
    console.error('ensureCanvasSchema() failed; rendering without Canvas link flags:', err);
    canvasReady = false;
  }

  /** Runs the canvas_entry_links-joined query, falling back to the plain one on any failure. */
  async function selectEntries(
    sqlWithCanvas: string, sqlWithoutCanvas: string, params: (string | number)[],
  ): Promise<RowDataPacket[]> {
    if (canvasReady) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(sqlWithCanvas, params);
        return rows;
      } catch (err) {
        console.error('canvas_entry_links join failed; retrying without it:', err);
        canvasReady = false;
      }
    }
    const [rows] = await pool.execute<RowDataPacket[]>(sqlWithoutCanvas, params);
    return rows;
  }

  const { id } = await props.params;
  const userId        = parseInt(session.user.id);
  const userSubjectId = parseInt(id);

  await ensureSubjectSection();
  const [subjects] = await pool.execute<RowDataPacket[]>(`
    SELECT s.subject_name, s.course_code, s.section, s.units, s.year_level, s.trimester
    FROM user_subjects us
    JOIN subjects s ON us.subject_id = s.subject_id
    WHERE us.user_subject_id = ? AND us.user_id = ?
  `, [userSubjectId, userId]);

  if (!subjects.length) redirect('/studypulse');
  const sub = subjects[0];

  const todayStr = new Date().toISOString().split('T')[0];

  function toEntry(r: RowDataPacket, overrideType?: string): EntryRow {
    const rawAc = r.accomplished_at ? String(r.accomplished_at).split('T')[0] : '';
    return {
      id:           r.id as number,
      name:         String(r.name ?? ''),
      specificType: overrideType ?? String(r.specificType ?? ''),
      urgency:      (r.urgency as EntryRow['urgency']) ?? 'Low',
      status:       (r.status  as EntryRow['status'])  ?? 'Pending',
      deadline:        r.deadline ? String(r.deadline).split('T')[0] : '',
      // Reject any accomplished_at that is in the future — it means deadline bled into this field
      accomplished_at: rawAc && rawAc <= todayStr ? rawAc : '',
      score:        r.score != null ? String(r.score) : '',
      items:        r.items != null ? String(r.items) : '',
      grade:        r.grade != null ? Number(r.grade)  : null,
      canvas_linked: !!r.canvas_linked,
    };
  }

  /* ── Try to load custom grading config ── */
  let gradingConfig: GradingConfig | null = null;
  let initialGradeEntries: Record<number, EntryRow[]> = {};

  try {
    const [sgRows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM subject_grading WHERE user_subject_id=?',
      [userSubjectId]
    );

    if (sgRows.length) {
      const sg       = sgRows[0];
      const presetId = sg.preset_id as number;

      const [presets] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM grading_presets WHERE preset_id=?', [presetId]
      );
      const [periods] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM grading_periods WHERE preset_id=? ORDER BY sort_order', [presetId]
      );
      const [cats] = await pool.execute<RowDataPacket[]>(
        `SELECT gc.* FROM grading_categories gc
         JOIN grading_periods gp ON gc.period_id=gp.period_id
         WHERE gp.preset_id=? ORDER BY gc.period_id, gc.sort_order`,
        [presetId]
      );

      if (presets.length) {
        const preset = {
          ...presets[0],
          periods: periods.map(p => ({
            ...p,
            categories: cats.filter(c => c.period_id === p.period_id),
          })),
        };

        gradingConfig = {
          preset_id:   Number(sg.preset_id),
          has_lab:     Number(sg.has_lab),
          lec_weight:  Number(sg.lec_weight),
          lab_weight:  Number(sg.lab_weight),
          grade_scale: ((preset as unknown as Record<string, unknown>).grade_scale as GradingConfig['grade_scale']) ?? '4pt',
          preset:      preset as GradingConfig['preset'],
        };

        /* Load grade_entries grouped by cat_id */
        const allCatIds = cats.map(c => c.cat_id as number);
        if (allCatIds.length) {
          const entries = await selectEntries(
            `SELECT ge.entry_id AS id, ge.name, '' AS specificType, ge.urgency, ge.status, ge.deadline,
                    ge.score, ge.items, ge.grade, ge.cat_id, ge.is_lab, ge.accomplished_at,
                    (cel.grade_entry_id IS NOT NULL) AS canvas_linked
             FROM grade_entries ge
             LEFT JOIN canvas_entry_links cel ON cel.grade_entry_id = ge.entry_id
             WHERE ge.user_subject_id=? ORDER BY ge.entry_id ASC`,
            `SELECT ge.entry_id AS id, ge.name, '' AS specificType, ge.urgency, ge.status, ge.deadline,
                    ge.score, ge.items, ge.grade, ge.cat_id, ge.is_lab, ge.accomplished_at
             FROM grade_entries ge
             WHERE ge.user_subject_id=? ORDER BY ge.entry_id ASC`,
            [userSubjectId]
          );
          for (const e of entries) {
            const catId = e.cat_id as number;
            if (!initialGradeEntries[catId]) initialGradeEntries[catId] = [];
            initialGradeEntries[catId].push(toEntry(e));
          }
        }
      }
    }
  } catch {
    // grading tables not yet created — fall through to legacy mode
  }

  /* ── Load existing presets list (for wizard) ── */
  let existingPresets: Array<{ preset_id: number; name: string; period_count: number }> = [];
  try {
    const [presetRows] = await pool.execute<RowDataPacket[]>(
      `SELECT p.preset_id, p.name, COUNT(DISTINCT gp.period_id) AS period_count
       FROM grading_presets p
       LEFT JOIN grading_periods gp ON gp.preset_id=p.preset_id
       WHERE p.user_id=?
       GROUP BY p.preset_id ORDER BY p.is_default DESC, p.created_at ASC`,
      [userId]
    );
    existingPresets = presetRows.map(r => ({
      preset_id:    Number(r.preset_id),
      name:         String(r.name),
      period_count: Number(r.period_count),
    }));
  } catch {
    // grading_presets table not yet created
  }

  /* ── Legacy entries (only loaded when no grading config) ── */
  let initialActivities: EntryRow[] = [];
  let initialQuizzes:    EntryRow[] = [];
  let initialExams:      EntryRow[] = [];

  if (!gradingConfig) {
    const actRows = await selectEntries(`
      SELECT a.activity_id AS id, a.activity_name AS name, a.activity_type AS specificType,
             a.urgency, a.status, a.deadline, a.score, a.items, a.grade, a.accomplished_at,
             (cel.activity_id IS NOT NULL) AS canvas_linked
      FROM activities a
      LEFT JOIN canvas_entry_links cel ON cel.activity_id = a.activity_id
      WHERE a.user_subject_id=? ORDER BY a.activity_id ASC
    `, `
      SELECT a.activity_id AS id, a.activity_name AS name, a.activity_type AS specificType,
             a.urgency, a.status, a.deadline, a.score, a.items, a.grade, a.accomplished_at
      FROM activities a
      WHERE a.user_subject_id=? ORDER BY a.activity_id ASC
    `, [userSubjectId]);

    const quizRows = await selectEntries(`
      SELECT q.quiz_id AS id, q.quiz_name AS name, q.quiz_number AS specificType,
             q.urgency, q.status, q.deadline, q.score, q.items, q.grade, q.accomplished_at,
             (cel.quiz_id IS NOT NULL) AS canvas_linked
      FROM quizzes q
      LEFT JOIN canvas_entry_links cel ON cel.quiz_id = q.quiz_id
      WHERE q.user_subject_id=? ORDER BY q.quiz_number ASC
    `, `
      SELECT q.quiz_id AS id, q.quiz_name AS name, q.quiz_number AS specificType,
             q.urgency, q.status, q.deadline, q.score, q.items, q.grade, q.accomplished_at
      FROM quizzes q
      WHERE q.user_subject_id=? ORDER BY q.quiz_number ASC
    `, [userSubjectId]);

    const examRows = await selectEntries(`
      SELECT e.exam_id AS id, e.exam_name AS name, e.exam_type AS specificType,
             e.urgency, e.status, e.deadline, e.score, e.items, e.grade, e.accomplished_at,
             (cel.exam_id IS NOT NULL) AS canvas_linked
      FROM exams e
      LEFT JOIN canvas_entry_links cel ON cel.exam_id = e.exam_id
      WHERE e.user_subject_id=? ORDER BY e.exam_id ASC
    `, `
      SELECT e.exam_id AS id, e.exam_name AS name, e.exam_type AS specificType,
             e.urgency, e.status, e.deadline, e.score, e.items, e.grade, e.accomplished_at
      FROM exams e
      WHERE e.user_subject_id=? ORDER BY e.exam_id ASC
    `, [userSubjectId]);

    initialActivities = actRows.map(r  => toEntry(r));
    initialQuizzes    = quizRows.map((r, i) => toEntry(r, String(i + 1)));
    initialExams      = examRows.map(r => toEntry(r));
  }

  return (
    <SubjectCardView
      subject={{
        subject_name: sub.subject_name as string,
        course_code:  sub.course_code as string,
        section:      sub.section as string | null,
        units:        sub.units as number,
        year_level:   sub.year_level as string,
        trimester:    sub.trimester as string,
      }}
      userSubjectId={userSubjectId}
      initialActivities={initialActivities}
      initialQuizzes={initialQuizzes}
      initialExams={initialExams}
      gradingConfig={gradingConfig}
      initialGradeEntries={initialGradeEntries}
      existingPresets={existingPresets}
    />
  );
}
