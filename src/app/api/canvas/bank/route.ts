import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { suggestBankTarget, suggestLegacyTarget, type BankSuggestion } from '@/lib/canvas/classify';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  const userSubjectIdParam = req.nextUrl.searchParams.get('user_subject_id');
  const userSubjectId = userSubjectIdParam !== null ? parseInt(userSubjectIdParam) : null;

  // A bank item's mapped subject is in "custom" mode when it has a subject_grading row
  // pointing at a real grading preset — the same condition src/app/studypulse/[id]/page.tsx
  // uses to decide whether to render the legacy activities/quizzes/exams tables at all.
  // Items on a custom-mode subject can't be Included through the legacy path (the inserted
  // row would never be displayed), so the client needs to know which mode each item is in.
  //
  // The optional user_subject_id filter scopes results to a single subject (used by the
  // subject-page panel). It's appended to the existing conn.user_id = ? ownership chain
  // rather than trusted on its own — canvas_courses.user_subject_id can only ever point at
  // a subject the connection's own user owns (enforced in the course-mapping route), so a
  // caller passing a user_subject_id they don't own simply gets zero rows back, never
  // another user's data.
  const SELECT_WITH_MODE = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id,
           CASE WHEN gp.preset_id IS NOT NULL THEN 'custom' ELSE 'legacy' END AS subject_mode
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     LEFT JOIN subject_grading sg ON sg.user_subject_id = cc.user_subject_id
     LEFT JOIN grading_presets gp ON gp.preset_id = sg.preset_id
     WHERE conn.user_id = ? AND bank.bank_status = ?${userSubjectId !== null ? ' AND cc.user_subject_id = ?' : ''}
     ORDER BY bank.due_at IS NULL, bank.due_at ASC`;

  const SELECT_LEGACY_ONLY = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id, 'legacy' AS subject_mode
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE conn.user_id = ? AND bank.bank_status = ?${userSubjectId !== null ? ' AND cc.user_subject_id = ?' : ''}
     ORDER BY bank.due_at IS NULL, bank.due_at ASC`;

  const params = userSubjectId !== null ? [userId, status, userSubjectId] : [userId, status];

  let rows: RowDataPacket[];
  try {
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_WITH_MODE, params);
  } catch (err) {
    // grading tables not yet created on this database — every subject is legacy-mode.
    console.error('Canvas bank: grading-mode join failed, falling back to legacy mode:', err);
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_LEGACY_ONLY, params);
  }

  // "Goes to Period › Category" suggestions for pending items. Every subject id below comes from
  // rows already scoped to conn.user_id, so these reads stay inside the caller's own data. Each
  // distinct custom subject's periods+categories (and its most recent entry's period) is loaded
  // once, not per row.
  type PeriodTree = Parameters<typeof suggestBankTarget>[1];
  const subjectCache = new Map<number, { periods: PeriodTree; recentPeriodId: number | null }>();
  async function loadSubject(sid: number) {
    const cached = subjectCache.get(sid);
    if (cached) return cached;
    const [cats] = await pool.execute<RowDataPacket[]>(
      `SELECT gp.period_id, gp.name AS period_name, gc.cat_id, gc.name AS cat_name
       FROM subject_grading sg
       JOIN grading_periods gp ON gp.preset_id = sg.preset_id
       LEFT JOIN grading_categories gc ON gc.period_id = gp.period_id
       WHERE sg.user_subject_id = ?
       ORDER BY gp.sort_order, gp.period_id, gc.sort_order, gc.cat_id`,
      [sid],
    );
    const periods: PeriodTree = [];
    for (const r of cats) {
      let p = periods.find(x => x.period_id === r.period_id);
      if (!p) { p = { period_id: r.period_id, name: r.period_name, categories: [] }; periods.push(p); }
      if (r.cat_id !== null) p.categories.push({ cat_id: r.cat_id, name: r.cat_name });
    }
    const [recent] = await pool.execute<RowDataPacket[]>(
      'SELECT period_id FROM grade_entries WHERE user_subject_id = ? ORDER BY entry_id DESC LIMIT 1',
      [sid],
    );
    const entry = { periods, recentPeriodId: recent.length ? (recent[0].period_id as number) : null };
    subjectCache.set(sid, entry);
    return entry;
  }

  const items = [];
  for (const row of rows) {
    let suggestion: BankSuggestion | { legacy: ReturnType<typeof suggestLegacyTarget> } | null = null;
    if (row.bank_status === 'pending' && row.user_subject_id) {
      if (row.subject_mode === 'custom') {
        const { periods, recentPeriodId } = await loadSubject(row.user_subject_id as number);
        suggestion = suggestBankTarget(row.name as string, periods, recentPeriodId);
      } else {
        suggestion = { legacy: suggestLegacyTarget(row.name as string) };
      }
    }
    items.push({
      ...row,
      // DECIMAL columns arrive as strings from mysql2; hand the client numbers.
      points_possible: row.points_possible === null ? null : Number(row.points_possible),
      submission_score: row.submission_score === null ? null : Number(row.submission_score),
      suggestion,
    });
  }
  return Response.json({ items });
}
