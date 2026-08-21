import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

interface AnnouncementRow extends RowDataPacket {
  id: number;
  title: string;
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  user_subject_id: number;
}

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

/** Same check as the Activity Bank's Include route — a subject is "custom" mode when it has
 *  a subject_grading row pointing at a real grading preset. */
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
    console.error('Canvas announcement include: grading-mode lookup failed, assuming legacy:', err);
    return 'legacy';
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await props.params;
    const announcementId = parseInt(id);
    const userId = parseInt(session.user.id);
    const { target_type, cat_id, period_id, deadline } = await req.json();

    // Announcements carry no due date from Canvas (unlike assignments) — the student supplies one.
    if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      return Response.json({ error: 'A deadline (YYYY-MM-DD) is required' }, { status: 400 });
    }

    const [rows] = await pool.execute<AnnouncementRow[]>(
      `SELECT bank.id, bank.title, bank.bank_status, cc.user_subject_id
       FROM canvas_announcement_bank bank
       JOIN canvas_courses cc ON cc.id = bank.course_id
       JOIN canvas_connections conn ON conn.id = bank.connection_id
       WHERE bank.id = ? AND conn.user_id = ?`,
      [announcementId, userId],
    );
    if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });
    const item = rows[0];
    if (!item.user_subject_id) {
      return Response.json({ error: 'This item\'s course is not linked to a subject yet' }, { status: 400 });
    }

    // Same re-Include guard as the Activity Bank: 'ignored' can still be Included later
    // (that's the whole point of "Keep as Announcement" not being final).
    if (item.bank_status === 'included') {
      return Response.json({ error: 'This announcement has already been included' }, { status: 400 });
    }
    if (item.bank_status !== 'pending' && item.bank_status !== 'ignored') {
      return Response.json(
        { error: 'This announcement is no longer reported by Canvas and can no longer be included' },
        { status: 400 },
      );
    }

    const subjectMode = await getSubjectMode(item.user_subject_id);
    if (subjectMode === 'custom' && LEGACY_TARGETS.includes(target_type)) {
      return Response.json(
        { error: 'This subject uses custom grading. Choose a period and category instead.' },
        { status: 400 },
      );
    }

    // No score/points — announcements aren't graded, unlike assignments.
    const commonFields = {
      entryId: null, userSubjectId: item.user_subject_id, name: item.title,
      specificType: '', urgency: 'Medium', status: 'Pending', deadline,
      score: null, items: null, grade: null, accomplishedAt: null,
    };

    if (target_type === 'grade_entries') {
      if (!cat_id || !period_id) {
        return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
      }
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
        `INSERT INTO canvas_announcement_links (announcement_id, ${linkColumn}) VALUES (?, ?)`,
        [announcementId, newEntryId],
      );
      await conn.execute(
        `UPDATE canvas_announcement_bank SET bank_status = 'included' WHERE id = ?`,
        [announcementId],
      );

      await conn.commit();
      return Response.json({ status: 'success', entry_id: newEntryId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Canvas announcement include failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
