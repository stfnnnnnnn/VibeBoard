import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT cc.* FROM canvas_courses cc
     JOIN canvas_connections conn ON conn.id = cc.connection_id
     WHERE conn.user_id = ?
     ORDER BY cc.mapping_status = 'pending' DESC, cc.name ASC`,
    [userId],
  );
  return Response.json({ courses: rows });
}
