import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import SubjectCardView from '@/components/studypulse/SubjectCardView';
import type { EntryRow, GradingConfig, LabLinkData } from '@/components/studypulse/SubjectCardView';
import { ensureCanvasSchema, ensureGradingV2Schema, ensureSubjectSection } from '@/lib/migrate';
import { loadGradingConfig, loadSubjectGradeModel } from '@/lib/studypulse/subjectCards';
import { projectPeriod } from '@/lib/studypulse/projection';
import { periodNamesMatch } from '@/lib/studypulse/labLink';
import { todayManila } from '@/lib/studypulse/ui/format';
import '../studypulse.css';

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

  const todayStr = todayManila();

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

  /* ── Custom grading config (shared loader) + its grade_entries ── */
  const gradingConfig: GradingConfig | null = await loadGradingConfig(userSubjectId, userId);
  const initialGradeEntries: Record<number, EntryRow[]> = {};
  if (gradingConfig) {
    try {
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
      for (const e of entries) (initialGradeEntries[e.cat_id as number] ??= []).push(toEntry(e));
    } catch {
      // grade_entries missing: render the config with no entries
    }
  }

  /* ── Linked lecture/lab (spec §3.5): the link plus the partner's raw period grades, so the header, tabs and final
     view can show the combined values. Both sides must be this user's subjects (subject_links has no foreign keys,
     ruling R6). A failure here only drops the lab view; the page still renders. ── */
  let labLink: LabLinkData | null = null;
  if (gradingConfig) {
    try {
      await ensureGradingV2Schema();
      const [links] = await pool.execute<RowDataPacket[]>(`
        SELECT sl.lecture_user_subject_id AS lec, sl.lab_user_subject_id AS lab, sl.lecture_weight,
               sub_lec.course_code AS lec_code, sub_lec.subject_name AS lec_name, sub_lec.units AS lec_units,
               sub_lab.course_code AS lab_code, sub_lab.subject_name AS lab_name, sub_lab.units AS lab_units
        FROM subject_links sl
        JOIN user_subjects ul ON ul.user_subject_id = sl.lecture_user_subject_id AND ul.user_id = ?
        JOIN user_subjects ub ON ub.user_subject_id = sl.lab_user_subject_id AND ub.user_id = ?
        JOIN subjects sub_lec ON sub_lec.subject_id = ul.subject_id
        JOIN subjects sub_lab ON sub_lab.subject_id = ub.subject_id
        WHERE sl.lecture_user_subject_id = ? OR sl.lab_user_subject_id = ?
        LIMIT 1
      `, [userId, userId, userSubjectId, userSubjectId]);
      if (links.length) {
        const l = links[0];
        const isLecture = Number(l.lec) === userSubjectId;
        const partnerId = Number(isLecture ? l.lab : l.lec);
        const partner = await loadSubjectGradeModel(partnerId, userId);
        const ownNames = gradingConfig.preset.periods.map(p => String(p.name));
        const periodsMatch = !!partner && periodNamesMatch(ownNames, partner.periods.map(p => p.name));
        // A lab page follows the lecture's final rule, as the subject cards do; the period index carries across.
        let lectureFinal: LabLinkData['lectureFinal'] = null;
        if (!isLecture && partner) {
          const { final_mode, final_period_id } = partner.config.preset;
          const idx = partner.config.preset.periods.findIndex(p => p.period_id === final_period_id);
          lectureFinal = { mode: final_mode ?? null, periodIndex: idx >= 0 ? idx : null };
        }
        const units = Number(l.lec_units) + Number(l.lab_units);
        labLink = {
          role: isLecture ? 'lecture' : 'lab',
          partner: { id: partnerId, code: String(isLecture ? l.lab_code : l.lec_code), name: String(isLecture ? l.lab_name : l.lec_name) },
          lectureWeight: Number(l.lecture_weight),
          units: Number.isFinite(units) && units > 0 ? units : null,
          periodsMatch,
          partnerCurrents: partner ? partner.periods.map(p => projectPeriod(p).current) : [],
          // With Transmute on, the client rebuilds the partner's currents transmuted from these (raw rows, by cat_id).
          partnerPreset: partner ? { periods: partner.config.preset.periods } : null,
          partnerEntries: partner
            ? Object.fromEntries(Object.entries(partner.entries).map(([cat, rows]) => [cat, rows.map(r => ({ name: r.name, score: r.score, items: r.items, grade: r.grade }))]))
            : {},
          lectureFinal,
        };
      }
    } catch (err) {
      console.error(`[studypulse] lab link failed for user_subject_id=${userSubjectId}:`, err);
    }
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
      labLink={labLink}
    />
  );
}
