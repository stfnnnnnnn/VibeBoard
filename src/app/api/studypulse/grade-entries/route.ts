import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureAccomplishedAt } from '@/lib/migrate';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/* GET /api/studypulse/grade-entries?subject_id=X&period_id=Y&cat_id=Z */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const sp           = req.nextUrl.searchParams;
  const subjectId    = sp.get('subject_id');
  const periodId     = sp.get('period_id');
  const catId        = sp.get('cat_id');

  if (!subjectId) return Response.json({ error: 'subject_id required' }, { status: 400 });

  let query  = 'SELECT * FROM grade_entries WHERE user_subject_id=?';
  const params: (string | number)[] = [parseInt(subjectId)];
  if (periodId) { query += ' AND period_id=?'; params.push(parseInt(periodId)); }
  if (catId)    { query += ' AND cat_id=?';    params.push(parseInt(catId));    }
  query += ' ORDER BY entry_id ASC';

  const [rows] = await pool.execute<RowDataPacket[]>(query, params);
  return Response.json({ entries: rows });
}

/* POST /api/studypulse/grade-entries — create or update */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    entry_id, user_subject_id, cat_id, period_id, is_lab,
    name, urgency, status, deadline, score, items, grade, accomplished_at,
  } = await req.json();

  if (!user_subject_id || !cat_id || !period_id || !name) {
    return Response.json({ error: 'user_subject_id, cat_id, period_id, name are required' }, { status: 400 });
  }

  await ensureAccomplishedAt();

  const ac = accomplished_at || null;

  try {
    if (entry_id) {
      await pool.execute(
        `UPDATE grade_entries SET cat_id=?, period_id=?, is_lab=?, name=?, urgency=?,
         status=?, deadline=?, score=?, items=?, grade=?, accomplished_at=?
         WHERE entry_id=? AND user_subject_id=?`,
        [cat_id, period_id, is_lab ? 1 : 0, name, urgency ?? 'Medium',
         status ?? 'Pending', deadline || null, score ?? null, items ?? null, grade ?? null, ac,
         entry_id, user_subject_id]
      );
      return Response.json({ status: 'success', entry_id });
    } else {
      const [res] = await pool.execute<ResultSetHeader>(
        `INSERT INTO grade_entries
           (user_subject_id, cat_id, period_id, is_lab, name, urgency, status, deadline, score, items, grade, accomplished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_subject_id, cat_id, period_id, is_lab ? 1 : 0, name,
         urgency ?? 'Medium', status ?? 'Pending', deadline || null,
         score ?? null, items ?? null, grade ?? null, ac]
      );
      return Response.json({ status: 'success', entry_id: res.insertId });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
