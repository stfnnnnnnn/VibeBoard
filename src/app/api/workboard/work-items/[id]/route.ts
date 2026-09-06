import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { checkReferences } from '../route';

const PATCHABLE = ['title', 'note', 'category', 'project_id', 'user_subject_id',
                   'priority', 'work_status', 'due_at', 'start_date', 'estimated_hours'] as const;
const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_work_items WHERE id = ? AND user_id = ?', [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('category' in body && !WORK_CATEGORIES.includes(body.category)) {
    return Response.json({ error: 'Invalid category' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }
  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }

  const refError = await checkReferences(
    userId,
    'project_id' in body ? body.project_id : undefined,
    'user_subject_id' in body ? body.user_subject_id : undefined,
  );
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if ('work_status' in body) {
    sets.push('completed_at = ?');
    values.push(body.work_status === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_work_items SET ${sets.join(', ')} WHERE id = ?`, [...values, itemId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_work_items WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
