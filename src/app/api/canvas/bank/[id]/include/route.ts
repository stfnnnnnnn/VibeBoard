import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { gradeBreakdown } from '@/lib/canvas/normalize';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

interface BankItemRow extends RowDataPacket {
  id: number; name: string; due_at: string | null;
  // DECIMAL(8,2) columns: mysql2 hands these back as strings (no decimalNumbers on this
  // pool) despite the number typing — always coerce before arithmetic.
  points_possible: number | null; submission_score: number | null;
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  user_subject_id: number;
}

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

/**
 * A subject is in "custom" grading mode when it has a subject_grading row pointing at a real
 * grading preset — the same condition src/app/studypulse/[id]/page.tsx uses to decide whether
 * to load the legacy activities/quizzes/exams tables at all. Returns 'legacy' if the grading
 * tables don't exist on this database.
 */
async function getSubjectMode(userSubjectId: number): Promise<'legacy' | 'custom'> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM subject_grading sg
       JOIN grading_presets gp ON gp.preset_id = sg.preset_id
       WHERE sg.user_subject_id = ?`,
      [userSubjectId],
    );
    return rows.length ? 'custom' : 'legacy';
  } catch (err) {
    console.error('Canvas include: grading-mode lookup failed, assuming legacy:', err);
    return 'legacy';
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await props.params;
    const bankId = parseInt(id);
    const userId = parseInt(session.user.id);
    const { target_type, cat_id, period_id } = await req.json();
    // target_type: 'activities' | 'quizzes' | 'exams' | 'grade_entries'

    const [rows] = await pool.execute<BankItemRow[]>(
      `SELECT bank.id, bank.name, bank.due_at, bank.points_possible, bank.submission_score,
              bank.bank_status, cc.user_subject_id
       FROM canvas_activity_bank bank
       JOIN canvas_courses cc ON cc.id = bank.course_id
       JOIN canvas_connections conn ON conn.id = bank.connection_id
       WHERE bank.id = ? AND conn.user_id = ?`,
      [bankId, userId],
    );
    if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });
    const item = rows[0];
    if (!item.user_subject_id) {
      return Response.json({ error: 'This item\'s course is not linked to a subject yet' }, { status: 400 });
    }

    // Re-Include guard. Only un-included items may be Included: 'ignored' is deliberately
    // allowed because the spec's Ignore is explicitly non-final ("an Ignored tab allows
    // flipping it to Include later"). Without this check a second Include would insert a
    // local entry, then blow up on canvas_entry_links' UNIQUE(bank_item_id) — leaving an
    // orphaned row that still counts toward the subject's progress stats.
    if (item.bank_status === 'included') {
      return Response.json({ error: 'This item has already been included' }, { status: 400 });
    }
    if (item.bank_status !== 'pending' && item.bank_status !== 'ignored') {
      return Response.json(
        { error: 'This item is no longer reported by Canvas and can no longer be included' },
        { status: 400 },
      );
    }

    // Server-side mirror of the UI's guard: the Include modal only offers the legacy
    // Activity/Quiz/Exam path, and a legacy row inserted against a custom-mode subject is
    // never rendered anywhere (the subject page only loads those tables when there's no
    // grading config) while still being counted in progress stats and synced forever.
    const subjectMode = await getSubjectMode(item.user_subject_id);
    if (subjectMode === 'custom' && LEGACY_TARGETS.includes(target_type)) {
      return Response.json(
        { error: 'This subject uses custom grading. Canvas Include for custom-graded subjects is not supported yet.' },
        { status: 400 },
      );
    }

    // Canvas reports raw points ("18"), but every consumer of a `grade` column in this app
    // treats it as an already-computed percentage. Store the derived percentage plus the
    // score/items pair the breakdown UI renders alongside it. Missing/zero points_possible
    // leaves all three null rather than producing NaN.
    const { grade, score, items } = gradeBreakdown(item.submission_score, item.points_possible);
    // due_at is stored as a UTC "YYYY-MM-DD HH:MM:SS" string (normalize.ts), so the date
    // portion is deterministic rather than dependent on the server's timezone.
    const deadline = item.due_at ? item.due_at.slice(0, 10) : null;
    const commonFields = {
      entryId: null, userSubjectId: item.user_subject_id, name: item.name,
      specificType: '', urgency: 'Medium', status: 'Pending', deadline,
      score, items, grade, accomplishedAt: null,
    };

    if (target_type === 'grade_entries') {
      if (!cat_id || !period_id) {
        return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
      }
      // Never trust client-supplied cat_id/period_id: confirm the category lives in the given
      // period and that period's preset is the one configured for THIS subject, or a user
      // could link a bank item into another subject's grading category.
      const [owns] = await pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM grading_categories gc
         JOIN grading_periods gp ON gp.period_id = gc.period_id
         JOIN subject_grading sg ON sg.preset_id = gp.preset_id
         WHERE gc.cat_id = ? AND gc.period_id = ? AND sg.user_subject_id = ?`,
        [cat_id, period_id, item.user_subject_id],
      );
      if (!owns.length) {
        return Response.json({ error: 'That category/period does not belong to this subject' }, { status: 400 });
      }
    } else if (!LEGACY_TARGETS.includes(target_type)) {
      return Response.json({ error: 'Invalid target_type' }, { status: 400 });
    }

    // The three writes below are one logical operation — without a transaction a failure on
    // the link insert leaves an orphaned, never-synced local entry behind.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let linkColumn: 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
      let newEntryId: number;

      if (target_type === 'activities') {
        newEntryId = (await insertActivityEntry(commonFields, conn)).entryId;
        linkColumn = 'activity_id';
      } else if (target_type === 'quizzes') {
        newEntryId = (await insertQuizEntry(commonFields, conn)).entryId;
        linkColumn = 'quiz_id';
      } else if (target_type === 'exams') {
        newEntryId = (await insertExamEntry(commonFields, conn)).entryId;
        linkColumn = 'exam_id';
      } else {
        newEntryId = (await insertGradeEntry(
          { ...commonFields, catId: cat_id, periodId: period_id, isLab: false }, conn,
        )).entryId;
        linkColumn = 'grade_entry_id';
      }

      await conn.execute(
        `INSERT INTO canvas_entry_links (bank_item_id, ${linkColumn}) VALUES (?, ?)`,
        [bankId, newEntryId],
      );
      await conn.execute(`UPDATE canvas_activity_bank SET bank_status = 'included' WHERE id = ?`, [bankId]);

      await conn.commit();
      return Response.json({ status: 'success', entry_id: newEntryId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Canvas include failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
