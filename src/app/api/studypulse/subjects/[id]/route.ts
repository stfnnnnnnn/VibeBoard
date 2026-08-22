import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureSubjectSection } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId        = parseInt(session.user.id);
  const { id }        = await props.params;
  const userSubjectId = parseInt(id);

  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?',
    [userSubjectId, userId]
  );
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 });
  const subjectId = rows[0].subject_id as number;

  const { subject_name, course_code, section, units, year_level, trimester } = await req.json();
  if (!subject_name || !course_code || !year_level || !trimester) {
    return Response.json({ error: 'All fields are required' }, { status: 400 });
  }

  await ensureSubjectSection();
  try {
    await pool.execute(
      `UPDATE subjects SET subject_name=?, course_code=?, section=?, units=?, year_level=?, trimester=?
       WHERE subject_id=?`,
      [
        subject_name.trim(), course_code.trim(), section ? String(section).trim() : null,
        Number(units) || 0, year_level, trimester, subjectId,
      ]
    );
  } catch (err: unknown) {
    // course_code is UNIQUE — the same failure mode the create path can hit.
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'That course code is already in use.' }, { status: 400 });
    }
    throw err;
  }

  return Response.json({ status: 'success' });
}

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId        = parseInt(session.user.id);
  const { id }        = await props.params;
  const userSubjectId = parseInt(id);

  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?',
    [userSubjectId, userId]
  );
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const subjectId = rows[0].subject_id as number;

  for (const table of ['grade_settings', 'activities', 'quizzes', 'exams']) {
    await pool.execute(`DELETE FROM ${table} WHERE user_subject_id = ?`, [userSubjectId]);
  }
  await pool.execute('DELETE FROM user_subjects WHERE user_subject_id = ?', [userSubjectId]);

  const [check] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM user_subjects WHERE subject_id = ?',
    [subjectId]
  );
  if (Number(check[0].cnt) === 0) {
    await pool.execute('DELETE FROM subjects WHERE subject_id = ?', [subjectId]);
  }

  return Response.json({ status: 'success' });
}
