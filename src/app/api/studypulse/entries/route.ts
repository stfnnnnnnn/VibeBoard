import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureAccomplishedAt } from '@/lib/migrate';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureAccomplishedAt();

  const body = await req.json();
  const {
    type, entry_id, user_subject_id,
    name, specific_type, urgency, status, deadline,
    score, items, grade, accomplished_at,
  } = body;

  if (!user_subject_id || !name || !type) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const s  = score  != null && score  !== '' ? Number(score)  : null;
  const it = items  != null && items  !== '' ? Number(items)  : null;
  const g  = grade  != null && grade  !== '' ? Number(grade)  : null;
  const dl = deadline       || null;
  const ac = accomplished_at || null;

  let newId: number;

  switch (type) {
    case 'activities':
      if (entry_id) {
        await pool.execute(
          'UPDATE activities SET activity_name=?,activity_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE activity_id=? AND user_subject_id=?',
          [name, specific_type ?? '', urgency, status, dl, s, it, g, ac, entry_id, user_subject_id]
        );
        newId = entry_id;
      } else {
        const [r] = await pool.execute<ResultSetHeader>(
          'INSERT INTO activities (user_subject_id,activity_name,activity_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [user_subject_id, name, specific_type ?? '', urgency, status, dl, s, it, g, ac]
        );
        newId = r.insertId;
      }
      break;

    case 'quizzes':
      if (entry_id) {
        await pool.execute(
          'UPDATE quizzes SET quiz_name=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE quiz_id=? AND user_subject_id=?',
          [name, urgency, status, dl, s, it, g, ac, entry_id, user_subject_id]
        );
        newId = entry_id;
      } else {
        const [mx] = await pool.execute<RowDataPacket[]>(
          'SELECT COALESCE(MAX(quiz_number),0)+1 AS next_num FROM quizzes WHERE user_subject_id=?',
          [user_subject_id]
        );
        const [r] = await pool.execute<ResultSetHeader>(
          'INSERT INTO quizzes (user_subject_id,quiz_name,quiz_number,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [user_subject_id, name, mx[0].next_num, urgency, status, dl, s, it, g, ac]
        );
        newId = r.insertId;
      }
      break;

    case 'exams':
      if (entry_id) {
        await pool.execute(
          'UPDATE exams SET exam_name=?,exam_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE exam_id=? AND user_subject_id=?',
          [name, specific_type ?? '', urgency, status, dl, s, it, g, ac, entry_id, user_subject_id]
        );
        newId = entry_id;
      } else {
        const [r] = await pool.execute<ResultSetHeader>(
          'INSERT INTO exams (user_subject_id,exam_name,exam_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [user_subject_id, name, specific_type ?? '', urgency, status, dl, s, it, g, ac]
        );
        newId = r.insertId;
      }
      break;

    default:
      return Response.json({ error: 'Invalid type' }, { status: 400 });
  }

  return Response.json({ status: 'success', entry_id: newId, grade: g });
}
