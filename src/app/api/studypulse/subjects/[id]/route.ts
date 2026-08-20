import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

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
