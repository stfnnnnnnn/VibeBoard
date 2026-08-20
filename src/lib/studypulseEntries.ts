import pool from '@/lib/db';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Connection } from 'mysql2/promise';

/**
 * Anything that can run a query: the shared pool (the default, and what every existing
 * caller uses) or a single pooled connection, so a caller that needs these inserts to be
 * part of a transaction can pass its own connection in. Both `Pool` and `PoolConnection`
 * extend `Connection` in mysql2/promise's typings.
 */
export type SqlExecutor = Connection;

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

export async function insertActivityEntry(input: LegacyEntryInput, db: SqlExecutor = pool): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, specificType, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await db.execute(
      'UPDATE activities SET activity_name=?,activity_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE activity_id=? AND user_subject_id=?',
      [name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [r] = await db.execute<ResultSetHeader>(
    'INSERT INTO activities (user_subject_id,activity_name,activity_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export async function insertQuizEntry(input: LegacyEntryInput, db: SqlExecutor = pool): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await db.execute(
      'UPDATE quizzes SET quiz_name=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE quiz_id=? AND user_subject_id=?',
      [name, urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [mx] = await db.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(quiz_number),0)+1 AS next_num FROM quizzes WHERE user_subject_id=?', [userSubjectId],
  );
  const [r] = await db.execute<ResultSetHeader>(
    'INSERT INTO quizzes (user_subject_id,quiz_name,quiz_number,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, mx[0].next_num, urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export async function insertExamEntry(input: LegacyEntryInput, db: SqlExecutor = pool): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, specificType, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await db.execute(
      'UPDATE exams SET exam_name=?,exam_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE exam_id=? AND user_subject_id=?',
      [name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [r] = await db.execute<ResultSetHeader>(
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

export async function insertGradeEntry(input: GradeEntryInput, db: SqlExecutor = pool): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, catId, periodId, isLab, name, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await db.execute(
      `UPDATE grade_entries SET cat_id=?, period_id=?, is_lab=?, name=?, urgency=?,
       status=?, deadline=?, score=?, items=?, grade=?, accomplished_at=?
       WHERE entry_id=? AND user_subject_id=?`,
      [catId, periodId, isLab ? 1 : 0, name, urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO grade_entries
       (user_subject_id, cat_id, period_id, is_lab, name, urgency, status, deadline, score, items, grade, accomplished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userSubjectId, catId, periodId, isLab ? 1 : 0, name, urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: res.insertId };
}
