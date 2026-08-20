import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';

const TABLE_MAP: Record<string, [string, string]> = {
  activities: ['activities', 'activity_id'],
  quizzes:    ['quizzes',    'quiz_id'],
  exams:      ['exams',      'exam_id'],
};

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const entryId = parseInt(id);
  const type    = req.nextUrl.searchParams.get('type') ?? '';

  if (!TABLE_MAP[type]) return Response.json({ error: 'Invalid type' }, { status: 400 });

  const [table, idField] = TABLE_MAP[type];
  await pool.execute(`DELETE FROM ${table} WHERE ${idField} = ?`, [entryId]);

  return Response.json({ status: 'success' });
}
