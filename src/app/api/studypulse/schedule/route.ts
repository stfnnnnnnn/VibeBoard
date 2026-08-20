import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/* GET /api/studypulse/schedule — list all class blocks for the user */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sb.block_id, sb.user_subject_id, sb.course_code, sb.section,
            sb.day_of_week, sb.start_time, sb.end_time, sb.venue, sb.is_online,
            s.subject_name
     FROM schedule_blocks sb
     LEFT JOIN user_subjects us ON sb.user_subject_id = us.user_subject_id
     LEFT JOIN subjects s ON us.subject_id = s.subject_id
     WHERE sb.user_id = ?
     ORDER BY sb.day_of_week ASC, sb.start_time ASC`,
    [userId]
  );

  return Response.json({ blocks: rows });
}

interface MeetingInput {
  day:        number;
  start_time: string;
  end_time:   string;
  venue?:     string | null;
  is_online?: boolean;
}

/* POST /api/studypulse/schedule — create one block per meeting. Each meeting
   carries its own day/time/venue/modality, so the same course can meet
   face-to-face on one day and online on another. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { user_subject_id, course_code, section, meetings } = await req.json() as {
    user_subject_id?: number | null; course_code?: string; section?: string | null; meetings?: MeetingInput[];
  };

  if (!course_code || !Array.isArray(meetings) || meetings.length === 0) {
    return Response.json({ error: 'course_code and at least one meeting are required' }, { status: 400 });
  }
  for (const m of meetings) {
    if (m.day == null || m.day < 0 || m.day > 5 || !m.start_time || !m.end_time) {
      return Response.json({ error: 'Each meeting needs a day, start time, and end time.' }, { status: 400 });
    }
    if (m.start_time >= m.end_time) {
      return Response.json({ error: 'End time must be after start time.' }, { status: 400 });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const insertedIds: number[] = [];
    for (const m of meetings) {
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO schedule_blocks
           (user_id, user_subject_id, course_code, section, day_of_week, start_time, end_time, venue, is_online)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, user_subject_id ?? null, course_code, section || null, Number(m.day),
         m.start_time, m.end_time, m.venue || null, m.is_online ? 1 : 0]
      );
      insertedIds.push(res.insertId);
    }
    await conn.commit();
    return Response.json({ status: 'success', block_ids: insertedIds });
  } catch (err) {
    await conn.rollback();
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    conn.release();
  }
}

/* DELETE /api/studypulse/schedule — clear all blocks for the user */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  await pool.execute('DELETE FROM schedule_blocks WHERE user_id = ?', [userId]);
  return Response.json({ status: 'success' });
}
