import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT trimester_name, academic_year, start_date, end_date,
              ay_start_year, ay_end_year, term_system
       FROM trimesters WHERE user_id = ? ORDER BY trimester_id DESC LIMIT 1`,
      [userId]
    );
    if (!rows.length) return Response.json({ trimester: null });
    const t = rows[0];
    return Response.json({
      trimester: {
        ay_start_year: t.ay_start_year != null ? Number(t.ay_start_year) : null,
        ay_end_year:   t.ay_end_year   != null ? Number(t.ay_end_year)   : null,
        term_system:   (t.term_system  as string | null) ?? null,
        current_term:  (t.trimester_name as string | null) ?? null,
        academic_year: (t.academic_year  as string | null) ?? null,
        start_date:    t.start_date ? String(t.start_date).split('T')[0] : '',
        end_date:      t.end_date   ? String(t.end_date).split('T')[0]   : '',
      }
    });
  } catch {
    return Response.json({ trimester: null });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { ay_start_year, ay_end_year, term_system, current_term, start_date, end_date } = await req.json();

  if (!ay_start_year || !ay_end_year || !term_system || !current_term || !start_date || !end_date) {
    return Response.json({ error: 'All fields required' }, { status: 400 });
  }

  const academic_year = `AY ${ay_start_year}-${ay_end_year}`;

  try {
    await pool.execute('DELETE FROM trimesters WHERE user_id = ?', [userId]);
    await pool.execute(
      `INSERT INTO trimesters
         (user_id, ay_start_year, ay_end_year, term_system, trimester_name, academic_year, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, ay_start_year, ay_end_year, term_system, current_term, academic_year, start_date, end_date]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[trimester POST]', err);
    return Response.json({ error: msg }, { status: 500 });
  }

  return Response.json({ status: 'success' });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  await pool.execute('DELETE FROM trimesters WHERE user_id = ?', [userId]);
  return Response.json({ status: 'success' });
}
