import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const subtaskId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_subtasks WHERE id = ? AND user_id = ?', [subtaskId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('title' in body && (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 255)) {
    return Response.json({ error: 'A title between 1 and 255 characters is required' }, { status: 400 });
  }
  if ('is_done' in body && typeof body.is_done !== 'boolean') {
    return Response.json({ error: 'is_done must be a boolean' }, { status: 400 });
  }
  if ('position' in body && !(Number.isInteger(body.position) && body.position >= 0)) {
    return Response.json({ error: 'position must be a non-negative integer' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const field of ['title', 'is_done', 'position'] as const) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(field === 'is_done' ? (body.is_done ? 1 : 0) : field === 'title' ? body.title.trim() : body[field]);
    }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_subtasks SET ${sets.join(', ')} WHERE id = ?`, [...values, subtaskId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_subtasks WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
