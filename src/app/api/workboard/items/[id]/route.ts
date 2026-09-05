import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const PATCHABLE_FIELDS = ['title', 'location', 'starts_at', 'ends_at', 'remind_at', 'note', 'status'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_items WHERE id = ? AND user_id = ?', [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of PATCHABLE_FIELDS) {
    if (field in body) { setClauses.push(`${field} = ?`); values.push(body[field]); }
  }
  if (setClauses.length === 0) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_items SET ${setClauses.join(', ')} WHERE id = ?`, [...values, itemId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_items WHERE id = ? AND user_id = ?', [itemId, userId],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
