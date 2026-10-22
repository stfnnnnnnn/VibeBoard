import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureSubjectSection } from '@/lib/migrate';
import { listSubjectCards } from '@/lib/studypulse/subjectCards';
import type { ResultSetHeader } from 'mysql2';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  return Response.json(await listSubjectCards(parseInt(session.user.id)));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const { subject_name, course_code, section, units, year_level, trimester } = await req.json();

  if (!subject_name || !course_code || !year_level || !trimester) {
    return Response.json({ error: 'All fields are required' }, { status: 400 });
  }

  await ensureSubjectSection();
  const [subRes] = await pool.execute<ResultSetHeader>(
    'INSERT INTO subjects (subject_name, course_code, section, units, year_level, trimester) VALUES (?,?,?,?,?,?)',
    [subject_name.trim(), course_code.trim(), section ? String(section).trim() : null, Number(units) || 0, year_level, trimester]
  );

  const [usRes] = await pool.execute<ResultSetHeader>(
    'INSERT INTO user_subjects (user_id, subject_id) VALUES (?,?)',
    [userId, subRes.insertId]
  );

  return Response.json({ status: 'success', user_subject_id: usRes.insertId });
}
