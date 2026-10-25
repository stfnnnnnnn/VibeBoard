import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureAccomplishedAt } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import { insertGradeEntry } from '@/lib/studypulseEntries';

/** Ownership: the subject must belong to the signed-in user (same pattern as subjects/[id]/lab-link). */
async function ownsSubject(userId: number, userSubjectId: number): Promise<boolean> {
  if (!Number.isInteger(userSubjectId)) return false;
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?', [userSubjectId, userId]);
  return rows.length > 0;
}

/* GET /api/studypulse/grade-entries?subject_id=X&period_id=Y&cat_id=Z — only for a subject the caller owns. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const sp           = req.nextUrl.searchParams;
  const subjectId    = sp.get('subject_id');
  const periodId     = sp.get('period_id');
  const catId        = sp.get('cat_id');

  if (!subjectId) return Response.json({ error: 'subject_id required' }, { status: 400 });
  const userSubjectId = parseInt(subjectId);
  if (!(await ownsSubject(userId, userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  let query  = 'SELECT * FROM grade_entries WHERE user_subject_id=?';
  const params: (string | number)[] = [userSubjectId];
  if (periodId) { query += ' AND period_id=?'; params.push(parseInt(periodId)); }
  if (catId)    { query += ' AND cat_id=?';    params.push(parseInt(catId));    }
  query += ' ORDER BY entry_id ASC';

  const [rows] = await pool.execute<RowDataPacket[]>(query, params);
  return Response.json({ entries: rows });
}

/* POST /api/studypulse/grade-entries — create or update.
   Before any write: the subject is the caller's; an existing entry_id belongs to that subject; and cat_id sits in
   period_id inside the subject's current grading system (subject_grading -> grading_periods -> grading_categories). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const {
    entry_id, user_subject_id, cat_id, period_id, is_lab,
    name, urgency, status, deadline, score, items, grade, accomplished_at,
  } = await req.json();

  if (!user_subject_id || !cat_id || !period_id || !name) {
    return Response.json({ error: 'user_subject_id, cat_id, period_id, name are required' }, { status: 400 });
  }
  const userSubjectId = Number(user_subject_id);
  const catId = Number(cat_id);
  const periodId = Number(period_id);
  if (!(await ownsSubject(userId, userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  if (entry_id) {
    const [entry] = await pool.execute<RowDataPacket[]>(
      'SELECT 1 FROM grade_entries WHERE entry_id=? AND user_subject_id=?', [Number(entry_id), userSubjectId]);
    if (!entry.length) return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const [inPreset] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM grading_categories gc
     JOIN grading_periods gp ON gp.period_id = gc.period_id
     JOIN subject_grading sg ON sg.preset_id = gp.preset_id AND sg.user_subject_id = ?
     JOIN grading_presets p ON p.preset_id = gp.preset_id AND p.user_id = ?
     WHERE gc.cat_id = ? AND gp.period_id = ?`,
    [userSubjectId, userId, catId, periodId]);
  if (!inPreset.length) {
    return Response.json({ error: "That category is not part of this subject's grading system" }, { status: 400 });
  }

  await ensureAccomplishedAt();
  const ac = accomplished_at || null;

  try {
    const { entryId } = await insertGradeEntry({
      entryId: entry_id, userSubjectId, catId, periodId,
      isLab: !!is_lab, name, urgency: urgency ?? 'Medium', status: status ?? 'Pending',
      deadline: deadline || null, score: score ?? null, items: items ?? null, grade: grade ?? null,
      accomplishedAt: ac,
    });
    return Response.json({ status: 'success', entry_id: entryId });
  } catch (err) {
    // The full error stays in the server log; the client gets a generic message (no DB text).
    console.error('Save grade entry failed:', err);
    return Response.json({ error: 'Could not save this entry. Try again.' }, { status: 500 });
  }
}
