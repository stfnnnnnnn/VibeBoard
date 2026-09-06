import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV2Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';

const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

/** Returns null when the reference is absent or valid; returns an error string when the
 *  client supplied an id that isn't theirs. Never trust an id from the request body. */
export async function checkReferences(
  userId: number, projectId: unknown, userSubjectId: unknown,
): Promise<string | null> {
  if (projectId !== null && projectId !== undefined) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM workboard_projects WHERE id = ? AND user_id = ?',
      [projectId as string | number, userId],
    );
    if (!rows.length) return 'That project was not found';
  }
  if (userSubjectId !== null && userSubjectId !== undefined) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT user_subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?',
      [userSubjectId as string | number, userId],
    );
    if (!rows.length) return 'That subject was not found';
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { category, title, note, project_id, user_subject_id,
          priority, work_status, due_at, start_date, estimated_hours } = body;

  if (!WORK_CATEGORIES.includes(category)) {
    return Response.json({ error: 'category must be academic, project, organization, or life' }, { status: 400 });
  }
  if (typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    return Response.json({ error: 'priority must be high, normal, or low' }, { status: 400 });
  }
  if (work_status !== undefined && !STATUSES.includes(work_status)) {
    return Response.json({ error: 'work_status must be todo, in_progress, or done' }, { status: 400 });
  }

  const refError = await checkReferences(userId, project_id, user_subject_id);
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const status = work_status ?? 'todo';
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_work_items
       (user_id, category, project_id, user_subject_id, title, note, priority, work_status,
        due_at, start_date, estimated_hours, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, category, project_id ?? null, user_subject_id ?? null, title.trim(), note || null,
     priority ?? 'normal', status, due_at || null, start_date || null,
     estimated_hours ?? null, status === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null],
  );

  return Response.json({ status: 'success', item_id: res.insertId });
}
