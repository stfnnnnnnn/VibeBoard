import pool from '@/lib/db';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface LegacyEntryInput {
  entryId?:        number | null;
  userSubjectId:   number;
  name:            string;
  specificType:    string;
  urgency:         string;
  status:          string;
  deadline:        string | null;
  score:           number | null;
  items:           number | null;
  grade:           number | null;
  accomplishedAt:  string | null;
}

export async function insertActivityEntry(input: LegacyEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, specificType, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      'UPDATE activities SET activity_name=?,activity_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE activity_id=? AND user_subject_id=?',
      [name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO activities (user_subject_id,activity_name,activity_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export async function insertQuizEntry(input: LegacyEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      'UPDATE quizzes SET quiz_name=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE quiz_id=? AND user_subject_id=?',
      [name, urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [mx] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(quiz_number),0)+1 AS next_num FROM quizzes WHERE user_subject_id=?', [userSubjectId],
  );
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO quizzes (user_subject_id,quiz_name,quiz_number,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, mx[0].next_num, urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export async function insertExamEntry(input: LegacyEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, specificType, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      'UPDATE exams SET exam_name=?,exam_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE exam_id=? AND user_subject_id=?',
      [name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO exams (user_subject_id,exam_name,exam_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export interface GradeEntryInput {
  entryId?:        number | null;
  userSubjectId:   number;
  catId:           number;
  periodId:        number;
  isLab:           boolean;
  name:            string;
  urgency:         string;
  status:          string;
  deadline:        string | null;
  score:           number | null;
  items:           number | null;
  grade:           number | null;
  accomplishedAt:  string | null;
}

export async function insertGradeEntry(input: GradeEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, catId, periodId, isLab, name, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      `UPDATE grade_entries SET cat_id=?, period_id=?, is_lab=?, name=?, urgency=?,
       status=?, deadline=?, score=?, items=?, grade=?, accomplished_at=?
       WHERE entry_id=? AND user_subject_id=?`,
      [catId, periodId, isLab ? 1 : 0, name, urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO grade_entries
       (user_subject_id, cat_id, period_id, is_lab, name, urgency, status, deadline, score, items, grade, accomplished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userSubjectId, catId, periodId, isLab ? 1 : 0, name, urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: res.insertId };
}
