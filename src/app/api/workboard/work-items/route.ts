import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';
import { ensureWorkboardV2Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { manilaNowDatetime } from '@/lib/workboard/dates';
import { checkReferences } from '@/lib/workboard/ownership';

const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { category, title, note, project_id, user_subject_id, organization_id,
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

  const refError = await checkReferences(userId, {
    projectId: project_id, userSubjectId: user_subject_id, organizationId: organization_id,
  });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const status = work_status ?? 'todo';
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_work_items
       (user_id, category, project_id, user_subject_id, title, note, priority, work_status,
        due_at, start_date, estimated_hours, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, category, project_id ?? null, user_subject_id ?? null, title.trim(), note || null,
     priority ?? 'normal', status, due_at || null, start_date || null,
     estimated_hours ?? null, status === 'done' ? manilaNowDatetime() : null],
  );

  return Response.json({ status: 'success', item_id: res.insertId });
}
