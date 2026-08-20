import { auth } from '@/auth';
import pool from '@/lib/db';
import { syncConnection } from '@/lib/canvas/sync';
import type { RowDataPacket } from 'mysql2';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM canvas_connections WHERE user_id = ? AND status = 'active'`, [userId],
  );
  if (rows.length === 0) {
    return Response.json({ error: 'No active Canvas connection' }, { status: 400 });
  }

  const result = await syncConnection(rows[0].id as number, 'manual');
  return Response.json(result);
}
