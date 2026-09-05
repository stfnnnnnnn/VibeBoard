import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const overrideId = parseInt(id);

  const [res] = await pool.execute<ResultSetHeader>(
    `DELETE so FROM schedule_overrides so
     JOIN schedule_blocks sb ON sb.block_id = so.block_id
     WHERE so.id = ? AND sb.user_id = ?`,
    [overrideId, userId],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
