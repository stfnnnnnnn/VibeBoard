import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT bank.*, cc.name AS course_name, cc.user_subject_id
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE conn.user_id = ? AND bank.bank_status = ?
     ORDER BY bank.due_at IS NULL, bank.due_at ASC`,
    [userId, status],
  );
  return Response.json({ items: rows });
}
