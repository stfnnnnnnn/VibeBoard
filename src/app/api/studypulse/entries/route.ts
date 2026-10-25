import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureAccomplishedAt } from '@/lib/migrate';
import { insertActivityEntry, insertQuizEntry, insertExamEntry } from '@/lib/studypulseEntries';

const LEGACY: Record<string, [string, string]> = {
  activities: ['activities', 'activity_id'],
  quizzes:    ['quizzes',    'quiz_id'],
  exams:      ['exams',      'exam_id'],
};

/* POST /api/studypulse/entries — create or update a legacy activity, quiz or exam.
   Before any write: the subject is the caller's (user_subjects.user_id), and an existing entry_id belongs to that
   subject; otherwise 404. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  await ensureAccomplishedAt();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request' }, { status: 400 });
  const {
    type, entry_id, user_subject_id,
    name, specific_type, urgency, status, deadline,
    score, items, grade, accomplished_at,
  } = body;

  if (!user_subject_id || !name || !type) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!LEGACY[type]) return Response.json({ error: 'Invalid type' }, { status: 400 });

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?', [Number(user_subject_id), userId]);
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });
  if (entry_id) {
    const [table, idField] = LEGACY[type];
    const [entry] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM ${table} WHERE ${idField}=? AND user_subject_id=?`, [Number(entry_id), Number(user_subject_id)]);
    if (!entry.length) return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const s  = score  != null && score  !== '' ? Number(score)  : null;
  const it = items  != null && items  !== '' ? Number(items)  : null;
  const g  = grade  != null && grade  !== '' ? Number(grade)  : null;
  const dl = deadline       || null;
  const ac = accomplished_at || null;

  let newId: number;

  switch (type) {
    case 'activities': {
      const { entryId } = await insertActivityEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    case 'quizzes': {
      const { entryId } = await insertQuizEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    case 'exams': {
      const { entryId } = await insertExamEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    default:
      return Response.json({ error: 'Invalid type' }, { status: 400 });
  }

  return Response.json({ status: 'success', entry_id: newId, grade: g });
}
