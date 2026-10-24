import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

/* DELETE /api/studypulse/grade-entries/[id] — only an entry of a subject the caller owns (ownership read first). */
export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { id } = await props.params;
  const entryId = parseInt(id);
  if (!Number.isInteger(entryId)) return Response.json({ error: 'Not found' }, { status: 404 });

  const [owned] = await pool.execute<RowDataPacket[]>(
    `SELECT ge.entry_id FROM grade_entries ge
     JOIN user_subjects us ON us.user_subject_id = ge.user_subject_id AND us.user_id = ?
     WHERE ge.entry_id = ?`,
    [userId, entryId]);
  if (!owned.length) return Response.json({ error: 'Not found' }, { status: 404 });

  await pool.execute('DELETE FROM grade_entries WHERE entry_id=?', [entryId]);
  return Response.json({ status: 'success' });
}
