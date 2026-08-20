import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';

/* DELETE /api/studypulse/schedule/[id] — remove a single class block */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await params;

  await pool.execute(
    'DELETE FROM schedule_blocks WHERE block_id = ? AND user_id = ?',
    [parseInt(id), userId]
  );
  return Response.json({ status: 'success' });
}
