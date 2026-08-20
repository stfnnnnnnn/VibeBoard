import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

interface BankItemRow extends RowDataPacket {
  id: number; name: string; due_at: string | null; submission_score: number | null;
  user_subject_id: number;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const bankId = parseInt(id);
  const userId = parseInt(session.user.id);
  const { target_type, cat_id, period_id } = await req.json();
  // target_type: 'activities' | 'quizzes' | 'exams' | 'grade_entries'

  const [rows] = await pool.execute<BankItemRow[]>(
    `SELECT bank.id, bank.name, bank.due_at, bank.submission_score, cc.user_subject_id
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

  const deadline = item.due_at ? item.due_at.slice(0, 10) : null;
  const commonFields = {
    entryId: null, userSubjectId: item.user_subject_id, name: item.name,
    specificType: '', urgency: 'Medium', status: 'Pending', deadline,
    score: null, items: null, grade: item.submission_score, accomplishedAt: null,
  };

  let linkColumn: 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
  let newEntryId: number;

  if (target_type === 'activities') {
    newEntryId = (await insertActivityEntry(commonFields)).entryId;
    linkColumn = 'activity_id';
  } else if (target_type === 'quizzes') {
    newEntryId = (await insertQuizEntry(commonFields)).entryId;
    linkColumn = 'quiz_id';
  } else if (target_type === 'exams') {
    newEntryId = (await insertExamEntry(commonFields)).entryId;
    linkColumn = 'exam_id';
  } else if (target_type === 'grade_entries') {
    if (!cat_id || !period_id) {
      return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
    }
    newEntryId = (await insertGradeEntry({ ...commonFields, catId: cat_id, periodId: period_id, isLab: false })).entryId;
    linkColumn = 'grade_entry_id';
  } else {
    return Response.json({ error: 'Invalid target_type' }, { status: 400 });
  }

  await pool.execute(
    `INSERT INTO canvas_entry_links (bank_item_id, ${linkColumn}) VALUES (?, ?)`,
    [bankId, newEntryId],
  );
  await pool.execute(`UPDATE canvas_activity_bank SET bank_status = 'included' WHERE id = ?`, [bankId]);

  return Response.json({ status: 'success', entry_id: newEntryId });
}
