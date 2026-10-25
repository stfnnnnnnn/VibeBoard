import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

const TABLE_MAP: Record<string, [string, string]> = {
  activities: ['activities', 'activity_id'],
  quizzes:    ['quizzes',    'quiz_id'],
  exams:      ['exams',      'exam_id'],
};

/* DELETE /api/studypulse/entries/[id]?type=activities|quizzes|exams
   The entry is joined to user_subjects on the caller's user_id, so only the owner's row can go; 404 otherwise. */
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { id } = await props.params;
  const entryId = parseInt(id);
  const type    = req.nextUrl.searchParams.get('type') ?? '';

  if (!TABLE_MAP[type]) return Response.json({ error: 'Invalid type' }, { status: 400 });
  if (!Number.isInteger(entryId)) return Response.json({ error: 'Not found' }, { status: 404 });

  const [table, idField] = TABLE_MAP[type];
  const [r] = await pool.execute<ResultSetHeader>(
    `DELETE e FROM ${table} e
     JOIN user_subjects us ON us.user_subject_id = e.user_subject_id AND us.user_id = ?
     WHERE e.${idField} = ?`,
    [userId, entryId]);
  if (r.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ status: 'success' });
}
